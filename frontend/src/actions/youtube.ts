"use server";

import { inngest } from "@/inngest/client";
import { auth } from "@/lib/auth";
import { supabaseClient } from "@/lib/supabase";
import { v4 as uuidv4 } from "uuid";

// Extracts YouTube video ID from any valid YouTube URL
function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("youtu.be")) {
      return parsed.pathname.split("/").filter(Boolean)[0] || null;
    }
    if (
      parsed.hostname.endsWith("youtube.com") ||
      parsed.hostname.endsWith("m.youtube.com")
    ) {
      if (parsed.pathname === "/watch" && parsed.searchParams.get("v")) {
        return parsed.searchParams.get("v");
      }
      const match = parsed.pathname.match(
        /\/(embed|v|shorts)\/([a-zA-Z0-9_-]{11})/
      );
      if (match) {
        return match[2];
      }
    }
    const fallback = url.match(/[a-zA-Z0-9_-]{11}/);
    return fallback ? fallback[0] : null;
  } catch {
    return null;
  }
}

export async function processYouTubeVideo(youtubeUrl: string, startTime: number, endTime: number) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const supabase = supabaseClient(session.supabaseAccessToken as string);

  // Generate UUID for organizing files in S3
  const sessionUuid = uuidv4();
  const s3Key = `${sessionUuid}/original.mp4`;

  // Fetch video metadata to get actual title and thumbnail
  let videoTitle = "YouTube Video";
  let videoThumbnail = null;
  let videoId = null;
  
  try {
    videoId = extractYouTubeVideoId(youtubeUrl);
    if (videoId) {
      // Fetch video details from YouTube API
      const videoDetailsResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/youtube/details`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: youtubeUrl }),
      });
      
      if (videoDetailsResponse.ok) {
        const videoDetails = await videoDetailsResponse.json();
        videoTitle = videoDetails.title || `YouTube Video (${videoId})`;
        videoThumbnail = videoDetails.thumbnail;
      } else {
        // Fallback to ID-based title if API call fails
        videoTitle = `YouTube Video (${videoId})`;
      }
    }
  } catch (error) {
    console.error("Error fetching video metadata:", error);
    // Fallback to ID-based title if any error occurs
    if (videoId) {
      videoTitle = `YouTube Video (${videoId})`;
    }
  }

  const { data: uploadedFileDBRecord, error } = await supabase
    .from("uploaded_files")
    .insert({
      user_id: session.user.id,
      s3_key: s3Key,
      title: videoTitle,
      thumbnail: videoThumbnail,
      status: "processing",
      uploaded: true,
      start_time: startTime,
      end_time: endTime,
      source_url: youtubeUrl
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
      uuid: sessionUuid,
      startTime,
      endTime,
    }
  });

  return { 
    success: true, 
    uploadedFileId: uploadedFileDBRecord.id 
  };
} 