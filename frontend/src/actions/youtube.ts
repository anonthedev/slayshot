"use server";

import { inngest } from "@/inngest/client";
import { auth } from "@/lib/auth";
import { supabaseClient } from "@/lib/supabase";
import {
  LAYOUT_OPTIONS,
  BAIT_VIDEO_OPTIONS,
  LayoutType,
  BaitVideoType,
} from "@/lib/constants";
import {
  calculateRequiredCredits,
  validateProcessingRange,
} from "@/lib/credits";
import { getYouTubeVideoDetails } from "@/lib/youtube";
import { v4 as uuidv4 } from "uuid";

export async function processYouTubeVideo(youtubeUrl: string, startTime: number, endTime: number, layout: LayoutType = "full", baitVideo: BaitVideoType = "minecraft_night") {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  if (!LAYOUT_OPTIONS.some((option) => option.value === layout)) {
    throw new Error("Invalid video layout");
  }

  if (!BAIT_VIDEO_OPTIONS.some((option) => option.value === baitVideo)) {
    throw new Error("Invalid bait video");
  }

  const supabase = supabaseClient(session.supabaseAccessToken as string);

  // Generate UUID for organizing files in S3
  const sessionUuid = uuidv4();
  const s3Key = `${sessionUuid}/original.mp4`;

  let videoDetails: Awaited<ReturnType<typeof getYouTubeVideoDetails>>;
  try {
    videoDetails = await getYouTubeVideoDetails(youtubeUrl);
    validateProcessingRange(startTime, endTime, videoDetails.duration);
  } catch (error) {
    console.error("Error fetching video metadata:", error);
    throw new Error("Could not validate the requested video");
  }

  const requiredCredits = calculateRequiredCredits(startTime, endTime, layout);
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("credits")
    .eq("id", session.user.id)
    .single();

  if (userError || Number(user?.credits ?? 0) < requiredCredits) {
    throw new Error("Insufficient credits");
  }

  const { data: uploadedFileDBRecord, error } = await supabase
    .from("uploaded_files")
    .insert({
      user_id: session.user.id,
      s3_key: s3Key,
      title: videoDetails.title,
      thumbnail: videoDetails.thumbnail,
      status: "processing",
      uploaded: true,
      start_time: startTime,
      end_time: endTime,
      source_url: videoDetails.url,
      layout: layout,
      bait_video: baitVideo
    })
    .select("id")
    .single();

  if (error) {
    console.error("Database error:", error);
    throw new Error("Failed to create database record");
  }

  await inngest.send({
    name: "clip-video-events",
    data: {
      uploadedFileId: uploadedFileDBRecord.id,
      userId: session.user.id,
    }
  });

  return { 
    success: true, 
    uploadedFileId: uploadedFileDBRecord.id 
  };
} 