"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function ConfirmationContent() {
  const searchParams = useSearchParams();
  const checkoutId = searchParams.get("checkout_id");

  return (
    <div className="container mx-auto px-4 py-16">
      <Card className="max-w-md mx-auto">
        <CardHeader className="text-center">
          <CardTitle>Purchase Successful!</CardTitle>
          <CardDescription>
            Your credits have been added to your account
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <div className="mb-6">
            <div className="text-3xl font-bold mb-2">✓</div>
            <div className="text-sm text-muted-foreground">
              Credits Added Successfully
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
            <div className="text-sm">✓ Credits added to your account</div>
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