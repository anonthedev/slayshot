import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkoutId = request.nextUrl.searchParams.get("checkout_id");
  if (!checkoutId || checkoutId.length > 255) {
    return NextResponse.json({ error: "Invalid checkout ID" }, { status: 400 });
  }

  const supabase = supabaseClient(session.supabaseAccessToken as string);

  const { data, error } = await supabase
    .from("credit_purchases")
    .select("credits_purchased")
    .eq("polar_checkout_id", checkoutId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to verify credit purchase:", error.message);
    return NextResponse.json(
      { error: "Could not verify purchase" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    applied: Boolean(data),
    credits: data?.credits_purchased ?? 0,
  });
}
