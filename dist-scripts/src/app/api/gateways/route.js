"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
exports.PUT = PUT;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const gateway_runtime_1 = require("@/lib/gateway-runtime");
function ensureTable(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS gateways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL DEFAULT '127.0.0.1',
      port INTEGER NOT NULL DEFAULT 18789,
      token TEXT NOT NULL DEFAULT '',
      is_primary INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_seen INTEGER,
      latency INTEGER,
      sessions_count INTEGER NOT NULL DEFAULT 0,
      agents_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
}
/**
 * GET /api/gateways - List all registered gateways
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const db = (0, db_1.getDatabase)();
    ensureTable(db);
    const gateways = db.prepare('SELECT * FROM gateways ORDER BY is_primary DESC, name ASC').all();
    // If no gateways exist, seed defaults from environment
    if (gateways.length === 0) {
        const name = String(process.env.MC_DEFAULT_GATEWAY_NAME || 'primary');
        const host = String(process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1');
        const mainPort = (0, gateway_runtime_1.getDetectedGatewayPort)() || parseInt(process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789');
        const mainToken = (0, gateway_runtime_1.getDetectedGatewayToken)();
        db.prepare(`
      INSERT INTO gateways (name, host, port, token, is_primary) VALUES (?, ?, ?, ?, 1)
    `).run(name, host, mainPort, mainToken);
        const seeded = db.prepare('SELECT * FROM gateways ORDER BY is_primary DESC, name ASC').all();
        return server_1.NextResponse.json({ gateways: redactTokens(seeded) });
    }
    return server_1.NextResponse.json({ gateways: redactTokens(gateways) });
}
/**
 * POST /api/gateways - Add a new gateway
 */
async function POST(request) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const db = (0, db_1.getDatabase)();
    ensureTable(db);
    const body = await request.json();
    const { name, host, port, token, is_primary } = body;
    if (!name || !host || !port) {
        return server_1.NextResponse.json({ error: 'name, host, and port are required' }, { status: 400 });
    }
    try {
        // If marking as primary, unset other primaries
        if (is_primary) {
            db.prepare('UPDATE gateways SET is_primary = 0').run();
        }
        const result = db.prepare(`
      INSERT INTO gateways (name, host, port, token, is_primary) VALUES (?, ?, ?, ?, ?)
    `).run(name, host, port, token || '', is_primary ? 1 : 0);
        try {
            db.prepare('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)').run('gateway_added', ((_a = auth.user) === null || _a === void 0 ? void 0 : _a.username) || 'system', `Added gateway: ${name} (${host}:${port})`);
        }
        catch ( /* audit might not exist */_c) { /* audit might not exist */ }
        const gw = db.prepare('SELECT * FROM gateways WHERE id = ?').get(result.lastInsertRowid);
        return server_1.NextResponse.json({ gateway: redactToken(gw) }, { status: 201 });
    }
    catch (err) {
        if ((_b = err.message) === null || _b === void 0 ? void 0 : _b.includes('UNIQUE')) {
            return server_1.NextResponse.json({ error: 'A gateway with that name already exists' }, { status: 409 });
        }
        return server_1.NextResponse.json({ error: err.message || 'Failed to add gateway' }, { status: 500 });
    }
}
/**
 * PUT /api/gateways - Update a gateway
 */
async function PUT(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const db = (0, db_1.getDatabase)();
    ensureTable(db);
    const body = await request.json();
    const { id } = body, updates = __rest(body, ["id"]);
    if (!id)
        return server_1.NextResponse.json({ error: 'id is required' }, { status: 400 });
    const existing = db.prepare('SELECT * FROM gateways WHERE id = ?').get(id);
    if (!existing)
        return server_1.NextResponse.json({ error: 'Gateway not found' }, { status: 404 });
    // If setting as primary, unset others
    if (updates.is_primary) {
        db.prepare('UPDATE gateways SET is_primary = 0').run();
    }
    const allowed = ['name', 'host', 'port', 'token', 'is_primary', 'status', 'last_seen', 'latency', 'sessions_count', 'agents_count'];
    const sets = [];
    const values = [];
    for (const key of allowed) {
        if (key in updates) {
            sets.push(`${key} = ?`);
            values.push(updates[key]);
        }
    }
    if (sets.length === 0)
        return server_1.NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    sets.push('updated_at = (unixepoch())');
    values.push(id);
    db.prepare(`UPDATE gateways SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM gateways WHERE id = ?').get(id);
    return server_1.NextResponse.json({ gateway: redactToken(updated) });
}
/**
 * DELETE /api/gateways - Remove a gateway
 */
async function DELETE(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const db = (0, db_1.getDatabase)();
    ensureTable(db);
    const body = await request.json();
    const { id } = body;
    if (!id)
        return server_1.NextResponse.json({ error: 'id is required' }, { status: 400 });
    const gw = db.prepare('SELECT * FROM gateways WHERE id = ?').get(id);
    if (gw === null || gw === void 0 ? void 0 : gw.is_primary) {
        return server_1.NextResponse.json({ error: 'Cannot delete the primary gateway' }, { status: 400 });
    }
    const result = db.prepare('DELETE FROM gateways WHERE id = ?').run(id);
    try {
        db.prepare('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)').run('gateway_removed', ((_a = auth.user) === null || _a === void 0 ? void 0 : _a.username) || 'system', `Removed gateway: ${gw === null || gw === void 0 ? void 0 : gw.name}`);
    }
    catch ( /* audit might not exist */_b) { /* audit might not exist */ }
    return server_1.NextResponse.json({ deleted: result.changes > 0 });
}
function redactToken(gw) {
    return Object.assign(Object.assign({}, gw), { token: gw.token ? '--------' : '', token_set: !!gw.token });
}
function redactTokens(gws) {
    return gws.map(redactToken);
}
