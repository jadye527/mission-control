"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const logger_1 = require("@/lib/logger");
const security_scan_1 = require("@/lib/security-scan");
function isFixableInScope(checkId, scope, force) {
    const safety = security_scan_1.FIX_SAFETY[checkId];
    if (!safety)
        return false;
    if (safety === 'safe')
        return true;
    if (safety === 'requires-restart' && (scope === 'safe+restart' || scope === 'all'))
        return true;
    if (safety === 'requires-review' && scope === 'all' && force)
        return true;
    return false;
}
async function POST(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    let body;
    try {
        body = await request.json();
    }
    catch (_b) {
        return server_1.NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { action, fixScope = 'safe+restart', ids, force = false, dryRun = false } = body;
    if (!action || !['scan', 'fix', 'scan-and-fix'].includes(action)) {
        return server_1.NextResponse.json({ error: 'action must be "scan", "fix", or "scan-and-fix"' }, { status: 400 });
    }
    try {
        // Always scan first
        const scanResult = (0, security_scan_1.runSecurityScan)();
        const allChecks = Object.values(scanResult.categories).flatMap(c => c.checks);
        const failingChecks = allChecks.filter(c => c.status !== 'pass');
        const scanResponse = {
            overall: scanResult.overall,
            score: scanResult.score,
            failingChecks: failingChecks.map(c => {
                var _a, _b, _c;
                return ({
                    id: c.id,
                    name: c.name,
                    status: c.status,
                    severity: (_a = c.severity) !== null && _a !== void 0 ? _a : 'medium',
                    detail: c.detail,
                    fix: c.fix,
                    fixSafety: (_c = (_b = security_scan_1.FIX_SAFETY[c.id]) !== null && _b !== void 0 ? _b : c.fixSafety) !== null && _c !== void 0 ? _c : 'manual-only',
                    autoFixable: isFixableInScope(c.id, fixScope, force),
                });
            }),
            passingCount: allChecks.length - failingChecks.length,
            totalCount: allChecks.length,
            categories: Object.fromEntries(Object.entries(scanResult.categories).map(([key, cat]) => [
                key,
                { score: cat.score, failCount: cat.checks.filter(c => c.status !== 'pass').length },
            ])),
        };
        if (action === 'scan') {
            const criticalCount = failingChecks.filter(c => c.severity === 'critical').length;
            const highCount = failingChecks.filter(c => c.severity === 'high').length;
            return server_1.NextResponse.json({
                scan: scanResponse,
                summary: `Security score: ${scanResult.score}/100 (${scanResult.overall}). ${failingChecks.length} issue(s): ${criticalCount} critical, ${highCount} high.`,
            });
        }
        // Fix or scan-and-fix
        const targetIds = ids ? new Set(ids) : null;
        const checksToFix = failingChecks.filter(c => {
            if (targetIds && !targetIds.has(c.id))
                return false;
            return isFixableInScope(c.id, fixScope, force);
        });
        const skipped = [];
        const requiresManual = [];
        // Identify skipped and manual checks
        for (const c of failingChecks) {
            if (targetIds && !targetIds.has(c.id))
                continue;
            const safety = (_a = security_scan_1.FIX_SAFETY[c.id]) !== null && _a !== void 0 ? _a : c.fixSafety;
            if (!safety || safety === 'manual-only') {
                requiresManual.push({ id: c.id, name: c.name, instructions: c.fix });
            }
            else if (!isFixableInScope(c.id, fixScope, force)) {
                const reason = safety === 'requires-review' && !force
                    ? 'requires-review: set force=true to apply'
                    : safety === 'requires-restart' && fixScope === 'safe'
                        ? 'requires-restart: use fixScope "safe+restart" or "all"'
                        : `fix safety level "${safety}" not in scope "${fixScope}"`;
                skipped.push({ id: c.id, reason });
            }
        }
        if (dryRun) {
            return server_1.NextResponse.json({
                scan: scanResponse,
                fixes: {
                    applied: checksToFix.map(c => ({
                        id: c.id,
                        name: c.name,
                        fixed: false,
                        detail: `[dry-run] Would apply fix: ${c.fix}`,
                        fixSafety: security_scan_1.FIX_SAFETY[c.id],
                    })),
                    skipped,
                    requiresRestart: checksToFix.some(c => security_scan_1.FIX_SAFETY[c.id] === 'requires-restart'),
                    requiresManual,
                },
                summary: `Dry run: ${checksToFix.length} fix(es) would be applied, ${skipped.length} skipped, ${requiresManual.length} require manual action.`,
            });
        }
        // Actually apply fixes by calling the fix endpoint logic
        const fixIds = checksToFix.map(c => c.id);
        let fixResponse = { fixed: 0, failed: 0, results: [] };
        if (fixIds.length > 0) {
            // Import and call the fix route handler internally
            const fixUrl = new URL('/api/security-scan/fix', request.url);
            const fixReq = new server_1.NextRequest(fixUrl, {
                method: 'POST',
                headers: request.headers,
                body: JSON.stringify({ ids: fixIds }),
            });
            // Dynamically import to avoid circular deps
            const { POST: fixHandler } = await Promise.resolve().then(() => __importStar(require('../fix/route')));
            const fixRes = await fixHandler(fixReq);
            fixResponse = await fixRes.json();
        }
        const applied = (fixResponse.results || []).map((r) => (Object.assign(Object.assign({}, r), { fixSafety: security_scan_1.FIX_SAFETY[r.id] })));
        const requiresRestart = applied.some((r) => r.fixed && security_scan_1.FIX_SAFETY[r.id] === 'requires-restart');
        logger_1.logger.info({ action, fixScope, force, dryRun, applied: applied.length, skipped: skipped.length }, 'Agent security scan+fix');
        // Re-scan after fixes to get updated score
        const postFixScan = fixIds.length > 0 ? (0, security_scan_1.runSecurityScan)() : scanResult;
        return server_1.NextResponse.json({
            scan: Object.assign(Object.assign({}, scanResponse), { score: postFixScan.score, overall: postFixScan.overall }),
            fixes: {
                applied,
                skipped,
                requiresRestart,
                requiresManual,
            },
            summary: buildSummary(applied, skipped, requiresManual, requiresRestart, postFixScan.score, postFixScan.overall),
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Agent security scan error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
function buildSummary(applied, skipped, requiresManual, requiresRestart, score, overall) {
    const parts = [];
    const fixedCount = applied.filter((r) => r.fixed).length;
    if (fixedCount > 0)
        parts.push(`${fixedCount} issue(s) fixed`);
    if (skipped.length > 0)
        parts.push(`${skipped.length} skipped`);
    if (requiresManual.length > 0)
        parts.push(`${requiresManual.length} require manual action`);
    if (requiresRestart)
        parts.push('server restart recommended');
    parts.push(`score: ${score}/100 (${overall})`);
    return parts.join('. ') + '.';
}
