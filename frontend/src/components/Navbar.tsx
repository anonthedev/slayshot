"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { supabaseClient } from "@/lib/supabase";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";

export default function Navbar() {
  const { data: session } = useSession();
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userImage, setUserImage] = useState("");

  useEffect(() => {
    const fetchUserData = async () => {
      if (!session?.supabaseAccessToken) return;

      const supabase = supabaseClient(session.supabaseAccessToken);

      const { data, error } = await supabase
        .from("users")
        .select("credits, image")
        .eq("id", session.user.id)
        .single();

      if (error) {
        console.error("Error fetching user data: " + error);
        setLoading(false);
        return;
      }

      if (data) {
        setCredits(data.credits || 0);
        setUserImage(data.image || "");
      }
      setLoading(false);
    };

    fetchUserData();
  }, [session]);

  return (
    <nav className="w-full flex items-center justify-between py-4 px-6 border-b">
      <div className="font-bold text-xl">slayshot</div>

      <div className="flex items-center gap-4">
        <Link href="/pricing">
          <Button variant="ghost">Pricing</Button>
        </Link>

        {session && (
        <div className="flex items-center gap-4">
          {loading ? (
            <>
              <Skeleton className="h-5 w-24 rounded" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </>
          ) : (
            <>
              <div className="text-sm">Credits: {credits}</div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Avatar className="cursor-pointer">
                    {userImage ? (
                      <AvatarImage src={userImage} alt="User" />
                    ) : (
                      <AvatarFallback>
                        {session.user?.name?.charAt(0) ||
                          session.user?.email?.charAt(0)?.toUpperCase() ||
                          "U"}
                      </AvatarFallback>
                    )}
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => signOut({ redirectTo: "/login" })}
                  >
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      )}
      </div>
    </nav>
  );
}
