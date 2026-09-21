import "server-only";

import { extractYouTubeVideoId } from "@/lib/youtube-url";

export { extractYouTubeVideoId } from "@/lib/youtube-url";

export type YouTubeVideoDetails = {
  id: string;
  title: string;
  duration: number;
  thumbnail: string | null;
  url: string;
};

export async function getYouTubeVideoDetails(
  value: string,
): Promise<YouTubeVideoDetails> {
  const videoId = extractYouTubeVideoId(value);
  if (!videoId) throw new Error("Invalid YouTube URL");

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not configured");

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("id", videoId);
  endpoint.searchParams.set("key", apiKey);
  endpoint.searchParams.set("part", "snippet,contentDetails");

  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`YouTube API request failed with ${response.status}`);
  }

  const payload = await response.json();
  const video = payload.items?.[0];
  if (!video) throw new Error("YouTube video was not found");

  const thumbnails = video.snippet.thumbnails;
  const thumbnail =
    thumbnails.maxres?.url ??
    thumbnails.standard?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    null;

  return {
    id: videoId,
    title: video.snippet.title,
    duration: parseIso8601Duration(video.contentDetails.duration),
    thumbnail,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function parseIso8601Duration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) throw new Error("YouTube returned an invalid duration");

  const hours = Number.parseInt(match[1] ?? "0", 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  const seconds = Number.parseInt(match[3] ?? "0", 10);

  return hours * 3600 + minutes * 60 + seconds;
}
