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
const rate_limit_1 = require("@/lib/rate-limit");
const validation_1 = require("@/lib/validation");
/**
 * GET /api/alerts - List all alert rules
 */
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const db = (0, db_1.getDatabase)();
    const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
    try {
        const rules = db
            .prepare('SELECT * FROM alert_rules WHERE workspace_id = ? ORDER BY created_at DESC')
            .all(workspaceId);
        return server_1.NextResponse.json({ rules });
    }
    catch (_b) {
        return server_1.NextResponse.json({ rules: [] });
    }
}
/**
 * POST /api/alerts - Create a new alert rule or evaluate rules
 */
async function POST(request) {
    var _a, _b, _c;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    const db = (0, db_1.getDatabase)();
    const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
    // Check for evaluate action first (peek at body without consuming)
    let rawBody;
    try {
        rawBody = await request.json();
    }
    catch (_d) {
        return server_1.NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    if (rawBody.action === 'evaluate') {
        return evaluateRules(db, workspaceId);
    }
    // Validate for create using schema
    const parseResult = validation_1.createAlertSchema.safeParse(rawBody);
    if (!parseResult.success) {
        const messages = parseResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
        return server_1.NextResponse.json({ error: 'Validation failed', details: messages }, { status: 400 });
    }
    // Create new rule
    const { name, description, entity_type, condition_field, condition_operator, condition_value, action_type, action_config, cooldown_minutes } = parseResult.data;
    try {
        const result = db.prepare(`
      INSERT INTO alert_rules (name, description, entity_type, condition_field, condition_operator, condition_value, action_type, action_config, cooldown_minutes, created_by, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, description || null, entity_type, condition_field, condition_operator, condition_value, action_type || 'notification', JSON.stringify(action_config || {}), cooldown_minutes || 60, ((_b = auth.user) === null || _b === void 0 ? void 0 : _b.username) || 'system', workspaceId);
        // Audit log
        try {
            db.prepare('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)').run('alert_rule_created', ((_c = auth.user) === null || _c === void 0 ? void 0 : _c.username) || 'system', `Created alert rule: ${name}`);
        }
        catch ( /* audit table might not exist */_e) { /* audit table might not exist */ }
        const rule = db
            .prepare('SELECT * FROM alert_rules WHERE id = ? AND workspace_id = ?')
            .get(result.lastInsertRowid, workspaceId);
        return server_1.NextResponse.json({ rule }, { status: 201 });
    }
    catch (err) {
        return server_1.NextResponse.json({ error: err.message || 'Failed to create rule' }, { status: 500 });
    }
}
/**
 * PUT /api/alerts - Update an alert rule
 */
async function PUT(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    const db = (0, db_1.getDatabase)();
    const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
    const body = await request.json();
    const { id } = body, updates = __rest(body, ["id"]);
    if (!id)
        return server_1.NextResponse.json({ error: 'id is required' }, { status: 400 });
    const existing = db
        .prepare('SELECT * FROM alert_rules WHERE id = ? AND workspace_id = ?')
        .get(id, workspaceId);
    if (!existing)
        return server_1.NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    const allowed = ['name', 'description', 'enabled', 'entity_type', 'condition_field', 'condition_operator', 'condition_value', 'action_type', 'action_config', 'cooldown_minutes'];
    const sets = [];
    const values = [];
    for (const key of allowed) {
        if (key in updates) {
            sets.push(`${key} = ?`);
            values.push(key === 'action_config' ? JSON.stringify(updates[key]) : updates[key]);
        }
    }
    if (sets.length === 0)
        return server_1.NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    sets.push('updated_at = (unixepoch())');
    values.push(id, workspaceId);
    db.prepare(`UPDATE alert_rules SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...values);
    const updated = db
        .prepare('SELECT * FROM alert_rules WHERE id = ? AND workspace_id = ?')
        .get(id, workspaceId);
    return server_1.NextResponse.json({ rule: updated });
}
/**
 * DELETE /api/alerts - Delete an alert rule
 */
async function DELETE(request) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    const db = (0, db_1.getDatabase)();
    const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
    const body = await request.json();
    const { id } = body;
    if (!id)
        return server_1.NextResponse.json({ error: 'id is required' }, { status: 400 });
    const result = db.prepare('DELETE FROM alert_rules WHERE id = ? AND workspace_id = ?').run(id, workspaceId);
    try {
        db.prepare('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)').run('alert_rule_deleted', ((_b = auth.user) === null || _b === void 0 ? void 0 : _b.username) || 'system', `Deleted alert rule #${id}`);
    }
    catch ( /* audit table might not exist */_c) { /* audit table might not exist */ }
    return server_1.NextResponse.json({ deleted: result.changes > 0 });
}
/**
 * Evaluate all enabled alert rules against current data
 */
function evaluateRules(db, workspaceId) {
    let rules;
    try {
        rules = db.prepare('SELECT * FROM alert_rules WHERE enabled = 1 AND workspace_id = ?').all(workspaceId);
    }
    catch (_a) {
        return server_1.NextResponse.json({ evaluated: 0, triggered: 0, results: [] });
    }
    const now = Math.floor(Date.now() / 1000);
    const results = [];
    for (const rule of rules) {
        // Check cooldown
        if (rule.last_triggered_at && (now - rule.last_triggered_at) < rule.cooldown_minutes * 60) {
            results.push({ rule_id: rule.id, rule_name: rule.name, triggered: false, reason: 'In cooldown' });
            continue;
        }
        const triggered = evaluateRule(db, rule, now, workspaceId);
        results.push({ rule_id: rule.id, rule_name: rule.name, triggered, reason: triggered ? 'Condition met' : 'Condition not met' });
        if (triggered) {
            // Update trigger tracking
            db.prepare('UPDATE alert_rules SET last_triggered_at = ?, trigger_count = trigger_count + 1 WHERE id = ?').run(now, rule.id);
            // Create notification
            try {
                const config = JSON.parse(rule.action_config || '{}');
                const recipient = config.recipient || 'system';
                db.prepare(`
          INSERT INTO notifications (recipient, type, title, message, source_type, source_id, workspace_id)
          VALUES (?, 'alert', ?, ?, 'alert_rule', ?, ?)
        `).run(recipient, `Alert: ${rule.name}`, rule.description || `Rule "${rule.name}" triggered`, rule.id, workspaceId);
            }
            catch ( /* notification creation failed */_b) { /* notification creation failed */ }
        }
    }
    const triggered = results.filter(r => r.triggered).length;
    return server_1.NextResponse.json({ evaluated: rules.length, triggered, results });
}
function evaluateRule(db, rule, now, workspaceId) {
    try {
        switch (rule.entity_type) {
            case 'agent': return evaluateAgentRule(db, rule, now, workspaceId);
            case 'task': return evaluateTaskRule(db, rule, now, workspaceId);
            case 'session': return evaluateSessionRule(db, rule, now, workspaceId);
            case 'activity': return evaluateActivityRule(db, rule, now, workspaceId);
            default: return false;
        }
    }
    catch (_a) {
        return false;
    }
}
function evaluateAgentRule(db, rule, now, workspaceId) {
    var _a, _b;
    const { condition_field, condition_operator, condition_value } = rule;
    if (condition_operator === 'count_above' || condition_operator === 'count_below') {
        const count = ((_a = db.prepare(`SELECT COUNT(*) as c FROM agents WHERE workspace_id = ? AND ${safeColumn('agents', condition_field)} = ?`).get(workspaceId, condition_value)) === null || _a === void 0 ? void 0 : _a.c) || 0;
        return condition_operator === 'count_above' ? count > parseInt(condition_value) : count < parseInt(condition_value);
    }
    if (condition_operator === 'age_minutes_above') {
        // Check agents where field value is older than N minutes (e.g., last_seen)
        const threshold = now - parseInt(condition_value) * 60;
        const count = ((_b = db.prepare(`SELECT COUNT(*) as c FROM agents WHERE workspace_id = ? AND status != 'offline' AND ${safeColumn('agents', condition_field)} < ?`).get(workspaceId, threshold)) === null || _b === void 0 ? void 0 : _b.c) || 0;
        return count > 0;
    }
    const agents = db.prepare(`SELECT ${safeColumn('agents', condition_field)} as val FROM agents WHERE workspace_id = ? AND status != 'offline'`).all(workspaceId);
    return agents.some(a => compareValue(a.val, condition_operator, condition_value));
}
function evaluateTaskRule(db, rule, _now, workspaceId) {
    var _a, _b;
    const { condition_field, condition_operator, condition_value } = rule;
    if (condition_operator === 'count_above') {
        const count = ((_a = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE workspace_id = ? AND ${safeColumn('tasks', condition_field)} = ?`).get(workspaceId, condition_value)) === null || _a === void 0 ? void 0 : _a.c) || 0;
        return count > parseInt(condition_value);
    }
    if (condition_operator === 'count_below') {
        const count = ((_b = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE workspace_id = ?`).get(workspaceId)) === null || _b === void 0 ? void 0 : _b.c) || 0;
        return count < parseInt(condition_value);
    }
    const tasks = db.prepare(`SELECT ${safeColumn('tasks', condition_field)} as val FROM tasks WHERE workspace_id = ?`).all(workspaceId);
    return tasks.some(t => compareValue(t.val, condition_operator, condition_value));
}
function evaluateSessionRule(db, rule, _now, workspaceId) {
    var _a;
    // Session data comes from the gateway, not the DB, so we check the agents table for session info
    const { condition_operator, condition_value } = rule;
    if (condition_operator === 'count_above') {
        const count = ((_a = db.prepare(`SELECT COUNT(*) as c FROM agents WHERE workspace_id = ? AND status = 'busy'`).get(workspaceId)) === null || _a === void 0 ? void 0 : _a.c) || 0;
        return count > parseInt(condition_value);
    }
    return false;
}
function evaluateActivityRule(db, rule, now, workspaceId) {
    var _a;
    const { condition_field, condition_operator, condition_value } = rule;
    if (condition_operator === 'count_above') {
        // Count activities in the last hour
        const hourAgo = now - 3600;
        const count = ((_a = db.prepare(`SELECT COUNT(*) as c FROM activities WHERE workspace_id = ? AND created_at > ? AND ${safeColumn('activities', condition_field)} = ?`).get(workspaceId, hourAgo, condition_value)) === null || _a === void 0 ? void 0 : _a.c) || 0;
        return count > parseInt(condition_value);
    }
    return false;
}
function compareValue(actual, operator, expected) {
    if (actual == null)
        return false;
    const strActual = String(actual);
    switch (operator) {
        case 'equals': return strActual === expected;
        case 'not_equals': return strActual !== expected;
        case 'greater_than': return Number(actual) > Number(expected);
        case 'less_than': return Number(actual) < Number(expected);
        case 'contains': return strActual.toLowerCase().includes(expected.toLowerCase());
        default: return false;
    }
}
// Whitelist of columns per table to prevent SQL injection
const SAFE_COLUMNS = {
    agents: new Set(['status', 'role', 'name', 'last_seen', 'last_activity']),
    tasks: new Set(['status', 'priority', 'assigned_to', 'title']),
    activities: new Set(['type', 'actor', 'entity_type']),
};
function safeColumn(table, column) {
    var _a;
    if ((_a = SAFE_COLUMNS[table]) === null || _a === void 0 ? void 0 : _a.has(column))
        return column;
    return 'id'; // fallback to safe column
}
