"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const node_fs_1 = require("node:fs");
const auth_1 = require("@/lib/auth");
const command_1 = require("@/lib/command");
const DEFAULT_DOWNLOAD_URL = 'https://flightdeck.example.com/download';
const DEFAULT_INSTALL_PATHS = [
    '/Applications/Flight Deck.app',
    '/Applications/Flight Desk.app',
];
function getConfiguredFlightDeckPath() {
    const fromEnv = String(process.env.FLIGHT_DECK_PATH || '').trim();
    return fromEnv || null;
}
function getFlightDeckBaseUrl() {
    const fromEnv = String(process.env.FLIGHT_DECK_URL || '').trim();
    if (fromEnv)
        return fromEnv;
    return 'http://127.0.0.1:4177';
}
function getFlightDeckLaunchUrl() {
    const fromEnv = String(process.env.FLIGHT_DECK_LAUNCH_URL || '').trim();
    if (fromEnv)
        return fromEnv;
    return 'flightdeck://open';
}
function isInstalled(targetPath) {
    try {
        return (0, node_fs_1.existsSync)(targetPath) && (0, node_fs_1.statSync)(targetPath).isDirectory();
    }
    catch (_a) {
        return false;
    }
}
function resolveFlightDeckInstallPath() {
    const configured = getConfiguredFlightDeckPath();
    if (configured && isInstalled(configured))
        return configured;
    for (const candidate of DEFAULT_INSTALL_PATHS) {
        if (isInstalled(candidate))
            return candidate;
    }
    return configured;
}
/**
 * GET /api/local/flight-deck
 * Check Flight Deck local installation status.
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const installPath = resolveFlightDeckInstallPath();
    const installed = installPath ? isInstalled(installPath) : false;
    return server_1.NextResponse.json({
        installed,
        installPath: installPath || null,
        appUrl: getFlightDeckBaseUrl(),
        downloadUrl: DEFAULT_DOWNLOAD_URL,
    });
}
/**
 * POST /api/local/flight-deck
 * Build a Flight Deck URL for the selected agent/session.
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const installPath = resolveFlightDeckInstallPath();
    const installed = installPath ? isInstalled(installPath) : false;
    if (!installed) {
        return server_1.NextResponse.json({
            installed: false,
            error: 'Flight Deck is not installed locally.',
            installPath: installPath || null,
            downloadUrl: DEFAULT_DOWNLOAD_URL,
        }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const agent = typeof (body === null || body === void 0 ? void 0 : body.agent) === 'string' ? body.agent : '';
    const session = typeof (body === null || body === void 0 ? void 0 : body.session) === 'string' ? body.session : '';
    const webUrl = new URL(getFlightDeckBaseUrl());
    webUrl.searchParams.set('source', 'mission-control');
    if (agent)
        webUrl.searchParams.set('agent', agent);
    if (session)
        webUrl.searchParams.set('session', session);
    const launchUrl = new URL(getFlightDeckLaunchUrl());
    launchUrl.searchParams.set('source', 'mission-control');
    if (agent)
        launchUrl.searchParams.set('agent', agent);
    if (session)
        launchUrl.searchParams.set('session', session);
    try {
        // Launch the native app directly; pass deep-link as payload.
        await (0, command_1.runCommand)('open', ['-a', installPath, launchUrl.toString()], { timeoutMs: 10000 });
    }
    catch (error) {
        try {
            // Fallback for apps registered as URL handlers.
            await (0, command_1.runCommand)('open', [launchUrl.toString()], { timeoutMs: 10000 });
        }
        catch (fallbackError) {
            return server_1.NextResponse.json({
                installed: true,
                launched: false,
                error: (fallbackError === null || fallbackError === void 0 ? void 0 : fallbackError.message) || (error === null || error === void 0 ? void 0 : error.message) || 'Failed to launch Flight Deck app.',
                fallbackUrl: webUrl.toString(),
                downloadUrl: DEFAULT_DOWNLOAD_URL,
            }, { status: 500 });
        }
    }
    return server_1.NextResponse.json({
        installed: true,
        launched: true,
        url: webUrl.toString(),
        launchUrl: launchUrl.toString(),
    });
}
exports.dynamic = 'force-dynamic';
