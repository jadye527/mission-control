"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const stripe_links_1 = require("@/lib/stripe-links");
/**
 * GET /api/stripe-links
 * Public — returns configured Stripe payment link URLs (or null if not set).
 * Safe to expose: these are payment page URLs, not secret keys.
 */
async function GET() {
    return server_1.NextResponse.json((0, stripe_links_1.getStripePaymentLinks)());
}
