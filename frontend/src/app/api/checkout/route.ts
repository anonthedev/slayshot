import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getCreditPackage } from '@/lib/payments';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const body = await request.json();
    const creditPackage = getCreditPackage(body.productId);

    if (!creditPackage?.id) {
      return NextResponse.json({ error: 'Invalid product' }, { status: 400 });
    }

    if (!process.env.POLAR_ACCESS_TOKEN) {
      console.error('POLAR_ACCESS_TOKEN is not configured');
      return NextResponse.json({ error: 'Payments are unavailable' }, { status: 503 });
    }

    const polarServer = process.env.POLAR_SERVER;
    if (polarServer !== 'sandbox' && polarServer !== 'production') {
      console.error('POLAR_SERVER must be sandbox or production');
      return NextResponse.json({ error: 'Payments are unavailable' }, { status: 503 });
    }

    const polarApiUrl =
      polarServer === 'production'
        ? 'https://api.polar.sh/v1/checkouts/'
        : 'https://sandbox-api.polar.sh/v1/checkouts/';

    const baseUrl =
      process.env.APP_URL ??
      (process.env.NODE_ENV === 'development'
        ? `${request.nextUrl.protocol}//${request.nextUrl.host}`
        : null);

    if (!baseUrl) {
      console.error('APP_URL is not configured');
      return NextResponse.json({ error: 'Payments are unavailable' }, { status: 503 });
    }

    const checkoutData = {
      products: [creditPackage.id],
      success_url: `${baseUrl}/confirmation?checkout_id={CHECKOUT_ID}`,
      customer_email: session.user.email,
      metadata: {
        user_id: session.user.id,
        product_id: creditPackage.id,
      }
    };

    const polarResponse = await fetch(polarApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.POLAR_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(checkoutData),
      cache: 'no-store',
    });

    if (!polarResponse.ok) {
      const error = await polarResponse.json();
      console.error('Polar API error:', error);
      return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
    }

    const checkout = await polarResponse.json();

    return NextResponse.json({
      checkoutUrl: checkout.url,
      checkoutId: checkout.id,
    });

  } catch (error) {
    console.error('Checkout creation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 