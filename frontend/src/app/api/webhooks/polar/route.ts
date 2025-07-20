import { Webhooks } from "@polar-sh/nextjs";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const CREDIT_PACKAGES = {
  [process.env.NEXT_PUBLIC_POLAR_STARTER_PRODUCT_ID!]: { credits: 100, name: "Starter Pack" },
  [process.env.NEXT_PUBLIC_POLAR_PRO_PRODUCT_ID!]: { credits: 200, name: "Pro Pack" },
} as const;

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  onPayload: async (payload) => {
    console.log("Received Polar webhook:", payload.type);

    try {
      // Handle the event
      switch (payload.type) {
        // Checkout has been created
        case "checkout.created":
          console.log("Checkout created:", payload.data);
          // Usually no action needed here, just logging
          break;

        // Checkout has been updated - this will be triggered when checkout status goes from confirmed -> succeeded
        case "checkout.updated":
          await handleCheckoutUpdated(payload);
          break;

        // For credit-based system, we don't need subscription events
        // But keeping them for logging in case you have any legacy subscriptions
        case "subscription.created":
        case "subscription.updated":
        case "subscription.active":
        case "subscription.revoked":
        case "subscription.canceled":
          console.log(
            "Subscription event (ignored in credit system):",
            payload.type,
            payload.data
          );
          break;

        default:
          console.log(`Unhandled event type ${payload.type}`);
      }
    } catch (error) {
      console.error("Error processing webhook:", error);
      // Don't throw - let Polar know we received the webhook
    }
  },
});

//@ts-expect-error - Polar types are not fully typed
async function handleCheckoutUpdated(payload) {
  const { data } = payload;
  console.log("Processing checkout update:", data);

  // Only process successful checkouts
  if (data.status !== "succeeded") {
    console.log("Checkout not succeeded yet, status:", data.status);
    return;
  }

  const userId = data.metadata?.user_id;
  const productId = data.product_id || data.metadata?.product_id;

  if (!userId) {
    console.error("No user ID found in checkout webhook payload");
    return;
  }

  if (!productId) {
    console.error("No product ID found in checkout webhook payload");
    return;
  }

  console.log("Processing successful credit purchase for user:", userId);

  try {
    // Get credit package info
    const creditPackage =
      CREDIT_PACKAGES[productId as keyof typeof CREDIT_PACKAGES];

    if (!creditPackage) {
      console.error("Unknown product ID:", productId);
      return;
    }

    // Get current user credits
    const { data: userData, error: fetchError } = await supabase
      .from("users")
      .select("credits")
      .eq("id", userId)
      .single();

    if (fetchError) {
      console.error("Error fetching user data:", fetchError);
      return;
    }

    const currentCredits = Number(userData?.credits) || 0;
    const newCredits = currentCredits + creditPackage.credits;

    // Add credits to user account
    const { error: updateError } = await supabase
      .from("users")
      .update({
        credits: newCredits,
        last_purchase_at: new Date().toISOString(),
        polar_customer_id: data.customer_id,
      })
      .eq("id", userId);

    if (updateError) {
      console.error("Error updating user credits:", updateError);
      return;
    }

    // Optional: Log the credit purchase for analytics/support
    // You can create this table later if you want purchase history

    const { error: logError } = await supabase.from("credit_purchases").insert({
      user_id: userId,
      credits_purchased: creditPackage.credits,
      credits_before: currentCredits,
      credits_after: newCredits,
      product_id: productId,
      product_name: creditPackage.name,
      amount_paid: data.amount,
      currency: data.currency,
      polar_checkout_id: data.id,
      polar_customer_id: data.customer_id,
      purchased_at: new Date().toISOString(),
      metadata: data.metadata,
    });

    if (logError) {
      console.error("Error logging credit purchase:", logError);
      // Don't return here - the main credit update succeeded
    }

    console.log("Successfully processed credit purchase:", {
      userId,
      productName: creditPackage.name,
      creditsPurchased: creditPackage.credits,
      creditsAfter: newCredits,
      amountPaid: data.amount,
    });
  } catch (error) {
    console.error("Error processing credit purchase:", error);
  }
}
