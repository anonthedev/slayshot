create unique index if not exists credit_purchases_polar_checkout_id_key
  on public.credit_purchases(polar_checkout_id)
  where polar_checkout_id is not null;

alter table public.uploaded_files
  add column if not exists credits_charged integer not null default 0;

create or replace function private.protect_user_credits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin')
    and new.credits is distinct from old.credits then
    raise exception 'Credit balances may only be changed by the payment service';
  end if;
  return new;
end;
$$;

create or replace function private.protect_upload_charges()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if tg_op = 'INSERT' and new.credits_charged <> 0 then
      raise exception 'Processing charges must start at zero';
    end if;

    if tg_op = 'UPDATE'
      and new.credits_charged is distinct from old.credits_charged then
      raise exception 'Processing charges may only be changed by the payment service';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_user_credits on public.users;
create trigger protect_user_credits
  before update of credits on public.users
  for each row execute function private.protect_user_credits();

drop trigger if exists protect_upload_charges on public.uploaded_files;
create trigger protect_upload_charges
  before insert or update of credits_charged on public.uploaded_files
  for each row execute function private.protect_upload_charges();

revoke insert, update, delete
  on public.credit_purchases
  from anon, authenticated;

create or replace function public.apply_credit_purchase(
  p_user_id uuid,
  p_credits integer,
  p_product_id text,
  p_product_name text,
  p_amount_paid integer,
  p_currency text,
  p_checkout_id text,
  p_customer_id text,
  p_metadata jsonb
)
returns table (applied boolean, balance numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before numeric;
  v_after numeric;
  v_existing_balance numeric;
begin
  if p_checkout_id is null or btrim(p_checkout_id) = '' then
    raise exception 'Polar checkout ID is required';
  end if;

  if p_credits <= 0 then
    raise exception 'Credit amount must be positive';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_checkout_id, 0));

  select credits_after
    into v_existing_balance
    from public.credit_purchases
    where polar_checkout_id = p_checkout_id;

  if found then
    return query select false, v_existing_balance;
    return;
  end if;

  select coalesce(credits, 0)
    into v_before
    from public.users
    where id = p_user_id
    for update;

  if not found then
    raise exception 'User % does not exist', p_user_id;
  end if;

  if v_before <> trunc(v_before) then
    raise exception 'User credit balance must be a whole number';
  end if;

  v_after := v_before + p_credits;

  update public.users
    set credits = v_after,
        last_purchase_at = now(),
        polar_customer_id = coalesce(p_customer_id, polar_customer_id)
    where id = p_user_id;

  insert into public.credit_purchases (
    user_id,
    credits_purchased,
    credits_before,
    credits_after,
    product_id,
    product_name,
    amount_paid,
    currency,
    polar_checkout_id,
    polar_customer_id,
    purchased_at,
    metadata
  )
  values (
    p_user_id,
    p_credits,
    v_before::integer,
    v_after::integer,
    p_product_id,
    p_product_name,
    p_amount_paid,
    coalesce(p_currency, 'USD'),
    p_checkout_id,
    p_customer_id,
    now(),
    p_metadata
  );

  return query select true, v_after;
end;
$$;

create or replace function public.charge_video_processing(
  p_uploaded_file_id uuid,
  p_user_id uuid,
  p_credits integer
)
returns table (charged boolean, balance numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_already_charged integer;
  v_balance numeric;
begin
  if p_credits <= 0 then
    raise exception 'Credit amount must be positive';
  end if;

  select user_id, credits_charged
    into v_owner_id, v_already_charged
    from public.uploaded_files
    where id = p_uploaded_file_id
    for update;

  if not found or v_owner_id <> p_user_id then
    raise exception 'Uploaded file does not belong to this user';
  end if;

  select coalesce(credits, 0)
    into v_balance
    from public.users
    where id = p_user_id
    for update;

  if v_already_charged > 0 then
    return query select false, v_balance;
    return;
  end if;

  if v_balance < p_credits then
    raise exception 'Insufficient credits';
  end if;

  v_balance := v_balance - p_credits;

  update public.users
    set credits = v_balance
    where id = p_user_id;

  update public.uploaded_files
    set credits_charged = p_credits,
        updated_at = now()
    where id = p_uploaded_file_id;

  return query select true, v_balance;
end;
$$;

create or replace function public.refund_video_processing(
  p_uploaded_file_id uuid,
  p_user_id uuid
)
returns table (refunded boolean, balance numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_credits_charged integer;
  v_balance numeric;
begin
  select user_id, credits_charged
    into v_owner_id, v_credits_charged
    from public.uploaded_files
    where id = p_uploaded_file_id
    for update;

  if not found or v_owner_id <> p_user_id then
    raise exception 'Uploaded file does not belong to this user';
  end if;

  select coalesce(credits, 0)
    into v_balance
    from public.users
    where id = p_user_id
    for update;

  if v_credits_charged = 0 then
    return query select false, v_balance;
    return;
  end if;

  v_balance := v_balance + v_credits_charged;

  update public.users
    set credits = v_balance
    where id = p_user_id;

  update public.uploaded_files
    set credits_charged = 0,
        updated_at = now()
    where id = p_uploaded_file_id;

  return query select true, v_balance;
end;
$$;

revoke execute on function public.apply_credit_purchase(
  uuid, integer, text, text, integer, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_credit_purchase(
  uuid, integer, text, text, integer, text, text, text, jsonb
) to service_role;

revoke execute on function public.charge_video_processing(
  uuid, uuid, integer
) from public, anon, authenticated;
grant execute on function public.charge_video_processing(
  uuid, uuid, integer
) to service_role;

revoke execute on function public.refund_video_processing(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.refund_video_processing(
  uuid, uuid
) to service_role;
