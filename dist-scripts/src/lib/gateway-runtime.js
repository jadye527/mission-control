"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMcAsDashboard = registerMcAsDashboard;
exports.getDetectedGatewayToken = getDetectedGatewayToken;
exports.getDetectedGatewayPort = getDetectedGatewayPort;
const node_fs_1 = __importDefault(require("node:fs"));
const config_1 = require("@/lib/config");
const logger_1 = require("@/lib/logger");
function readOpenClawConfig() {
    const configPath = config_1.config.openclawConfigPath;
    if (!configPath || !node_fs_1.default.existsSync(configPath))
        return null;
    try {
        const raw = node_fs_1.default.readFileSync(configPath, 'utf8');
        return JSON.parse(raw);
    }
    catch (_a) {
        return null;
    }
}
function registerMcAsDashboard(mcUrl) {
    const configPath = config_1.config.openclawConfigPath;
    if (!configPath || !node_fs_1.default.existsSync(configPath)) {
        return { registered: false, alreadySet: false };
    }
    try {
        const raw = node_fs_1.default.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        // Ensure nested structure
        if (!parsed.gateway)
            parsed.gateway = {};
        if (!parsed.gateway.controlUi)
            parsed.gateway.controlUi = {};
        const origin = new URL(mcUrl).origin;
        const origins = parsed.gateway.controlUi.allowedOrigins || [];
        const alreadyInOrigins = origins.includes(origin);
        if (alreadyInOrigins) {
            return { registered: false, alreadySet: true };
        }
        // Add MC origin to allowedOrigins only — do NOT touch dangerouslyDisableDeviceAuth.
        // MC authenticates via gateway token, but forcing device auth off is a security
        // downgrade that the operator should control, not Mission Control.
        origins.push(origin);
        parsed.gateway.controlUi.allowedOrigins = origins;
        node_fs_1.default.writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n');
        logger_1.logger.info({ origin }, 'Registered MC origin in gateway config');
        return { registered: true, alreadySet: false };
    }
    catch (err) {
        // Read-only filesystem (e.g. Docker read_only: true, or intentional mount) —
        // treat as a non-fatal skip rather than an error.
        if ((err === null || err === void 0 ? void 0 : err.code) === 'EROFS' || (err === null || err === void 0 ? void 0 : err.code) === 'EACCES' || (err === null || err === void 0 ? void 0 : err.code) === 'EPERM') {
            logger_1.logger.warn({ err, configPath }, 'Gateway config is read-only — skipping MC origin registration. ' +
                'To enable auto-registration, mount openclaw.json with write access or ' +
                'add the MC origin to gateway.controlUi.allowedOrigins manually.');
            return { registered: false, alreadySet: false };
        }
        logger_1.logger.error({ err }, 'Failed to register MC in gateway config');
        return { registered: false, alreadySet: false };
    }
}
/**
 * Returns the gateway auth credential (token or password) for Bearer/WS auth.
 * Env overrides: OPENCLAW_GATEWAY_TOKEN, GATEWAY_TOKEN, OPENCLAW_GATEWAY_PASSWORD, GATEWAY_PASSWORD.
 * From config: uses gateway.auth.token when mode is "token", gateway.auth.password when mode is "password".
 */
function getDetectedGatewayToken() {
    var _a, _b, _c;
    const envToken = (process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '').trim();
    if (envToken)
        return envToken;
    const envPassword = (process.env.OPENCLAW_GATEWAY_PASSWORD || process.env.GATEWAY_PASSWORD || '').trim();
    if (envPassword)
        return envPassword;
    const parsed = readOpenClawConfig();
    const auth = (_a = parsed === null || parsed === void 0 ? void 0 : parsed.gateway) === null || _a === void 0 ? void 0 : _a.auth;
    const mode = (auth === null || auth === void 0 ? void 0 : auth.mode) === 'password' ? 'password' : 'token';
    const credential = mode === 'password'
        ? String((_b = auth === null || auth === void 0 ? void 0 : auth.password) !== null && _b !== void 0 ? _b : '').trim()
        : String((_c = auth === null || auth === void 0 ? void 0 : auth.token) !== null && _c !== void 0 ? _c : '').trim();
    return credential;
}
function getDetectedGatewayPort() {
    var _a;
    const envPort = Number(process.env.OPENCLAW_GATEWAY_PORT || process.env.GATEWAY_PORT || '');
    if (Number.isFinite(envPort) && envPort > 0)
        return envPort;
    const parsed = readOpenClawConfig();
    const cfgPort = Number(((_a = parsed === null || parsed === void 0 ? void 0 : parsed.gateway) === null || _a === void 0 ? void 0 : _a.port) || 0);
    return Number.isFinite(cfgPort) && cfgPort > 0 ? cfgPort : null;
}
