"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { supabaseClient } from "@/lib/supabase";

export default function Pricing() {
  const { data: session } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [userPlan, setUserPlan] = useState("");
  const [loading, setLoading] = useState(true);

  const handleUpgrade = async () => {
    if (!session) {
      toast.error("Please sign in to subscribe");
      return;
    }

    setIsLoading(true);
    try {
      const productId = process.env.NEXT_PUBLIC_POLAR_PRODUCT_ID;

      if (!productId) {
        toast.error("Product configuration error. Please contact support.");
        return;
      }

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
      console.error("Upgrade error:", error);
      toast.error("Failed to start upgrade process. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const fetchUserPlan = async () => {
      if (!session?.supabaseAccessToken) {
        setLoading(false);
        return;
      }

      const supabase = supabaseClient(session.supabaseAccessToken);

      const { data, error } = await supabase
        .from("users")
        .select("plan")
        .eq("id", session.user.id)
        .single();

      if (error) {
        console.error("Error fetching user plan: " + error);
        setUserPlan("free");
      } else {
        setUserPlan(data?.plan || "free");
      }
      setLoading(false);
    };

    fetchUserPlan();
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
        <p className="text-muted-foreground">Choose your plan</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {/* Free Plan */}
        <Card>
          <CardHeader>
            <CardTitle>Free</CardTitle>
            <CardDescription>Perfect for trying out OmenClip</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold mb-4">$0</div>
            <div className="mb-6">
              <div className="text-lg font-semibold">60 Credits</div>
              <div className="text-sm text-muted-foreground">One-time only</div>
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
            </ul>
            <Button 
              variant="outline" 
              className="w-full" 
              disabled={userPlan === "free"}
            >
              {userPlan === "free" ? "Current Plan" : "Free Plan"}
            </Button>
          </CardContent>
        </Card>

        {/* Pro Plan */}
        <Card className="ring-2 ring-primary">
          <CardHeader>
            <CardTitle>Pro</CardTitle>
            <CardDescription>For power users</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold mb-4">$14.99</div>
            <div className="mb-6">
              <div className="text-lg font-semibold">200 Credits</div>
              <div className="text-sm text-muted-foreground">Every month</div>
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
                Priority processing
              </li>
            </ul>
            <Button 
              onClick={handleUpgrade} 
              disabled={isLoading || userPlan === "pro"} 
              className="w-full"
            >
              {isLoading ? "Processing..." : userPlan === "pro" ? "Current Plan" : "Subscribe Now"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 