import { Webhooks } from "@polar-sh/nextjs";
import { createClient } from "@supabase/supabase-js";
import { getCreditPackage } from "@/lib/payments";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  onOrderPaid: async ({ data: order }) => {
    const userId = order.metadata.user_id;
    const metadataProductId = order.metadata.product_id;
    const creditPackage = getCreditPackage(order.productId);

    if (typeof userId !== "string" || !isUuid(userId)) {
      console.error("Paid order is missing a valid user ID:", order.id);
      return;
    }

    if (!creditPackage?.id || !order.checkoutId) {
      console.error("Paid order has an unknown product or no checkout:", order.id);
      return;
    }

    if (
      typeof metadataProductId === "string" &&
      metadataProductId !== creditPackage.id
    ) {
      console.error("Paid order product does not match its metadata:", order.id);
      return;
    }

    const expectedAmount = creditPackage.price * 100;
    if (order.totalAmount !== expectedAmount) {
      console.error(
        "Paid order amount does not match the configured package:",
        order.id,
      );
      return;
    }

    const { data: result, error } = await supabase.rpc(
      "apply_credit_purchase",
      {
        p_user_id: userId,
        p_credits: creditPackage.credits,
        p_product_id: creditPackage.id,
        p_product_name: creditPackage.name,
        p_amount_paid: order.totalAmount,
        p_currency: order.currency,
        p_checkout_id: order.checkoutId,
        p_customer_id: order.customerId,
        p_metadata: order.metadata,
      },
    );

    if (error) {
      throw new Error(`Failed to apply credit purchase: ${error.message}`);
    }

    const outcome = Array.isArray(result) ? result[0] : result;
    console.log(
      outcome?.applied
        ? "Credit purchase applied"
        : "Credit purchase already applied",
      order.id,
    );
  },
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
