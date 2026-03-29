"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const docs_knowledge_1 = require("@/lib/docs-knowledge");
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.readLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const { searchParams } = new URL(request.url);
        const query = (searchParams.get('q') || searchParams.get('query') || '').trim();
        const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
        if (!query) {
            return server_1.NextResponse.json({ error: 'Query required' }, { status: 400 });
        }
        const results = await (0, docs_knowledge_1.searchDocs)(query, limit);
        return server_1.NextResponse.json({ query, results, count: results.length });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/docs/search error');
        return server_1.NextResponse.json({ error: 'Failed to search docs' }, { status: 500 });
    }
}
