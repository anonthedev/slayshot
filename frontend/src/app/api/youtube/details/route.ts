import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getYouTubeVideoDetails } from '@/lib/youtube';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { url } = await request.json();

    if (typeof url !== 'string' || !url) {
      return NextResponse.json({ error: 'YouTube URL is required' }, { status: 400 });
    }

    return NextResponse.json(await getYouTubeVideoDetails(url));

  } catch (err) {
    console.error('Error extracting video metadata:', err);
    return NextResponse.json({ error: 'Could not fetch video metadata' }, { status: 400 });
  }
}
