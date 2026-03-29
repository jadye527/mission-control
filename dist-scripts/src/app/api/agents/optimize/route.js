"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const agent_optimizer_1 = require("@/lib/agent-optimizer");
async function GET(request) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.readLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const { searchParams } = new URL(request.url);
        const agent = searchParams.get('agent');
        const hours = parseInt(searchParams.get('hours') || '24', 10);
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        if (!agent) {
            return server_1.NextResponse.json({ error: 'Missing required parameter: agent' }, { status: 400 });
        }
        const efficiency = (0, agent_optimizer_1.analyzeTokenEfficiency)(agent, hours, workspaceId);
        const toolPatterns = (0, agent_optimizer_1.analyzeToolPatterns)(agent, hours, workspaceId);
        const fleet = (0, agent_optimizer_1.getFleetBenchmarks)(workspaceId);
        const recommendations = (0, agent_optimizer_1.generateRecommendations)(agent, workspaceId);
        // Calculate fleet percentile for tokens per session
        const fleetTokens = fleet
            .map(f => f.tokensPerTask)
            .filter(t => t > 0)
            .sort((a, b) => a - b);
        const agentTokensPerTask = efficiency.sessionsCount > 0 ? efficiency.avgTokensPerSession : 0;
        const percentile = fleetTokens.length > 0
            ? Math.round((fleetTokens.filter(t => t >= agentTokensPerTask).length / fleetTokens.length) * 100)
            : 50;
        // Fleet average cost
        const fleetAvgCost = fleet.length > 0
            ? fleet.reduce((sum, f) => sum + f.costPerTask, 0) / fleet.length
            : 0;
        // Tool analysis
        const mostUsed = toolPatterns.topTools.slice(0, 5);
        const leastEffective = toolPatterns.topTools
            .filter(t => t.successRate < 80)
            .sort((a, b) => a.successRate - b.successRate)
            .slice(0, 5);
        // Performance from fleet benchmarks
        const agentBenchmark = fleet.find(f => f.agentName === agent);
        return server_1.NextResponse.json({
            agent,
            analyzedAt: new Date().toISOString(),
            efficiency: {
                tokensPerTask: agentTokensPerTask,
                fleetAverage: fleetTokens.length > 0
                    ? Math.round(fleetTokens.reduce((a, b) => a + b, 0) / fleetTokens.length)
                    : 0,
                percentile,
                trend: efficiency.totalTokens,
                costPerTask: efficiency.avgCostPerSession,
            },
            toolPatterns: {
                mostUsed: mostUsed.map(t => ({
                    name: t.toolName,
                    count: t.count,
                    successRate: t.successRate,
                })),
                leastEffective: leastEffective.map(t => ({
                    name: t.toolName,
                    count: t.count,
                    successRate: t.successRate,
                })),
                unusedCapabilities: [],
            },
            performance: {
                taskCompletionRate: (_b = agentBenchmark === null || agentBenchmark === void 0 ? void 0 : agentBenchmark.tasksCompleted) !== null && _b !== void 0 ? _b : 0,
                avgTaskDuration: toolPatterns.avgDurationMs,
                errorRate: toolPatterns.failureRate,
                fleetRanking: fleet.findIndex(f => f.agentName === agent) + 1 || fleet.length + 1,
            },
            recommendations: recommendations.map(r => {
                var _a;
                return ({
                    category: r.category,
                    priority: r.severity,
                    title: r.category.charAt(0).toUpperCase() + r.category.slice(1) + ' issue',
                    description: r.message,
                    expectedImpact: (_a = r.metric) !== null && _a !== void 0 ? _a : null,
                });
            }),
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/agents/optimize error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
