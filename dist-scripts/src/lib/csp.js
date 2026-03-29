"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMissionControlCsp = buildMissionControlCsp;
exports.buildNonceRequestHeaders = buildNonceRequestHeaders;
function buildMissionControlCsp(input) {
    const { nonce, googleEnabled } = input;
    return [
        `default-src 'self'`,
        `base-uri 'self'`,
        `object-src 'none'`,
        `frame-ancestors 'none'`,
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' blob:${googleEnabled ? ' https://accounts.google.com' : ''}`,
        `style-src 'self' 'unsafe-inline'`,
        `style-src-elem 'self' 'unsafe-inline'`,
        `style-src-attr 'unsafe-inline'`,
        `connect-src 'self' ws: wss: http://127.0.0.1:* http://localhost:* https://cdn.jsdelivr.net`,
        `img-src 'self' data: blob:${googleEnabled ? ' https://*.googleusercontent.com https://lh3.googleusercontent.com' : ''}`,
        `font-src 'self' data:`,
        `frame-src 'self'${googleEnabled ? ' https://accounts.google.com' : ''}`,
        `worker-src 'self' blob:`,
    ].join('; ');
}
function buildNonceRequestHeaders(input) {
    const requestHeaders = new Headers(input.headers);
    const csp = buildMissionControlCsp({ nonce: input.nonce, googleEnabled: input.googleEnabled });
    requestHeaders.set('x-nonce', input.nonce);
    requestHeaders.set('Content-Security-Policy', csp);
    return requestHeaders;
}
