"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const openclaw_gateway_1 = require("@/lib/openclaw-gateway");
const config_1 = require("@/lib/config");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const validation_1 = require("@/lib/validation");
const injection_guard_1 = require("@/lib/injection-guard");
const db_1 = require("@/lib/db");
function getPreferredToolsProfile() {
    return String(process.env.OPENCLAW_TOOLS_PROFILE || 'coding').trim() || 'coding';
}
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.heavyLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const result = await (0, validation_1.validateBody)(request, validation_1.spawnAgentSchema);
        if ('error' in result)
            return result.error;
        const { task, model, label, timeoutSeconds } = result.data;
        // Scan the task prompt and label for injection before sending to an agent
        const fieldsToScan = [
            { name: 'task', value: task },
            ...(label ? [{ name: 'label', value: label }] : []),
        ];
        for (const field of fieldsToScan) {
            const injectionReport = (0, injection_guard_1.scanForInjection)(field.value, { context: 'prompt' });
            if (!injectionReport.safe) {
                const criticals = injectionReport.matches.filter(m => m.severity === 'critical');
                if (criticals.length > 0) {
                    logger_1.logger.warn({ field: field.name, rules: criticals.map(m => m.rule) }, `Blocked spawn: injection detected in ${field.name}`);
                    return server_1.NextResponse.json({ error: `${field.name} blocked: potentially unsafe content detected`, injection: criticals.map(m => ({ rule: m.rule, description: m.description })) }, { status: 422 });
                }
            }
        }
        const timeout = timeoutSeconds;
        // Generate spawn ID
        const spawnId = `spawn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        // Construct the spawn command
        // Using OpenClaw's sessions_spawn function via clawdbot CLI
        const spawnPayload = Object.assign(Object.assign({ task,
            label }, (model ? { model } : {})), { runTimeoutSeconds: timeout, tools: {
                profile: getPreferredToolsProfile(),
            } });
        try {
            // Call gateway sessions_spawn directly. Try with tools.profile first,
            // fall back without it for older gateways that don't support the field.
            let result;
            let compatibilityFallbackUsed = false;
            try {
                result = await (0, openclaw_gateway_1.callOpenClawGateway)('sessions_spawn', spawnPayload, 15000);
            }
            catch (firstError) {
                const rawErr = String((firstError === null || firstError === void 0 ? void 0 : firstError.message) || '').toLowerCase();
                const isToolsSchemaError = (rawErr.includes('unknown field') || rawErr.includes('unknown key') || rawErr.includes('invalid argument')) &&
                    (rawErr.includes('tools') || rawErr.includes('profile'));
                if (!isToolsSchemaError)
                    throw firstError;
                const fallbackPayload = Object.assign({}, spawnPayload);
                delete fallbackPayload.tools;
                result = await (0, openclaw_gateway_1.callOpenClawGateway)('sessions_spawn', fallbackPayload, 15000);
                compatibilityFallbackUsed = true;
            }
            const sessionInfo = (result === null || result === void 0 ? void 0 : result.sessionId) || (result === null || result === void 0 ? void 0 : result.session_id) || null;
            const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
            (0, db_1.logAuditEvent)({
                action: 'agent_spawn',
                actor: auth.user.username,
                actor_id: auth.user.id,
                detail: {
                    spawnId,
                    model: model !== null && model !== void 0 ? model : null,
                    label,
                    task_summary: task.length > 120 ? task.slice(0, 120) + '...' : task,
                    toolsProfile: getPreferredToolsProfile(),
                    compatibilityFallbackUsed,
                },
                ip_address: ipAddress,
            });
            return server_1.NextResponse.json({
                success: true,
                spawnId,
                sessionInfo,
                task,
                model: model !== null && model !== void 0 ? model : null,
                label,
                timeoutSeconds: timeout,
                createdAt: Date.now(),
                result,
                compatibility: {
                    toolsProfile: getPreferredToolsProfile(),
                    fallbackUsed: compatibilityFallbackUsed,
                },
            });
        }
        catch (execError) {
            logger_1.logger.error({ err: execError }, 'Spawn execution error');
            return server_1.NextResponse.json({
                success: false,
                spawnId,
                error: execError.message || 'Failed to spawn agent',
                task,
                model: model !== null && model !== void 0 ? model : null,
                label,
                timeoutSeconds: timeout,
                createdAt: Date.now()
            }, { status: 500 });
        }
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Spawn API error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
// Get spawn history
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.heavyLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const { searchParams } = new URL(request.url);
        const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
        // In a real implementation, you'd store spawn history in a database
        // For now, we'll try to read recent spawn activity from logs
        try {
            if (!config_1.config.logsDir) {
                return server_1.NextResponse.json({ history: [] });
            }
            const files = await (0, promises_1.readdir)(config_1.config.logsDir);
            const logFiles = await Promise.all(files
                .filter((file) => file.endsWith('.log'))
                .map(async (file) => {
                const fullPath = (0, path_1.join)(config_1.config.logsDir, file);
                const stats = await (0, promises_1.stat)(fullPath);
                return { file, fullPath, mtime: stats.mtime.getTime() };
            }));
            const recentLogs = logFiles
                .sort((a, b) => b.mtime - a.mtime)
                .slice(0, 5);
            const lines = [];
            for (const log of recentLogs) {
                const content = await (0, promises_1.readFile)(log.fullPath, 'utf-8');
                const matched = content
                    .split('\n')
                    .filter((line) => line.includes('sessions_spawn'));
                lines.push(...matched);
            }
            const spawnHistory = lines
                .slice(-limit)
                .map((line, index) => {
                try {
                    const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
                    const modelMatch = line.match(/model[:\s]+"([^"]+)"/);
                    const taskMatch = line.match(/task[:\s]+"([^"]+)"/);
                    return {
                        id: `history-${Date.now()}-${index}`,
                        timestamp: timestampMatch
                            ? new Date(timestampMatch[1]).getTime()
                            : Date.now(),
                        model: modelMatch ? modelMatch[1] : 'unknown',
                        task: taskMatch ? taskMatch[1] : 'unknown',
                        status: 'completed',
                        line: line.trim()
                    };
                }
                catch (parseError) {
                    return null;
                }
            })
                .filter(Boolean);
            return server_1.NextResponse.json({ history: spawnHistory });
        }
        catch (logError) {
            // If we can't read logs, return empty history
            return server_1.NextResponse.json({ history: [] });
        }
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Spawn history API error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
