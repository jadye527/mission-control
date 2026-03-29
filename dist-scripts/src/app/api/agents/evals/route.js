"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const agent_evals_1 = require("@/lib/agent-evals");
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.readLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const { searchParams } = new URL(request.url);
        const agent = searchParams.get('agent');
        const action = searchParams.get('action');
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Missing required parameter: agent' }, { status: 400 });
        }
        // History mode
        if (action === 'history') {
            const weeks = parseInt(searchParams.get('weeks') || '4', 10);
            const db = (0, db_1.getDatabase)();
            const history = db.prepare(`
        SELECT eval_layer, score, passed, detail, created_at
        FROM eval_runs
        WHERE agent_name = ? AND workspace_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(agent, workspaceId, weeks * 7);
            const driftTimeline = (0, agent_evals_1.getDriftTimeline)(agent, weeks, workspaceId);
            return server_1.NextResponse.json({
                agent,
                history,
                driftTimeline,
            });
        }
        // Default: latest eval results per layer
        const db = (0, db_1.getDatabase)();
        const latestByLayer = db.prepare(`
      SELECT e.eval_layer, e.score, e.passed, e.detail, e.created_at
      FROM eval_runs e
      INNER JOIN (
        SELECT eval_layer, MAX(created_at) as max_created
        FROM eval_runs
        WHERE agent_name = ? AND workspace_id = ?
        GROUP BY eval_layer
      ) latest ON e.eval_layer = latest.eval_layer AND e.created_at = latest.max_created
      WHERE e.agent_name = ? AND e.workspace_id = ?
    `).all(agent, workspaceId, agent, workspaceId);
        const driftResults = (0, agent_evals_1.runDriftCheck)(agent, workspaceId);
        const hasDrift = driftResults.some(d => d.drifted);
        return server_1.NextResponse.json({
            agent,
            layers: latestByLayer,
            drift: {
                hasDrift,
                metrics: driftResults,
            },
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/agents/evals error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
async function POST(request) {
    var _a, _b;
    try {
        const body = await request.json();
        const { action } = body;
        if (action === 'run') {
            const auth = (0, auth_1.requireRole)(request, 'operator');
            if ('error' in auth)
                return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
            const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
            if (rateCheck)
                return rateCheck;
            const { agent, layer } = body;
            if (!agent)
                return server_1.NextResponse.json({ error: 'Missing: agent' }, { status: 400 });
            const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
            const db = (0, db_1.getDatabase)();
            const results = [];
            const layers = layer ? [layer] : ['output', 'trace', 'component', 'drift'];
            for (const l of layers) {
                let evalResults = [];
                switch (l) {
                    case 'output':
                        evalResults = (0, agent_evals_1.runOutputEvals)(agent, 168, workspaceId);
                        break;
                    case 'trace':
                        evalResults = [(0, agent_evals_1.evalReasoningCoherence)(agent, 24, workspaceId)];
                        break;
                    case 'component':
                        evalResults = [(0, agent_evals_1.evalToolReliability)(agent, 24, workspaceId)];
                        break;
                    case 'drift': {
                        const driftResults = (0, agent_evals_1.runDriftCheck)(agent, workspaceId);
                        const driftScore = driftResults.filter(d => !d.drifted).length / Math.max(driftResults.length, 1);
                        evalResults = [{
                                layer: 'drift',
                                score: Math.round(driftScore * 100) / 100,
                                passed: !driftResults.some(d => d.drifted),
                                detail: driftResults.map(d => `${d.metric}: ${d.drifted ? 'DRIFTED' : 'stable'} (delta=${d.delta})`).join('; '),
                            }];
                        break;
                    }
                }
                for (const r of evalResults) {
                    db.prepare(`
            INSERT INTO eval_runs (agent_name, eval_layer, score, passed, detail, workspace_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(agent, r.layer, r.score, r.passed ? 1 : 0, r.detail, workspaceId);
                    results.push(r);
                }
            }
            return server_1.NextResponse.json({ agent, results });
        }
        if (action === 'golden-set') {
            const auth = (0, auth_1.requireRole)(request, 'admin');
            if ('error' in auth)
                return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
            const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
            if (rateCheck)
                return rateCheck;
            const { name, entries } = body;
            if (!name)
                return server_1.NextResponse.json({ error: 'Missing: name' }, { status: 400 });
            const workspaceId = (_b = auth.user.workspace_id) !== null && _b !== void 0 ? _b : 1;
            const db = (0, db_1.getDatabase)();
            db.prepare(`
        INSERT INTO eval_golden_sets (name, entries, created_by, workspace_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(name, workspace_id)
        DO UPDATE SET entries = excluded.entries, updated_at = unixepoch()
      `).run(name, JSON.stringify(entries || []), auth.user.username, workspaceId);
            return server_1.NextResponse.json({ success: true, name });
        }
        return server_1.NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/agents/evals error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
