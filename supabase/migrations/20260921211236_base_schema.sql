create extension if not exists pgcrypto;

create schema if not exists next_auth;
create schema if not exists private;

grant usage on schema next_auth to authenticated, service_role;
grant all on schema next_auth to postgres;
revoke all on schema private from public, anon, authenticated;

create table if not exists next_auth.users (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text unique,
  "emailVerified" timestamptz,
  image text
);

create table if not exists next_auth.sessions (
  id uuid primary key default gen_random_uuid(),
  expires timestamptz not null,
  "sessionToken" text not null unique,
  "userId" uuid references next_auth.users(id) on delete cascade
);

create table if not exists next_auth.accounts (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  provider text not null,
  "providerAccountId" text not null,
  refresh_token text,
  access_token text,
  expires_at bigint,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  oauth_token_secret text,
  oauth_token text,
  "userId" uuid references next_auth.users(id) on delete cascade,
  unique (provider, "providerAccountId")
);

create table if not exists next_auth.verification_tokens (
  identifier text,
  token text primary key,
  expires timestamptz not null,
  unique (token, identifier)
);

grant all on all tables in schema next_auth to postgres, service_role;
alter default privileges for role postgres in schema next_auth
  grant all on tables to service_role;

alter table next_auth.users enable row level security;
alter table next_auth.sessions enable row level security;
alter table next_auth.accounts enable row level security;
alter table next_auth.verification_tokens enable row level security;

create or replace function next_auth.uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

revoke execute on function next_auth.uid() from public, anon;
grant execute on function next_auth.uid() to authenticated, service_role;

create table if not exists public.users (
  id uuid primary key references next_auth.users(id) on delete cascade,
  name text,
  email text,
  image text,
  credits numeric default 25,
  upgraded_at timestamptz,
  polar_customer_id text,
  canceled_at timestamp,
  expired_at timestamp,
  last_payment_at timestamp,
  last_payment_failed_at timestamp,
  reactivated_at timestamp,
  last_purchase_at timestamp
);

create table if not exists public.uploaded_files (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  s3_key text not null,
  status text not null default 'queued',
  updated_at timestamptz,
  user_id uuid not null references public.users(id) on delete cascade,
  title text,
  source_url text,
  uploaded boolean not null default false,
  end_time numeric,
  start_time numeric,
  thumbnail text,
  bait_video text,
  layout text default 'full'
);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  s3_key text not null,
  updated_at timestamptz,
  uploaded_file_id uuid not null references public.uploaded_files(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  virality_score numeric,
  transcript text
);

create table if not exists public.credit_purchases (
  id serial primary key,
  user_id uuid references public.users(id),
  credits_purchased integer not null,
  credits_before integer not null,
  credits_after integer not null,
  product_id text not null,
  product_name text not null,
  amount_paid integer,
  currency text default 'USD',
  polar_checkout_id text,
  polar_customer_id text,
  purchased_at timestamp default now(),
  metadata jsonb
);

create index if not exists uploaded_files_user_id_idx on public.uploaded_files(user_id);
create index if not exists clips_uploaded_file_id_idx on public.clips(uploaded_file_id);
create index if not exists clips_user_id_idx on public.clips(user_id);
create index if not exists credit_purchases_user_id_idx on public.credit_purchases(user_id);

create or replace function private.sync_app_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, name, email, image)
  values (new.id, new.name, new.email, new.image)
  on conflict (id) do update
    set name = excluded.name,
        email = excluded.email,
        image = excluded.image;
  return new;
end;
$$;

create trigger sync_app_user_after_insert
  after insert on next_auth.users
  for each row execute function private.sync_app_user();

create trigger sync_app_user_after_update
  after update of name, email, image on next_auth.users
  for each row execute function private.sync_app_user();

alter table public.users enable row level security;
alter table public.uploaded_files enable row level security;
alter table public.clips enable row level security;
alter table public.credit_purchases enable row level security;

create policy "Users can read their profile"
  on public.users for select
  to authenticated
  using (next_auth.uid() = id);

create policy "Users can read their video jobs"
  on public.uploaded_files for select
  to authenticated
  using (next_auth.uid() = user_id);

create policy "Users can create their video jobs"
  on public.uploaded_files for insert
  to authenticated
  with check (next_auth.uid() = user_id);

create policy "Users can read their clips"
  on public.clips for select
  to authenticated
  using (next_auth.uid() = user_id);

create policy "Users can read their purchases"
  on public.credit_purchases for select
  to authenticated
  using (next_auth.uid() = user_id);

grant select on public.users to authenticated;
grant select, insert on public.uploaded_files to authenticated;
grant select on public.clips, public.credit_purchases to authenticated;

grant all on public.users, public.uploaded_files, public.clips, public.credit_purchases
  to service_role;
grant usage, select on sequence public.credit_purchases_id_seq to service_role;
