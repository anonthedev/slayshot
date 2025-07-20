import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.YOUTUBE_API_KEY;

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'YouTube URL is required' }, { status: 400 });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
    }

    const metadata = await fetchVideoMetadata(videoId);
    if (!metadata) {
      return NextResponse.json({ error: 'Failed to fetch video metadata' }, { status: 500 });
    }

    return NextResponse.json({
      url,
      id: videoId,
      title: metadata.title,
      duration: metadata.durationSeconds,
      thumbnail: metadata.thumbnail,
    });

  } catch (err) {
    console.error('Error extracting video metadata:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?.*v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match?.[1] ?? null;
}

async function fetchVideoMetadata(videoId: string) {
  const endpoint = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${API_KEY}&part=snippet,contentDetails`;

  const res = await fetch(endpoint);
  if (!res.ok) return null;

  const json = await res.json();

  const video = json.items?.[0];
  if (!video) return null;

  const duration = parseISO8601Duration(video.contentDetails.duration);
  const title = video.snippet.title;
  const thumbnails = video.snippet.thumbnails;

  const thumbnail = thumbnails.maxres?.url ||
                    thumbnails.standard?.url ||
                    thumbnails.high?.url ||
                    thumbnails.medium?.url ||
                    thumbnails.default?.url ||
                    null;

  return { title, durationSeconds: duration, thumbnail };
}

// Parses ISO8601 duration like PT1H2M10S → seconds
function parseISO8601Duration(duration: string): number {
  const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
  const match = duration.match(regex);

  if (!match) return 0;

  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0');
  const seconds = parseInt(match[3] || '0');

  return hours * 3600 + minutes * 60 + seconds;
}
