"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const command_1 = require("@/lib/command");
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/openclaw/openclaw/releases/latest';
function compareSemver(a, b) {
    var _a, _b;
    const pa = a.replace(/^v/, '').split('.').map(Number);
    const pb = b.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = (_a = pa[i]) !== null && _a !== void 0 ? _a : 0;
        const nb = (_b = pb[i]) !== null && _b !== void 0 ? _b : 0;
        if (na > nb)
            return 1;
        if (na < nb)
            return -1;
    }
    return 0;
}
const headers = { 'Cache-Control': 'public, max-age=3600' };
async function GET() {
    var _a, _b, _c;
    let installed = null;
    try {
        const result = await (0, command_1.runOpenClaw)(['--version'], { timeoutMs: 3000 });
        const match = result.stdout.match(/(\d+\.\d+\.\d+)/);
        if (match)
            installed = match[1];
    }
    catch (_d) {
        // OpenClaw not installed or not reachable
        return server_1.NextResponse.json({ installed: null, latest: null, updateAvailable: false }, { headers });
    }
    if (!installed) {
        return server_1.NextResponse.json({ installed: null, latest: null, updateAvailable: false }, { headers });
    }
    try {
        const res = await fetch(GITHUB_RELEASES_URL, {
            headers: { Accept: 'application/vnd.github+json' },
            next: { revalidate: 3600 },
        });
        if (!res.ok) {
            return server_1.NextResponse.json({ installed, latest: null, updateAvailable: false }, { headers });
        }
        const release = await res.json();
        const latest = ((_a = release.tag_name) !== null && _a !== void 0 ? _a : '').replace(/^v/, '');
        const updateAvailable = compareSemver(latest, installed) > 0;
        return server_1.NextResponse.json({
            installed,
            latest,
            updateAvailable,
            releaseUrl: (_b = release.html_url) !== null && _b !== void 0 ? _b : '',
            releaseNotes: (_c = release.body) !== null && _c !== void 0 ? _c : '',
            updateCommand: 'openclaw update --channel stable',
        }, { headers });
    }
    catch (_e) {
        return server_1.NextResponse.json({ installed, latest: null, updateAvailable: false }, { headers });
    }
}
