"use server";

import { inngest } from "@/inngest/client";
import { auth } from "@/lib/auth";
import { supabaseClient } from "@/lib/supabase";
import { v4 as uuidv4 } from "uuid";

export async function processYouTubeVideo(youtubeUrl: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const supabase = supabaseClient(session.supabaseAccessToken as string);

  // Generate UUID for organizing files in S3
  const sessionUuid = uuidv4();
  const s3Key = `${sessionUuid}/original.mp4`;

  let videoTitle = "YouTube Video";
  try {
    const url = new URL(youtubeUrl);
    const videoId = url.searchParams.get("v") || url.pathname.split("/").pop();
    videoTitle = `YouTube Video (${videoId})`;
  } catch {
  }

  const { data: uploadedFileDBRecord, error } = await supabase
    .from("uploaded_files")
    .insert({
      user_id: session.user.id,
      s3_key: s3Key,  // Set s3_key upfront with UUID structure
      title: videoTitle,
      status: "processing",
      uploaded: true,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Database error:", error);
    throw new Error("Failed to create database record");
  }

  // await inngest.send({
  //   name: "clip-youtube-video-workflow",
  //   data: {
  //     uploadedFileId: uploadedFileDBRecord.id,
  //     userId: session.user.id,
  //     youtubeUrl: youtubeUrl,
  //     uuid: sessionUuid,
  //   },
  // });

  await inngest.send({
    name: "clip-video-events",
    data: {
      uploadedFileId: uploadedFileDBRecord.id,
      userId: session.user.id, 
      youtubeUrl: youtubeUrl,
      uuid: sessionUuid
    }
  });

  return { 
    success: true, 
    uploadedFileId: uploadedFileDBRecord.id 
  };
} 