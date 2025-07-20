import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseClient } from "@/lib/supabase";

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = supabaseClient(session.supabaseAccessToken as string);

    const { data, error } = await supabase
      .from("users")
      .select("credits")
      .eq("id", session.user.id)
      .single();

    if (error) {
      console.error("Error fetching user credits:", error);
      return NextResponse.json(
        { error: "Failed to fetch user credits" },
        { status: 500 }
      );
    }

    return NextResponse.json({ credits: data?.credits || 0 });
  } catch (error) {
    console.error("Error in credits API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
} 