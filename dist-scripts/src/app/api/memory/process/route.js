"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const config_1 = require("@/lib/config");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const memory_utils_1 = require("@/lib/memory-utils");
const logger_1 = require("@/lib/logger");
const MEMORY_PATH = config_1.config.memoryDir;
/**
 * Processing pipeline endpoint — runs knowledge maintenance operations.
 * Actions: reflect, reweave, generate-moc
 *
 * These mirror Ars Contexta's 6 Rs processing pipeline, adapted for MC:
 * - reflect: Find connection opportunities between files
 * - reweave: Identify stale files needing updates from newer linked files
 * - generate-moc: Auto-generate Maps of Content from file clusters
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    if (!MEMORY_PATH) {
        return server_1.NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });
    }
    try {
        const body = await request.json();
        const { action } = body;
        if (action === 'reflect') {
            const result = await (0, memory_utils_1.reflectPass)(MEMORY_PATH);
            return server_1.NextResponse.json(result);
        }
        if (action === 'reweave') {
            const result = await (0, memory_utils_1.reweavePass)(MEMORY_PATH);
            return server_1.NextResponse.json(result);
        }
        if (action === 'generate-moc') {
            const mocs = await (0, memory_utils_1.generateMOCs)(MEMORY_PATH);
            return server_1.NextResponse.json({
                action: 'generate-moc',
                groups: mocs,
                totalGroups: mocs.length,
                totalEntries: mocs.reduce((s, g) => s + g.entries.length, 0),
            });
        }
        return server_1.NextResponse.json({ error: 'Invalid action. Use: reflect, reweave, generate-moc' }, { status: 400 });
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Memory process API error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
