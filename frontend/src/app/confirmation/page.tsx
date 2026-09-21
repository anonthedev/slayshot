"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function ConfirmationContent() {
  const searchParams = useSearchParams();
  const checkoutId = searchParams.get("checkout_id");
  const [status, setStatus] = useState<"checking" | "applied" | "pending">(
    "checking",
  );
  const [credits, setCredits] = useState(0);

  useEffect(() => {
    if (!checkoutId) {
      setStatus("pending");
      return;
    }

    let cancelled = false;

    async function verifyPurchase() {
      for (let attempt = 0; attempt < 30 && !cancelled; attempt += 1) {
        try {
          const response = await fetch(
            `/api/payments/status?checkout_id=${encodeURIComponent(checkoutId!)}`,
            { cache: "no-store" },
          );

          if (response.ok) {
            const result = await response.json();
            if (result.applied) {
              setCredits(result.credits);
              setStatus("applied");
              return;
            }
          }
        } catch {
          if (attempt === 29 && !cancelled) setStatus("pending");
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (!cancelled) setStatus("pending");
    }

    void verifyPurchase();
    return () => {
      cancelled = true;
    };
  }, [checkoutId]);

  return (
    <div className="container mx-auto px-4 py-16">
      <Card className="max-w-md mx-auto">
        <CardHeader className="text-center">
          <CardTitle>
            {status === "applied"
              ? "Purchase successful!"
              : "Confirming your purchase…"}
          </CardTitle>
          <CardDescription>
            {status === "applied"
              ? `${credits} credits were added to your account`
              : "We are confirming your credit balance"}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <div className="mb-6">
            <div className="text-3xl font-bold mb-2">✓</div>
            <div className="text-sm text-muted-foreground">
              {status === "checking" && "Checking payment status…"}
              {status === "applied" && "Credits added successfully"}
              {status === "pending" &&
                "Payment received. Credits may take another moment to appear."}
            </div>
          </div>

          {checkoutId && (
            <div className="mb-6 p-3 bg-muted rounded-lg">
              <div className="text-xs text-muted-foreground mb-1">
                Checkout ID
              </div>
              <div className="text-sm font-mono break-all">
                {checkoutId}
              </div>
            </div>
          )}

          <div className="space-y-3 mb-6">
            <div className="text-sm">
              {status === "applied"
                ? "✓ Credit balance updated"
                : "• Credit update pending"}
            </div>
            <div className="text-sm">✓ Credits never expire</div>
            <div className="text-sm">✓ Ready to create amazing clips</div>
          </div>

          <Button 
            onClick={() => window.location.href = "/dashboard"}
            className="w-full"
          >
            Start Creating Clips
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ConfirmationFallback() {
  return (
    <div className="container mx-auto px-4 py-16">
      <Card className="max-w-md mx-auto">
        <CardHeader className="text-center">
          <CardTitle>Loading...</CardTitle>
          <CardDescription>
            Please wait while we load your confirmation details
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <div className="animate-pulse">
            <div className="h-8 bg-muted rounded mb-4"></div>
            <div className="h-4 bg-muted rounded mb-2"></div>
            <div className="h-4 bg-muted rounded mb-6"></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ConfirmationPage() {
  return (
    <Suspense fallback={<ConfirmationFallback />}>
      <ConfirmationContent />
    </Suspense>
  );
} 