"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const node_fs_1 = require("node:fs");
const version_1 = require("@/lib/version");
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/builderz-labs/mission-control/releases/latest';
/** Simple semver compare: returns 1 if a > b, -1 if a < b, 0 if equal. */
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
async function GET() {
    var _a, _b, _c;
    try {
        const res = await fetch(GITHUB_RELEASES_URL, {
            headers: { Accept: 'application/vnd.github+json' },
            next: { revalidate: 3600 }, // ISR cache for 1 hour
        });
        if (!res.ok) {
            return server_1.NextResponse.json({ updateAvailable: false, currentVersion: version_1.APP_VERSION }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
        }
        const release = await res.json();
        const latestVersion = ((_a = release.tag_name) !== null && _a !== void 0 ? _a : '').replace(/^v/, '');
        const updateAvailable = compareSemver(latestVersion, version_1.APP_VERSION) > 0;
        const deploymentMode = (0, node_fs_1.existsSync)('/.dockerenv') ? 'docker' : 'bare-metal';
        return server_1.NextResponse.json({
            updateAvailable,
            currentVersion: version_1.APP_VERSION,
            latestVersion,
            releaseUrl: (_b = release.html_url) !== null && _b !== void 0 ? _b : '',
            releaseNotes: (_c = release.body) !== null && _c !== void 0 ? _c : '',
            deploymentMode,
        }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
    }
    catch (_d) {
        // Network error — fail gracefully
        return server_1.NextResponse.json({ updateAvailable: false, currentVersion: version_1.APP_VERSION }, { headers: { 'Cache-Control': 'public, max-age=600' } });
    }
}
