import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(request: NextRequest) {
  try {
    const { clipId, s3Key } = await request.json();

    if (!clipId || !s3Key) {
      return NextResponse.json(
        { success: false, error: "clipId and s3Key are required" },
        { status: 400 }
      );
    }

    // Trigger the Inngest function
    await inngest.send({
      name: "calculate-clip-virality",
      data: {
        clipId,
        s3Key,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Virality calculation started",
    });
  } catch (error) {
    console.error("Error triggering virality calculation:", error);
    return NextResponse.json(
      { success: false, error: "Failed to start virality calculation" },
      { status: 500 }
    );
  }
} 