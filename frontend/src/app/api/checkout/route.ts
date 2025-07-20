import { NextRequest, NextResponse } from 'next/server';
import { Checkout } from '@polar-sh/nextjs';
import { auth } from '@/lib/auth';

// Use sandbox for testing, production for live
const POLAR_API_URL = process.env.NODE_ENV === 'production' 
  ? 'https://api.polar.sh/v1/checkouts/'
  : 'https://sandbox-api.polar.sh/v1/checkouts/';

// Use the official Polar adapter for checkout creation
export const GET = Checkout({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  successUrl: process.env.NEXT_PUBLIC_BASE_URL 
    ? `${process.env.NEXT_PUBLIC_BASE_URL}/confirmation`
    : 'http://localhost:3000/confirmation',
});

// POST method for credit package purchases
export async function POST(request: NextRequest) {
  try {
    // Check if user is authenticated
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const body = await request.json();
    const { productId } = body;

    if (!productId) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    // Construct base URL from request if environment variable is not set
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
      `${request.nextUrl.protocol}//${request.nextUrl.host}`;

    // Create checkout session with Polar for credit purchase
    const checkoutData = {
      products: [productId],
      success_url: `${baseUrl}/confirmation`,
      customer_email: session.user.email,
      metadata: {
        user_id: session.user.id,
        user_email: session.user.email,
        user_name: session.user.name || '',
        product_id: productId // Store product ID in metadata for webhook processing
      }
    };

    const polarResponse = await fetch(POLAR_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.POLAR_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(checkoutData)
    });

    if (!polarResponse.ok) {
      const error = await polarResponse.json();
      console.error('Polar API error:', error);
      return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
    }

    const checkout = await polarResponse.json();
    
    return NextResponse.json({ 
      checkoutUrl: checkout.url,
      checkoutId: checkout.id 
    });

  } catch (error) {
    console.error('Checkout creation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 