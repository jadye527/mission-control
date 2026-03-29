"use strict";
/**
 * Stripe payment links for each pricing tier.
 * Set these env vars to your Stripe Payment Link URLs from the Stripe Dashboard.
 *
 * Setup:
 *   1. Go to Stripe Dashboard → Payment Links → Create link
 *   2. Set price for each tier (Starter $49/mo, Pro $149/mo, Scale $499/mo)
 *   3. Add ?prefilled_email={CHECKOUT_SESSION_EMAIL} param if desired
 *   4. Set env vars below in .env.local / production env
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStripePaymentLinks = getStripePaymentLinks;
exports.getTierHref = getTierHref;
function getStripePaymentLinks() {
    return {
        starter: process.env.STRIPE_LINK_STARTER || null,
        pro: process.env.STRIPE_LINK_PRO || null,
        scale: process.env.STRIPE_LINK_SCALE || null,
    };
}
/** Returns the payment link for a tier, or fallback to /signup if not configured */
function getTierHref(tier, fallback = '/signup') {
    const links = getStripePaymentLinks();
    return links[tier] || fallback;
}
