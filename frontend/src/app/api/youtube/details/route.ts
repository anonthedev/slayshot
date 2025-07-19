import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

// Promisify exec to use async/await
const execAsync = promisify(exec);

// ESM workaround for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to cookies.txt inside the .secure folder
const cookiesPath = path.resolve(__dirname, '../../../.secure/cookies.txt');

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'YouTube URL is required' }, { status: 400 });
    }

    const metadata = await getVideoMetadata(url);

    if (!metadata) {
      return NextResponse.json({ error: 'Failed to extract video metadata' }, { status: 500 });
    }

    const { id, title, duration, thumbnails } = metadata;

    return NextResponse.json({
      url,
      id,
      title,
      duration,
      thumbnail: getBestThumbnail(thumbnails),
    });

  } catch (err) {
    console.error('Error extracting video metadata:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getVideoMetadata(videoUrl: string, timeoutMs = 25000) {
  const command = `yt-dlp -j --no-playlist --skip-download --cookies "${cookiesPath}" "${videoUrl}"`;

  try {
    const { stdout } = await execAsync(command, { timeout: timeoutMs });
    return JSON.parse(stdout);
  } catch (err: any) {
    console.error('yt-dlp error:', err.stderr || err.message);
    return null;
  }
}

function getBestThumbnail(thumbnails: any[]): string | null {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  return thumbnails[thumbnails.length - 1]?.url || null;
}
