"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { supabaseClient } from "@/lib/supabase";

// Credit packages configuration
const CREDIT_PACKAGES = [
  {
    id: process.env.NEXT_PUBLIC_POLAR_STARTER_PRODUCT_ID!,
    name: "Starter Pack",
    credits: 100,
    price: 8,
    description: "Perfect for getting started",
    popular: false,
  },
  {
    id: process.env.NEXT_PUBLIC_POLAR_PRO_PRODUCT_ID!,
    name: "Pro Pack",
    credits: 500,
    price: 15,
    description: "Best value for power users",
    popular: true,
  },
];

export default function Pricing() {
  const { data: session } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [userCredits, setUserCredits] = useState(0);
  const [loading, setLoading] = useState(true);

  const handlePurchase = async (productId: string) => {
    if (!session) {
      toast.error("Please sign in to purchase credits");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ productId }),
      });

      if (!response.ok) {
        throw new Error("Failed to create checkout session");
      }

      const { checkoutUrl } = await response.json();
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error("Purchase error:", error);
      toast.error("Failed to start purchase process. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const fetchUserCredits = async () => {
      if (!session?.supabaseAccessToken) {
        setLoading(false);
        return;
      }

      const supabase = supabaseClient(session.supabaseAccessToken);

      const { data, error } = await supabase
        .from("users")
        .select("credits")
        .eq("id", session.user.id)
        .single();

      if (error) {
        console.error("Error fetching user credits: " + error);
        setUserCredits(0);
      } else {
        setUserCredits(data?.credits || 0);
      }
      setLoading(false);
    };

    fetchUserCredits();
  }, [session]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Pricing</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">Pricing</h1>
        <p className="text-muted-foreground">Buy credits to create amazing video clips</p>
        {session && (
          <div className="mt-4 p-4 bg-muted rounded-lg inline-block">
            <p className="text-sm text-muted-foreground">Current Credits</p>
            <p className="text-2xl font-bold">{userCredits}</p>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {CREDIT_PACKAGES.map((pkg) => (
          <Card key={pkg.id} className={pkg.popular ? "ring-2 ring-primary" : ""}>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle>{pkg.name}</CardTitle>
                  <CardDescription>{pkg.description}</CardDescription>
                </div>
                {pkg.popular && (
                  <span className="bg-primary text-primary-foreground px-2 py-1 rounded-full text-xs font-medium">
                    Most Popular
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold mb-4">${pkg.price}</div>
              <div className="mb-6">
                <div className="text-lg font-semibold">{pkg.credits} Credits</div>
                <div className="text-sm text-muted-foreground">
                  One-time purchase
                </div>
              </div>
              <ul className="space-y-2 mb-6">
                <li className="flex items-center">
                  <span className="mr-2">✓</span>
                  AI-powered video clipping
                </li>
                <li className="flex items-center">
                  <span className="mr-2">✓</span>
                  YouTube video processing
                </li>
                <li className="flex items-center">
                  <span className="mr-2">✓</span>
                  High-quality output
                </li>
                <li className="flex items-center">
                  <span className="mr-2">✓</span>
                  Credits never expire
                </li>
              </ul>
              <Button 
                onClick={() => handlePurchase(pkg.id)} 
                disabled={isLoading} 
                className="w-full"
              >
                {isLoading ? "Processing..." : `Buy ${pkg.credits} Credits`}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-12 text-center">
        <div className="bg-muted p-6 rounded-lg max-w-2xl mx-auto">
          <h3 className="text-lg font-semibold mb-2">How Credits Work</h3>
          <p className="text-muted-foreground mb-4">
            Each minute of video you process uses 1 credit. Credits are purchased once and never expire.
            You can use them anytime to create clips from YouTube videos.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="font-semibold">1 Credit</div>
              <div className="text-muted-foreground">= 1 minute of input video.</div>
            </div>
            <div>
              <div className="font-semibold">Never Expire</div>
              <div className="text-muted-foreground">Use anytime</div>
            </div>
            <div>
              <div className="font-semibold">High Quality</div>
              <div className="text-muted-foreground">AI-powered results</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 