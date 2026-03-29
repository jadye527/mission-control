"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PUT = PUT;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const config_1 = require("@/lib/config");
const rate_limit_1 = require("@/lib/rate-limit");
const validation_1 = require("@/lib/validation");
// Default settings definitions (category, description, default value)
const settingDefinitions = {
    // Retention
    'retention.activities_days': { category: 'retention', description: 'Days to keep activity records', default: String(config_1.config.retention.activities) },
    'retention.audit_log_days': { category: 'retention', description: 'Days to keep audit log entries', default: String(config_1.config.retention.auditLog) },
    'retention.logs_days': { category: 'retention', description: 'Days to keep log files', default: String(config_1.config.retention.logs) },
    'retention.notifications_days': { category: 'retention', description: 'Days to keep notifications', default: String(config_1.config.retention.notifications) },
    'retention.pipeline_runs_days': { category: 'retention', description: 'Days to keep pipeline run history', default: String(config_1.config.retention.pipelineRuns) },
    'retention.token_usage_days': { category: 'retention', description: 'Days to keep token usage data', default: String(config_1.config.retention.tokenUsage) },
    'retention.gateway_sessions_days': { category: 'retention', description: 'Days to keep inactive gateway session metadata', default: String(config_1.config.retention.gatewaySessions) },
    // Gateway
    'gateway.host': { category: 'gateway', description: 'Gateway hostname', default: config_1.config.gatewayHost },
    'gateway.port': { category: 'gateway', description: 'Gateway port number', default: String(config_1.config.gatewayPort) },
    // Chat
    'chat.coordinator_target_agent': {
        category: 'chat',
        description: 'Optional coordinator routing target (agent name or openclawId). When set, coordinator inbox messages are forwarded to this agent before default/main-session fallback.',
        default: '',
    },
    // General
    'general.site_name': { category: 'general', description: 'Mission Control display name', default: 'Mission Control' },
    'general.auto_cleanup': { category: 'general', description: 'Enable automatic data cleanup', default: 'false' },
    'general.auto_backup': { category: 'general', description: 'Enable automatic daily backups', default: 'false' },
    'general.backup_retention_count': { category: 'general', description: 'Number of backup files to keep', default: '10' },
    // Subscription overrides
    'subscription.plan_override': { category: 'general', description: 'Override auto-detected subscription plan (e.g. max, max_5x, pro)', default: '' },
    'subscription.codex_plan': { category: 'general', description: 'Codex/OpenAI subscription plan (e.g. chatgpt, plus, pro)', default: '' },
    // Interface
    'general.interface_mode': { category: 'general', description: 'Interface complexity (essential or full)', default: 'essential' },
    // Onboarding
    'onboarding.completed': { category: 'onboarding', description: 'Whether onboarding has been completed', default: 'false' },
    'onboarding.completed_at': { category: 'onboarding', description: 'Timestamp when onboarding was completed', default: '' },
    'onboarding.skipped': { category: 'onboarding', description: 'Whether onboarding was skipped', default: 'false' },
    'onboarding.completed_steps': { category: 'onboarding', description: 'JSON array of completed step IDs', default: '[]' },
    'onboarding.checklist_dismissed': { category: 'onboarding', description: 'Whether the onboarding checklist has been dismissed', default: 'false' },
};
/**
 * GET /api/settings - List all settings (grouped by category)
 */
async function GET(request) {
    var _a, _b, _c, _d, _e, _f;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const db = (0, db_1.getDatabase)();
    const rows = db.prepare('SELECT * FROM settings ORDER BY category, key').all();
    const stored = new Map(rows.map(r => [r.key, r]));
    // Merge defaults with stored values
    const settings = [];
    for (const [key, def] of Object.entries(settingDefinitions)) {
        const row = stored.get(key);
        settings.push({
            key,
            value: (_a = row === null || row === void 0 ? void 0 : row.value) !== null && _a !== void 0 ? _a : def.default,
            description: (_b = row === null || row === void 0 ? void 0 : row.description) !== null && _b !== void 0 ? _b : def.description,
            category: (_c = row === null || row === void 0 ? void 0 : row.category) !== null && _c !== void 0 ? _c : def.category,
            updated_by: (_d = row === null || row === void 0 ? void 0 : row.updated_by) !== null && _d !== void 0 ? _d : null,
            updated_at: (_e = row === null || row === void 0 ? void 0 : row.updated_at) !== null && _e !== void 0 ? _e : null,
            is_default: !row,
        });
    }
    // Also include any custom settings not in definitions
    for (const row of rows) {
        if (!settingDefinitions[row.key]) {
            settings.push({
                key: row.key,
                value: row.value,
                description: (_f = row.description) !== null && _f !== void 0 ? _f : '',
                category: row.category,
                updated_by: row.updated_by,
                updated_at: row.updated_at,
                is_default: false,
            });
        }
    }
    // Group by category
    const grouped = {};
    for (const s of settings) {
        if (!grouped[s.category])
            grouped[s.category] = [];
        grouped[s.category].push(s);
    }
    return server_1.NextResponse.json({ settings, grouped });
}
/**
 * PUT /api/settings - Update one or more settings
 * Body: { settings: { key: value, ... } }
 */
async function PUT(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    const result = await (0, validation_1.validateBody)(request, validation_1.updateSettingsSchema);
    if ('error' in result)
        return result.error;
    const body = result.data;
    const db = (0, db_1.getDatabase)();
    const upsert = db.prepare(`
    INSERT INTO settings (key, value, description, category, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = unixepoch()
  `);
    const updated = [];
    const changes = {};
    const txn = db.transaction(() => {
        var _a, _b, _c;
        for (const [key, value] of Object.entries(body.settings)) {
            const strValue = String(value);
            const def = settingDefinitions[key];
            const category = (_a = def === null || def === void 0 ? void 0 : def.category) !== null && _a !== void 0 ? _a : 'custom';
            const description = (_b = def === null || def === void 0 ? void 0 : def.description) !== null && _b !== void 0 ? _b : null;
            // Get old value for audit
            const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
            changes[key] = { old: (_c = existing === null || existing === void 0 ? void 0 : existing.value) !== null && _c !== void 0 ? _c : null, new: strValue };
            upsert.run(key, strValue, description, category, auth.user.username);
            updated.push(key);
        }
    });
    txn();
    // Audit log
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    (0, db_1.logAuditEvent)({
        action: 'settings_update',
        actor: auth.user.username,
        actor_id: auth.user.id,
        detail: { updated_keys: updated, changes },
        ip_address: ipAddress,
    });
    return server_1.NextResponse.json({ updated, count: updated.length });
}
/**
 * DELETE /api/settings?key=... - Reset a setting to default
 */
async function DELETE(request) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    let body;
    try {
        body = await request.json();
    }
    catch (_c) {
        return server_1.NextResponse.json({ error: 'Request body required' }, { status: 400 });
    }
    const key = body.key;
    if (!key) {
        return server_1.NextResponse.json({ error: 'key parameter required' }, { status: 400 });
    }
    const db = (0, db_1.getDatabase)();
    const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!existing) {
        return server_1.NextResponse.json({ error: 'Setting not found or already at default' }, { status: 404 });
    }
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    (0, db_1.logAuditEvent)({
        action: 'settings_reset',
        actor: auth.user.username,
        actor_id: auth.user.id,
        detail: { key, old_value: existing.value },
        ip_address: ipAddress,
    });
    return server_1.NextResponse.json({ reset: key, default_value: (_b = (_a = settingDefinitions[key]) === null || _a === void 0 ? void 0 : _a.default) !== null && _b !== void 0 ? _b : null });
}
