import { NextRequest, NextResponse } from 'next/server';
import ytdl from '@distube/ytdl-core';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url || !ytdl.validateURL(url)) {
      return NextResponse.json({ error: 'Valid YouTube URL is required' }, { status: 400 });
    }

    const info = await ytdl.getInfo(url);
    const { videoDetails } = info;

    const metadata = {
      url,
      id: videoDetails.videoId,
      title: videoDetails.title,
      duration: parseInt(videoDetails.lengthSeconds, 10),
      thumbnail: getBestThumbnail(videoDetails.thumbnails),
    };

    return NextResponse.json(metadata);
  } catch (err) {
    console.error('Error extracting video metadata:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function getBestThumbnail(thumbnails: ytdl.thumbnail[] = []): string | null {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  return thumbnails[thumbnails.length - 1].url || null;
}
