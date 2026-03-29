"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyGoogleIdToken = verifyGoogleIdToken;
async function verifyGoogleIdToken(idToken) {
    const token = String(idToken || '').trim();
    if (!token) {
        throw new Error('Missing Google credential');
    }
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
        throw new Error('Invalid Google token');
    }
    const payload = await res.json();
    const audExpected = String(process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim();
    if (audExpected && payload.aud !== audExpected) {
        throw new Error('Google token audience mismatch');
    }
    if (!payload.email || !payload.sub) {
        throw new Error('Google token missing required identity fields');
    }
    if (!(payload.email_verified === true || payload.email_verified === 'true')) {
        throw new Error('Google email is not verified');
    }
    return payload;
}
