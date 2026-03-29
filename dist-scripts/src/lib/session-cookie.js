"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_MC_SESSION_COOKIE_NAME = exports.MC_SESSION_COOKIE_NAME = void 0;
exports.getMcSessionCookieName = getMcSessionCookieName;
exports.isRequestSecure = isRequestSecure;
exports.parseMcSessionCookieHeader = parseMcSessionCookieHeader;
exports.getMcSessionCookieOptions = getMcSessionCookieOptions;
exports.MC_SESSION_COOKIE_NAME = '__Host-mc-session';
exports.LEGACY_MC_SESSION_COOKIE_NAME = 'mc-session';
const MC_SESSION_COOKIE_NAMES = [exports.MC_SESSION_COOKIE_NAME, exports.LEGACY_MC_SESSION_COOKIE_NAME];
function getMcSessionCookieName(isSecureRequest) {
    return isSecureRequest ? exports.MC_SESSION_COOKIE_NAME : exports.LEGACY_MC_SESSION_COOKIE_NAME;
}
function isRequestSecure(request) {
    return request.headers.get('x-forwarded-proto') === 'https'
        || new URL(request.url).protocol === 'https:';
}
function parseMcSessionCookieHeader(cookieHeader) {
    if (!cookieHeader)
        return null;
    for (const cookieName of MC_SESSION_COOKIE_NAMES) {
        const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`));
        if (match) {
            return decodeURIComponent(match[1]);
        }
    }
    return null;
}
function envFlag(name) {
    const raw = process.env[name];
    if (raw === undefined)
        return undefined;
    const v = String(raw).trim().toLowerCase();
    if (v === '1' || v === 'true' || v === 'yes' || v === 'on')
        return true;
    if (v === '0' || v === 'false' || v === 'no' || v === 'off')
        return false;
    return undefined;
}
function getMcSessionCookieOptions(input) {
    var _a;
    const secureEnv = envFlag('MC_COOKIE_SECURE');
    const secure = (_a = secureEnv !== null && secureEnv !== void 0 ? secureEnv : input.isSecureRequest) !== null && _a !== void 0 ? _a : false;
    return {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: input.maxAgeSeconds,
        path: '/',
    };
}
