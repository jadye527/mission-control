"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEffectiveEnvValue = getEffectiveEnvValue;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const config_1 = require("@/lib/config");
function parseEnvLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#'))
        return null;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0)
        return null;
    const key = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim();
    if (!key)
        return null;
    return { key, value };
}
async function readOpenClawEnvFile(envFilePath) {
    try {
        const raw = await (0, promises_1.readFile)(envFilePath, 'utf-8');
        const envMap = new Map();
        for (const line of raw.split('\n')) {
            const parsed = parseEnvLine(line);
            if (parsed)
                envMap.set(parsed.key, parsed.value);
        }
        return envMap;
    }
    catch (error) {
        if ((error === null || error === void 0 ? void 0 : error.code) === 'ENOENT')
            return new Map();
        throw error;
    }
}
async function getEffectiveEnvValue(key, options) {
    const envFilePath = (options === null || options === void 0 ? void 0 : options.envFilePath) || (0, node_path_1.join)(config_1.config.openclawStateDir, '.env');
    const envMap = await readOpenClawEnvFile(envFilePath);
    const fromFile = envMap.get(key);
    if (typeof fromFile === 'string' && fromFile.length > 0)
        return fromFile;
    const fromProcess = process.env[key];
    if (typeof fromProcess === 'string' && fromProcess.length > 0)
        return fromProcess;
    return '';
}
