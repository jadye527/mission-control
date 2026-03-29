"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const fs_1 = require("fs");
const path_1 = require("path");
const config_1 = require("@/lib/config");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const memory_utils_1 = require("@/lib/memory-utils");
const logger_1 = require("@/lib/logger");
const MEMORY_PATH = config_1.config.memoryDir;
const MEMORY_ALLOWED_PREFIXES = (config_1.config.memoryAllowedPrefixes || []).map((p) => p.replace(/\\/g, '/'));
function mergeReports(reports) {
    const allCategories = reports.flatMap((report) => report.categories);
    const mergedCategories = Array.from(new Set(allCategories.map((category) => category.name))).map((name) => {
        const group = allCategories.filter((category) => category.name === name);
        const score = Math.round(group.reduce((sum, category) => sum + category.score, 0) / group.length);
        const status = score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical';
        return {
            name,
            status,
            score,
            issues: group.flatMap((category) => category.issues).slice(0, 10),
            suggestions: Array.from(new Set(group.flatMap((category) => category.suggestions))),
        };
    });
    const overallScore = mergedCategories.length > 0
        ? Math.round(mergedCategories.reduce((sum, category) => sum + category.score, 0) / mergedCategories.length)
        : 100;
    const overall = overallScore >= 70 ? 'healthy' : overallScore >= 40 ? 'warning' : 'critical';
    return {
        overall,
        overallScore,
        categories: mergedCategories,
        generatedAt: Date.now(),
    };
}
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const limited = (0, rate_limit_1.readLimiter)(request);
    if (limited)
        return limited;
    if (!MEMORY_PATH) {
        return server_1.NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });
    }
    try {
        if (MEMORY_ALLOWED_PREFIXES.length) {
            const reports = [];
            for (const prefix of MEMORY_ALLOWED_PREFIXES) {
                const folder = prefix.replace(/\/$/, '');
                const fullPath = (0, path_1.join)(MEMORY_PATH, folder);
                if (!(0, fs_1.existsSync)(fullPath))
                    continue;
                reports.push(await (0, memory_utils_1.runHealthDiagnostics)(fullPath));
            }
            return server_1.NextResponse.json(reports.length > 0 ? mergeReports(reports) : await (0, memory_utils_1.runHealthDiagnostics)(MEMORY_PATH));
        }
        const report = await (0, memory_utils_1.runHealthDiagnostics)(MEMORY_PATH);
        return server_1.NextResponse.json(report);
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Memory health API error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
