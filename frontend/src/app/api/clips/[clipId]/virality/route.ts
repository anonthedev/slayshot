import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Create a Supabase client with service role for server-side operations
const createServiceClient = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );
};

export async function GET(
  request: NextRequest,
  { params }: { params: { clipId: string } }
) {
  try {
    const clipId = params.clipId;

    if (!clipId) {
      return NextResponse.json(
        { success: false, error: "clipId is required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("clips")
      .select("virality_score")
      .eq("id", clipId)
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: "Clip not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      virality_score: data.virality_score,
    });
  } catch (error) {
    console.error("Error fetching virality score:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch virality score" },
      { status: 500 }
    );
  }
} 