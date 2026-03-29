"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, "viewer");
    if ("error" in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const db = (0, db_1.getDatabase)();
    const rows = db.prepare(`
    SELECT l.gateway_id, g.name AS gateway_name, l.status, l.latency, l.probed_at, l.error
    FROM gateway_health_logs l
    LEFT JOIN gateways g ON g.id = l.gateway_id
    ORDER BY l.probed_at DESC
    LIMIT 100
  `).all();
    const historyMap = {};
    for (const row of rows) {
        const entry = {
            status: row.status,
            latency: row.latency,
            probed_at: row.probed_at,
            error: row.error,
        };
        if (!historyMap[row.gateway_id]) {
            historyMap[row.gateway_id] = {
                gatewayId: row.gateway_id,
                name: row.gateway_name,
                entries: [],
            };
        }
        historyMap[row.gateway_id].entries.push(entry);
    }
    const history = Object.values(historyMap);
    return server_1.NextResponse.json({ history });
}
