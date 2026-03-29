"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const db_1 = require("@/lib/db");
const logger_1 = require("@/lib/logger");
function parseTimestamp(value) {
    if (!value)
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.floor(numeric);
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
        return Math.floor(parsed / 1000);
    }
    return null;
}
function percentileNearestRank(values, percentile) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.ceil((percentile / 100) * sorted.length);
    const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
    return sorted[index];
}
function average(values) {
    if (values.length === 0)
        return null;
    const sum = values.reduce((acc, value) => acc + value, 0);
    return sum / values.length;
}
function isTaskIntervened(row) {
    const retryCount = Number(row.retry_count || 0);
    const outcome = String(row.outcome || '').toLowerCase();
    const hasErrorMessage = String(row.error_message || '').trim().length > 0;
    return retryCount > 0 || hasErrorMessage || outcome === 'failed' || outcome === 'partial' || outcome === 'abandoned';
}
function buildWindowStats(label, start, end, tasks) {
    const latencySamples = [];
    let interventionCount = 0;
    for (const task of tasks) {
        if (!task.completed_at)
            continue;
        if (task.completed_at < start || task.completed_at >= end)
            continue;
        if (task.completed_at >= task.created_at) {
            latencySamples.push(task.completed_at - task.created_at);
        }
        if (isTaskIntervened(task)) {
            interventionCount += 1;
        }
    }
    const sampleSize = latencySamples.length;
    return {
        label,
        start,
        end,
        sample_size: sampleSize,
        latency_seconds: {
            p50: percentileNearestRank(latencySamples, 50),
            p95: percentileNearestRank(latencySamples, 95),
            avg: average(latencySamples),
        },
        interventions: {
            count: interventionCount,
            rate: sampleSize > 0 ? interventionCount / sampleSize : 0,
        },
    };
}
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.readLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const now = Math.floor(Date.now() / 1000);
        const { searchParams } = new URL(request.url);
        const betaStart = parseTimestamp(searchParams.get('beta_start') || searchParams.get('cutover'));
        if (!betaStart) {
            return server_1.NextResponse.json({ error: 'beta_start query parameter is required (unix seconds or ISO timestamp)' }, { status: 400 });
        }
        if (betaStart > now) {
            return server_1.NextResponse.json({ error: 'beta_start must not be in the future' }, { status: 400 });
        }
        const maxLookbackSeconds = 30 * 24 * 60 * 60;
        const lookbackSecondsRaw = Number(searchParams.get('lookback_seconds') || 7 * 24 * 60 * 60);
        const lookbackSeconds = Math.min(maxLookbackSeconds, Math.max(60, Math.floor(Number.isFinite(lookbackSecondsRaw) ? lookbackSecondsRaw : 7 * 24 * 60 * 60)));
        const postStart = betaStart;
        // Include tasks completed in the current second.
        const postEnd = now + 1;
        const postDuration = Math.max(60, postEnd - postStart);
        const baselineDuration = Math.min(lookbackSeconds, postDuration);
        const baselineEnd = betaStart;
        const baselineStart = Math.max(0, baselineEnd - baselineDuration);
        const db = (0, db_1.getDatabase)();
        const rows = db.prepare(`
      SELECT
        id,
        created_at,
        completed_at,
        retry_count,
        outcome,
        error_message
      FROM tasks
      WHERE workspace_id = ?
        AND status = 'done'
        AND completed_at IS NOT NULL
        AND completed_at >= ?
        AND completed_at < ?
    `).all(workspaceId, baselineStart, postEnd);
        const baseline = buildWindowStats('baseline', baselineStart, baselineEnd, rows);
        const post = buildWindowStats('post', postStart, postEnd, rows);
        const p95Delta = (post.latency_seconds.p95 !== null && baseline.latency_seconds.p95 !== null)
            ? post.latency_seconds.p95 - baseline.latency_seconds.p95
            : null;
        const interventionRateDelta = post.interventions.rate - baseline.interventions.rate;
        return server_1.NextResponse.json({
            metric_definitions: {
                p95_task_latency_seconds: '95th percentile of (completed_at - created_at) for done tasks in the window',
                intervention_rate: 'intervened_task_count / sample_size where intervened = retry_count>0 OR outcome in {failed,partial,abandoned} OR error_message not empty',
            },
            params: {
                beta_start: betaStart,
                lookback_seconds: lookbackSeconds,
            },
            windows: {
                baseline,
                post,
            },
            deltas: {
                p95_latency_seconds: p95Delta,
                intervention_rate: interventionRateDelta,
            },
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/tasks/regression error');
        return server_1.NextResponse.json({ error: 'Failed to compute regression metrics' }, { status: 500 });
    }
}
