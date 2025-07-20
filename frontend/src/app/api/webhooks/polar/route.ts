import { Webhooks } from "@polar-sh/nextjs";
import { createClient } from '@supabase/supabase-js';

// Create Supabase client with service role key for admin operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  onPayload: async (payload) => {
    console.log('Received Polar webhook:', payload.type);
    
    try {
      // Handle the event
      switch (payload.type) {
        // Checkout has been created
        case "checkout.created":
          console.log('Checkout created:', payload.data);
          // Usually no action needed here, just logging
          break;
        
        // Checkout has been updated - this will be triggered when checkout status goes from confirmed -> succeeded
        case "checkout.updated":
          await handleCheckoutUpdated(payload);
          break;
        
        // Subscription has been created
        case "subscription.created":
          await handleSubscriptionCreated(payload);
          break;
        
        // A catch-all case to handle all subscription webhook events
        case "subscription.updated":
          await handleSubscriptionUpdated(payload);
          break;
        
        // Subscription has been activated
        case "subscription.active":
          await handleSubscriptionActive(payload);
          break;
        
        // Subscription has been revoked/period has ended with no renewal
        case "subscription.revoked":
          await handleSubscriptionRevoked(payload);
          break;
        
        // Subscription has been explicitly canceled by the user
        case "subscription.canceled":
          await handleSubscriptionCanceled(payload);
          break;
        
        default:
          console.log(`Unhandled event type ${payload.type}`);
      }
    } catch (error) {
      console.error('Error processing webhook:', error);
      // Don't throw - let Polar know we received the webhook
    }
  }
});

//@ts-expect-error - Polar types are not fully typed
async function handleCheckoutUpdated(payload) {
  const { data } = payload;
  console.log('Processing checkout update:', data);
  
  // Only process successful checkouts
  if (data.status !== 'succeeded') {
    console.log('Checkout not succeeded yet, status:', data.status);
    return;
  }
  
  const userId = data.metadata?.user_id;
  
  if (!userId) {
    console.error('No user ID found in checkout webhook payload');
    return;
  }

  console.log('Processing successful checkout for user:', userId);

  try {
    // Update user to pro status with 200 credits
    const { error: updateError } = await supabase
      .from('users')
      .update({
        credits: 200,
        plan: 'pro',
        upgraded_at: new Date().toISOString(),
        polar_customer_id: data.customer_id,
        subscription_status: 'active'
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating user after checkout:', updateError);
      return;
    }

    console.log('Successfully processed checkout success:', userId);
  } catch (error) {
    console.error('Error processing checkout update:', error);
  }
}

//@ts-expect-error - Polar types are not fully typed
async function handleSubscriptionCreated(payload) {
  const { data } = payload;
  console.log('Processing subscription creation:', data);
  
  const userId = data.metadata?.user_id;
  
  if (!userId) {
    console.error('No user ID found in subscription creation webhook');
    return;
  }

  try {
    const { error: updateError } = await supabase
      .from('users')
      .update({
        credits: 200,
        plan: 'pro',
        upgraded_at: new Date().toISOString(),
        polar_customer_id: data.customer_id,
        subscription_id: data.id,
        subscription_status: 'active'
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating user after subscription creation:', updateError);
      return;
    }

    console.log('Successfully processed subscription creation:', userId);
  } catch (error) {
    console.error('Error processing subscription creation:', error);
  }
}

//@ts-expect-error - Polar types are not fully typed
async function handleSubscriptionUpdated(payload) {
  const { data } = payload;
  console.log('Processing subscription update:', data);
  
  const userId = data.metadata?.user_id;
  
  if (!userId) {
    console.error('No user ID found in subscription update');
    return;
  }

  try {
    // Update subscription details, but don't change credits/plan here
    // Those will be handled by specific status events (active, revoked, canceled)
    const { error: updateError } = await supabase
      .from('users')
      .update({
        subscription_status: data.status,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating subscription:', updateError);
      return;
    }

    console.log('Successfully updated subscription status:', { userId, status: data.status });
  } catch (error) {
    console.error('Error processing subscription update:', error);
  }
}

//@ts-expect-error - Polar types are not fully typed
async function handleSubscriptionActive(payload) {
  const { data } = payload;
  console.log('Processing subscription activation:', data);
  
  const userId = data.metadata?.user_id;
  
  if (!userId) {
    console.error('No user ID found in subscription activation');
    return;
  }

  try {
    // Restore full pro access
    const { error: updateError } = await supabase
      .from('users')
      .update({
        credits: 200,
        plan: 'pro',
        subscription_status: 'active',
        last_payment_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error activating subscription:', updateError);
      return;
    }

    console.log('Successfully activated subscription:', userId);
  } catch (error) {
    console.error('Error processing subscription activation:', error);
  }
}

//@ts-expect-error - Polar types are not fully typed
async function handleSubscriptionRevoked(payload) {
  const { data } = payload;
  console.log('Processing subscription revocation:', data);
  
  const userId = data.metadata?.user_id;
  
  if (!userId) {
    console.error('No user ID found in subscription revocation');
    return;
  }

  try {
    // Remove pro access - subscription period ended with no renewal
    const { error: updateError } = await supabase
      .from('users')
      .update({
        credits: 0,
        plan: 'free',
        subscription_status: 'revoked',
        revoked_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error revoking subscription:', updateError);
      return;
    }

    console.log('Successfully revoked subscription and reset credits:', userId);
  } catch (error) {
    console.error('Error processing subscription revocation:', error);
  }
}

//@ts-expect-error - Polar types are not fully typed
async function handleSubscriptionCanceled(payload) {
  const { data } = payload;
  console.log('Processing subscription cancellation:', data);
  
  const userId = data.metadata?.user_id;
  
  if (!userId) {
    console.error('No user ID found in subscription cancellation');
    return;
  }

  try {
    // Remove pro access - user explicitly canceled
    const { error: updateError } = await supabase
      .from('users')
      .update({
        credits: 0,
        plan: 'free',
        subscription_status: 'canceled',
        canceled_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error canceling subscription:', updateError);
      return;
    }

    console.log('Successfully canceled subscription and reset credits:', userId);
  } catch (error) {
    console.error('Error processing subscription cancellation:', error);
  }
}