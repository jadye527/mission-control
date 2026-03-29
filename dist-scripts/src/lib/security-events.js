"use strict";
/**
 * Security Events — structured security event logging and agent trust scoring.
 *
 * Persists events to the security_events table and broadcasts via the event bus.
 * Trust scores are recalculated on each security event using weighted factors.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logSecurityEvent = logSecurityEvent;
exports.updateAgentTrustScore = updateAgentTrustScore;
exports.getSecurityPosture = getSecurityPosture;
const db_1 = require("@/lib/db");
const event_bus_1 = require("@/lib/event-bus");
const TRUST_WEIGHTS = {
    'auth.failure': { field: 'auth_failures', delta: -0.05 },
    'injection.attempt': { field: 'injection_attempts', delta: -0.15 },
    'rate_limit.hit': { field: 'rate_limit_hits', delta: -0.03 },
    'secret.exposure': { field: 'secret_exposures', delta: -0.20 },
    'task.success': { field: 'successful_tasks', delta: 0.02 },
    'task.failure': { field: 'failed_tasks', delta: -0.01 },
};
function logSecurityEvent(event) {
    var _a, _b, _c, _d, _e, _f, _g;
    const db = (0, db_1.getDatabase)();
    const severity = (_a = event.severity) !== null && _a !== void 0 ? _a : 'info';
    const workspaceId = (_b = event.workspace_id) !== null && _b !== void 0 ? _b : 1;
    const tenantId = (_c = event.tenant_id) !== null && _c !== void 0 ? _c : 1;
    const result = db.prepare(`
    INSERT INTO security_events (event_type, severity, source, agent_name, detail, ip_address, workspace_id, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(event.event_type, severity, (_d = event.source) !== null && _d !== void 0 ? _d : null, (_e = event.agent_name) !== null && _e !== void 0 ? _e : null, (_f = event.detail) !== null && _f !== void 0 ? _f : null, (_g = event.ip_address) !== null && _g !== void 0 ? _g : null, workspaceId, tenantId);
    const id = result.lastInsertRowid;
    event_bus_1.eventBus.broadcast('security.event', Object.assign(Object.assign({ id }, event), { severity, workspace_id: workspaceId, timestamp: Math.floor(Date.now() / 1000) }));
    return id;
}
function updateAgentTrustScore(agentName, eventType, workspaceId = 1) {
    const db = (0, db_1.getDatabase)();
    const weight = TRUST_WEIGHTS[eventType];
    // Ensure row exists
    db.prepare(`
    INSERT OR IGNORE INTO agent_trust_scores (agent_name, workspace_id)
    VALUES (?, ?)
  `).run(agentName, workspaceId);
    if (weight) {
        // Increment the counter field
        db.prepare(`
      UPDATE agent_trust_scores
      SET ${weight.field} = ${weight.field} + 1,
          updated_at = unixepoch()
      WHERE agent_name = ? AND workspace_id = ?
    `).run(agentName, workspaceId);
        // Recalculate trust score (clamped 0..1)
        const row = db.prepare(`
      SELECT * FROM agent_trust_scores WHERE agent_name = ? AND workspace_id = ?
    `).get(agentName, workspaceId);
        if (row) {
            let score = 1.0;
            score += (row.auth_failures || 0) * -0.05;
            score += (row.injection_attempts || 0) * -0.15;
            score += (row.rate_limit_hits || 0) * -0.03;
            score += (row.secret_exposures || 0) * -0.20;
            score += (row.successful_tasks || 0) * 0.02;
            score += (row.failed_tasks || 0) * -0.01;
            score = Math.max(0, Math.min(1, score));
            const isAnomaly = weight.delta < 0;
            db.prepare(`
        UPDATE agent_trust_scores
        SET trust_score = ?,
            last_anomaly_at = CASE WHEN ? THEN unixepoch() ELSE last_anomaly_at END,
            updated_at = unixepoch()
        WHERE agent_name = ? AND workspace_id = ?
      `).run(score, isAnomaly ? 1 : 0, agentName, workspaceId);
        }
    }
}
function getSecurityPosture(workspaceId = 1) {
    var _a, _b, _c, _d, _e;
    const db = (0, db_1.getDatabase)();
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
      SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) as warning
    FROM security_events
    WHERE workspace_id = ?
  `).get(workspaceId);
    const recent = db.prepare(`
    SELECT COUNT(*) as count
    FROM security_events
    WHERE workspace_id = ? AND severity IN ('warning', 'critical') AND created_at > ?
  `).get(workspaceId, oneDayAgo);
    const trustAvg = db.prepare(`
    SELECT AVG(trust_score) as avg_trust
    FROM agent_trust_scores
    WHERE workspace_id = ?
  `).get(workspaceId);
    const avgTrust = (_a = trustAvg === null || trustAvg === void 0 ? void 0 : trustAvg.avg_trust) !== null && _a !== void 0 ? _a : 1.0;
    const criticalCount = (_b = totals === null || totals === void 0 ? void 0 : totals.critical) !== null && _b !== void 0 ? _b : 0;
    const warningCount = (_c = totals === null || totals === void 0 ? void 0 : totals.warning) !== null && _c !== void 0 ? _c : 0;
    const recentCount = (_d = recent === null || recent === void 0 ? void 0 : recent.count) !== null && _d !== void 0 ? _d : 0;
    // Score: start at 100, deduct for incidents
    let score = 100;
    score -= criticalCount * 10;
    score -= warningCount * 3;
    score -= recentCount * 2;
    score = Math.round(Math.max(0, Math.min(100, score * avgTrust)));
    return {
        score,
        totalEvents: (_e = totals === null || totals === void 0 ? void 0 : totals.total) !== null && _e !== void 0 ? _e : 0,
        criticalEvents: criticalCount,
        warningEvents: warningCount,
        avgTrustScore: Math.round(avgTrust * 100) / 100,
        recentIncidents: recentCount,
    };
}
