"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const token_pricing_1 = require("@/lib/token-pricing");
const provider_subscriptions_1 = require("@/lib/provider-subscriptions");
const logger_1 = require("@/lib/logger");
/**
 * GET /api/tokens/by-agent - Per-agent cost breakdown from token_usage table
 * Query params:
 *   days=N  - Time window in days (default 30)
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const { searchParams } = new URL(request.url);
        const days = Math.max(1, Math.min(365, Number(searchParams.get('days') || 30)));
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const db = (0, db_1.getDatabase)();
        const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
        const providerSubscriptions = (0, provider_subscriptions_1.getProviderSubscriptionFlags)();
        // Query per-agent totals with per-model breakdown embedded as JSON
        const rows = db.prepare(`
      SELECT
        CASE
          WHEN INSTR(session_id, ':') > 0 THEN SUBSTR(session_id, 1, INSTR(session_id, ':') - 1)
          ELSE session_id
        END AS agent_name,
        SUM(input_tokens)  AS total_input_tokens,
        SUM(output_tokens) AS total_output_tokens,
        COUNT(DISTINCT session_id) AS session_count,
        COUNT(*)           AS request_count,
        MAX(created_at)    AS last_active,
        GROUP_CONCAT(DISTINCT model) AS models_json
      FROM token_usage
      WHERE workspace_id = ?
        AND created_at >= ?
      GROUP BY agent_name
      ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC
    `).all(workspaceId, cutoff);
        // For accurate per-model cost we need a second pass grouping by agent+model
        const modelRows = db.prepare(`
      SELECT
        CASE
          WHEN INSTR(session_id, ':') > 0 THEN SUBSTR(session_id, 1, INSTR(session_id, ':') - 1)
          ELSE session_id
        END AS agent_name,
        model,
        SUM(input_tokens)  AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        COUNT(*)           AS request_count
      FROM token_usage
      WHERE workspace_id = ?
        AND created_at >= ?
      GROUP BY agent_name, model
      ORDER BY agent_name, (SUM(input_tokens) + SUM(output_tokens)) DESC
    `).all(workspaceId, cutoff);
        // Build model map keyed by agent name
        const modelsByAgent = new Map();
        for (const row of modelRows) {
            const cost = (0, token_pricing_1.calculateTokenCost)(row.model, row.input_tokens, row.output_tokens, { providerSubscriptions });
            const list = modelsByAgent.get(row.agent_name) || [];
            list.push({
                model: row.model,
                input_tokens: row.input_tokens,
                output_tokens: row.output_tokens,
                request_count: row.request_count,
                cost,
            });
            modelsByAgent.set(row.agent_name, list);
        }
        // Assemble final response
        const agents = rows.map((row) => {
            const models = modelsByAgent.get(row.agent_name) || [];
            const totalCost = models.reduce((sum, m) => sum + m.cost, 0);
            return {
                agent: row.agent_name,
                total_input_tokens: row.total_input_tokens,
                total_output_tokens: row.total_output_tokens,
                total_tokens: row.total_input_tokens + row.total_output_tokens,
                total_cost: totalCost,
                session_count: row.session_count,
                request_count: row.request_count,
                last_active: new Date(row.last_active * 1000).toISOString(),
                models,
            };
        });
        const totalCost = agents.reduce((sum, a) => sum + a.total_cost, 0);
        const totalTokens = agents.reduce((sum, a) => sum + a.total_tokens, 0);
        return server_1.NextResponse.json({
            agents,
            summary: {
                total_cost: totalCost,
                total_tokens: totalTokens,
                agent_count: agents.length,
                days,
            },
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/tokens/by-agent error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
