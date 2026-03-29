"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.proxy = proxy;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_os_1 = __importDefault(require("node:os"));
const server_1 = require("next/server");
const csp_1 = require("@/lib/csp");
const session_cookie_1 = require("@/lib/session-cookie");
/** Constant-time string comparison using Node.js crypto. */
function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string')
        return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length)
        return false;
    return node_crypto_1.default.timingSafeEqual(bufA, bufB);
}
function envFlag(name) {
    const raw = process.env[name];
    if (raw === undefined)
        return false;
    const v = String(raw).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
function normalizeHostname(raw) {
    return raw.trim().replace(/^\[|\]$/g, '').split(':')[0].replace(/\.$/, '').toLowerCase();
}
function parseForwardedHost(forwarded) {
    if (!forwarded)
        return [];
    const hosts = [];
    for (const part of forwarded.split(',')) {
        const match = /(?:^|;)\s*host="?([^";]+)"?/i.exec(part);
        if (match === null || match === void 0 ? void 0 : match[1])
            hosts.push(match[1]);
    }
    return hosts;
}
function getRequestHostCandidates(request) {
    const rawCandidates = [
        ...(request.headers.get('x-forwarded-host') || '').split(','),
        ...(request.headers.get('x-original-host') || '').split(','),
        ...(request.headers.get('x-forwarded-server') || '').split(','),
        ...parseForwardedHost(request.headers.get('forwarded')),
        request.headers.get('host') || '',
        request.nextUrl.host || '',
        request.nextUrl.hostname || '',
    ];
    const candidates = rawCandidates
        .map(normalizeHostname)
        .filter(Boolean);
    return [...new Set(candidates)];
}
function getImplicitAllowedHosts() {
    const candidates = [
        'localhost',
        '127.0.0.1',
        '::1',
        normalizeHostname(node_os_1.default.hostname()),
    ].filter(Boolean);
    return [...new Set(candidates)];
}
function hostMatches(pattern, hostname) {
    const p = normalizeHostname(pattern);
    const h = normalizeHostname(hostname);
    if (!p || !h)
        return false;
    // "*.example.com" matches "a.example.com" (but not bare "example.com")
    if (p.startsWith('*.')) {
        const suffix = p.slice(2);
        return h.endsWith(`.${suffix}`);
    }
    // "100.*" matches "100.64.0.1"
    if (p.endsWith('.*')) {
        const prefix = p.slice(0, -1);
        return h.startsWith(prefix);
    }
    return h === p;
}
function nextResponseWithNonce(request) {
    const nonce = node_crypto_1.default.randomBytes(16).toString('base64');
    const googleEnabled = !!(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID);
    const requestHeaders = (0, csp_1.buildNonceRequestHeaders)({
        headers: request.headers,
        nonce,
        googleEnabled,
    });
    const response = server_1.NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });
    return { response, nonce };
}
function addSecurityHeaders(response, _request, nonce) {
    const requestId = node_crypto_1.default.randomUUID();
    response.headers.set('X-Request-Id', requestId);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    const googleEnabled = !!(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID);
    const effectiveNonce = nonce || node_crypto_1.default.randomBytes(16).toString('base64');
    response.headers.set('Content-Security-Policy', (0, csp_1.buildMissionControlCsp)({ nonce: effectiveNonce, googleEnabled }));
    return response;
}
function extractApiKeyFromRequest(request) {
    const direct = (request.headers.get('x-api-key') || '').trim();
    if (direct)
        return direct;
    const authorization = (request.headers.get('authorization') || '').trim();
    if (!authorization)
        return '';
    const [scheme, ...rest] = authorization.split(/\s+/);
    if (!scheme || rest.length === 0)
        return '';
    const normalized = scheme.toLowerCase();
    if (normalized === 'bearer' || normalized === 'apikey' || normalized === 'token') {
        return rest.join(' ').trim();
    }
    return '';
}
function proxy(request) {
    var _a, _b, _c, _d;
    const { pathname } = request.nextUrl;
    // Skip static assets — let Next.js serve them directly
    if (pathname.startsWith('/_next/static') || pathname.startsWith('/_next/image') || pathname === '/favicon.ico' || pathname.startsWith('/brand/')) {
        return server_1.NextResponse.next();
    }
    // Network access control.
    // In production: default-deny unless explicitly allowed.
    // In dev/test: allow all hosts unless overridden.
    const requestHosts = getRequestHostCandidates(request);
    const allowAnyHost = envFlag('MC_ALLOW_ANY_HOST') || process.env.NODE_ENV !== 'production';
    const allowedPatterns = String(process.env.MC_ALLOWED_HOSTS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const implicitAllowedHosts = getImplicitAllowedHosts();
    const enforceAllowlist = !allowAnyHost && allowedPatterns.length > 0;
    const isAllowedHost = !enforceAllowlist
        || requestHosts.some((hostName) => implicitAllowedHosts.some((candidate) => hostMatches(candidate, hostName))
            || allowedPatterns.some((pattern) => hostMatches(pattern, hostName)));
    if (!isAllowedHost) {
        return addSecurityHeaders(new server_1.NextResponse('Forbidden', { status: 403 }), request);
    }
    // CSRF Origin validation for mutating requests
    const method = request.method.toUpperCase();
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        const origin = request.headers.get('origin');
        if (origin) {
            let originHost;
            try {
                originHost = new URL(origin).host;
            }
            catch (_e) {
                originHost = '';
            }
            const requestHost = ((_b = (_a = request.headers.get('host')) === null || _a === void 0 ? void 0 : _a.split(',')[0]) === null || _b === void 0 ? void 0 : _b.trim())
                || request.nextUrl.host
                || '';
            if (originHost && requestHost && originHost !== requestHost) {
                return addSecurityHeaders(server_1.NextResponse.json({ error: 'CSRF origin mismatch' }, { status: 403 }), request);
            }
        }
    }
    // Allow login, setup, auth API, docs, and container health probe without session
    const isPublicHealthProbe = pathname === '/api/status' && request.nextUrl.searchParams.get('action') === 'health';
    if (pathname === '/login' || pathname === '/register' || pathname === '/setup' || pathname.startsWith('/api/auth/') || pathname.startsWith('/api/v1/auth/') || pathname === '/api/setup' || pathname === '/api/docs' || pathname === '/docs' || isPublicHealthProbe) {
        const { response, nonce } = nextResponseWithNonce(request);
        return addSecurityHeaders(response, request, nonce);
    }
    // Check for session cookie
    const sessionToken = ((_c = request.cookies.get(session_cookie_1.MC_SESSION_COOKIE_NAME)) === null || _c === void 0 ? void 0 : _c.value) || ((_d = request.cookies.get(session_cookie_1.LEGACY_MC_SESSION_COOKIE_NAME)) === null || _d === void 0 ? void 0 : _d.value);
    // API routes: accept session cookie OR API key
    if (pathname.startsWith('/api/')) {
        const configuredApiKey = (process.env.API_KEY || '').trim();
        const apiKey = extractApiKeyFromRequest(request);
        const hasValidApiKey = Boolean(configuredApiKey && apiKey && safeCompare(apiKey, configuredApiKey));
        // Agent-scoped keys are validated in route auth (DB-backed) and should be
        // allowed to pass through proxy auth gate.
        const looksLikeAgentApiKey = /^mca_[a-f0-9]{48}$/i.test(apiKey);
        const looksLikeUserApiKey = /^mcu_[a-f0-9]{48}$/i.test(apiKey);
        if (sessionToken || hasValidApiKey || looksLikeAgentApiKey || looksLikeUserApiKey) {
            const { response, nonce } = nextResponseWithNonce(request);
            return addSecurityHeaders(response, request, nonce);
        }
        return addSecurityHeaders(server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), request);
    }
    // Page routes: redirect to login if no session
    if (sessionToken) {
        const { response, nonce } = nextResponseWithNonce(request);
        return addSecurityHeaders(response, request, nonce);
    }
    // Redirect to login
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return addSecurityHeaders(server_1.NextResponse.redirect(loginUrl), request);
}
exports.config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/).*)']
};
