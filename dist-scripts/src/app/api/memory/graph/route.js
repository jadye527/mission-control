"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const config_1 = require("@/lib/config");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const memoryDbDir = config_1.config.openclawStateDir
    ? path_1.default.join(config_1.config.openclawStateDir, 'memory')
    : '';
function getAgentData(dbPath, agentName) {
    try {
        const dbStat = (0, fs_1.statSync)(dbPath);
        const db = new better_sqlite3_1.default(dbPath, { readonly: true, fileMustExist: true });
        let files = [];
        let totalChunks = 0;
        let totalFiles = 0;
        try {
            // Check if chunks table exists
            const tableCheck = db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'")
                .get();
            if (tableCheck) {
                // Use COUNT only — skip SUM(LENGTH(text)) which forces a full data scan
                const rows = db
                    .prepare('SELECT path, COUNT(*) as chunks FROM chunks GROUP BY path ORDER BY chunks DESC')
                    .all();
                files = rows.map((r) => ({
                    path: r.path || '(unknown)',
                    chunks: r.chunks,
                    textSize: 0,
                }));
                totalChunks = files.reduce((sum, f) => sum + f.chunks, 0);
                totalFiles = files.length;
            }
        }
        finally {
            db.close();
        }
        return {
            name: agentName,
            dbSize: dbStat.size,
            totalChunks,
            totalFiles,
            files,
        };
    }
    catch (err) {
        logger_1.logger.warn(`Failed to read memory DB for agent "${agentName}": ${err}`);
        return null;
    }
}
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const limited = (0, rate_limit_1.readLimiter)(request);
    if (limited)
        return limited;
    if (!memoryDbDir || !(0, fs_1.existsSync)(memoryDbDir)) {
        return server_1.NextResponse.json({ error: 'Memory directory not available', agents: [] }, { status: 404 });
    }
    const agentFilter = request.nextUrl.searchParams.get('agent') || 'all';
    try {
        const entries = (0, fs_1.readdirSync)(memoryDbDir).filter((f) => f.endsWith('.sqlite'));
        const agents = [];
        for (const entry of entries) {
            const agentName = entry.replace('.sqlite', '');
            if (agentFilter !== 'all' && agentName !== agentFilter)
                continue;
            const dbPath = path_1.default.join(memoryDbDir, entry);
            const data = getAgentData(dbPath, agentName);
            if (data)
                agents.push(data);
        }
        // Sort by total chunks descending
        agents.sort((a, b) => b.totalChunks - a.totalChunks);
        return server_1.NextResponse.json({ agents });
    }
    catch (err) {
        logger_1.logger.error(`Failed to build memory graph data: ${err}`);
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
