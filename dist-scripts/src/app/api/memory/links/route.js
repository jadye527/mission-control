"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const config_1 = require("@/lib/config");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const memory_utils_1 = require("@/lib/memory-utils");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const logger_1 = require("@/lib/logger");
const MEMORY_PATH = config_1.config.memoryDir;
async function GET(request) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const limited = (0, rate_limit_1.readLimiter)(request);
    if (limited)
        return limited;
    if (!MEMORY_PATH) {
        return server_1.NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });
    }
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('file');
    try {
        if (filePath) {
            // Return links for a specific file
            const fullPath = (0, path_1.join)(MEMORY_PATH, filePath);
            // Basic path traversal check
            if (!fullPath.startsWith(MEMORY_PATH)) {
                return server_1.NextResponse.json({ error: 'Invalid path' }, { status: 400 });
            }
            const content = await (0, promises_1.readFile)(fullPath, 'utf-8');
            const links = (0, memory_utils_1.extractWikiLinks)(content);
            // Also find backlinks from the full graph
            const graph = await (0, memory_utils_1.buildLinkGraph)(MEMORY_PATH);
            const node = graph.nodes[filePath];
            const incoming = (_a = node === null || node === void 0 ? void 0 : node.incoming) !== null && _a !== void 0 ? _a : [];
            const outgoing = (_b = node === null || node === void 0 ? void 0 : node.outgoing) !== null && _b !== void 0 ? _b : [];
            return server_1.NextResponse.json({
                file: filePath,
                wikiLinks: links,
                outgoing,
                incoming,
            });
        }
        // Return full link graph
        const graph = await (0, memory_utils_1.buildLinkGraph)(MEMORY_PATH);
        // Serialize for the frontend (strip wikiLinks detail for the full graph)
        const nodes = Object.values(graph.nodes).map((n) => ({
            path: n.path,
            name: n.name,
            outgoing: n.outgoing,
            incoming: n.incoming,
            linkCount: n.outgoing.length + n.incoming.length,
            hasSchema: n.schema !== null,
        }));
        return server_1.NextResponse.json({
            nodes,
            totalFiles: graph.totalFiles,
            totalLinks: graph.totalLinks,
            orphans: graph.orphans,
        });
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Memory links API error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
