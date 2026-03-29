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
        const tree = await (0, docs_knowledge_1.getDocsTree)();
        return server_1.NextResponse.json({ roots: (0, docs_knowledge_1.listDocsRoots)(), tree });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/docs/tree error');
        return server_1.NextResponse.json({ error: 'Failed to load docs tree' }, { status: 500 });
    }
}
