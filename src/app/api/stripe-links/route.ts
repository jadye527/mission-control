import { NextResponse } from 'next/server'
import { getStripePaymentLinks } from '@/lib/stripe-links'

/**
 * GET /api/stripe-links
 * Public — returns configured Stripe payment link URLs (or null if not set).
 * Safe to expose: these are payment page URLs, not secret keys.
 */
export async function GET() {
  return NextResponse.json(getStripePaymentLinks())
}
