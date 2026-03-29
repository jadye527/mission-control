"use strict";
/**
 * Hook Profiles — security hook configuration levels.
 *
 * Three profiles control how aggressively security hooks run:
 * - minimal: lightweight, no blocking
 * - standard: default, scans secrets and audits MCP calls
 * - strict: blocks on secret detection, tighter rate limits
 *
 * Profile is stored in the settings table under key 'hook_profile'.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveProfile = getActiveProfile;
exports.shouldScanSecrets = shouldScanSecrets;
exports.shouldAuditMcpCalls = shouldAuditMcpCalls;
exports.shouldBlockOnSecretDetection = shouldBlockOnSecretDetection;
exports.getRateLimitMultiplier = getRateLimitMultiplier;
const db_1 = require("@/lib/db");
const PROFILES = {
    minimal: {
        level: 'minimal',
        scanSecrets: false,
        auditMcpCalls: false,
        blockOnSecretDetection: false,
        rateLimitMultiplier: 2.0,
    },
    standard: {
        level: 'standard',
        scanSecrets: true,
        auditMcpCalls: true,
        blockOnSecretDetection: false,
        rateLimitMultiplier: 1.0,
    },
    strict: {
        level: 'strict',
        scanSecrets: true,
        auditMcpCalls: true,
        blockOnSecretDetection: true,
        rateLimitMultiplier: 0.5,
    },
};
function getActiveProfile() {
    const db = (0, db_1.getDatabase)();
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'hook_profile'`).get();
    const level = row === null || row === void 0 ? void 0 : row.value;
    if (level && PROFILES[level]) {
        return PROFILES[level];
    }
    return PROFILES.standard;
}
function shouldScanSecrets() {
    return getActiveProfile().scanSecrets;
}
function shouldAuditMcpCalls() {
    return getActiveProfile().auditMcpCalls;
}
function shouldBlockOnSecretDetection() {
    return getActiveProfile().blockOnSecretDetection;
}
function getRateLimitMultiplier() {
    return getActiveProfile().rateLimitMultiplier;
}
