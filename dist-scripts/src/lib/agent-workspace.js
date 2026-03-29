"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAgentWorkspaceCandidates = getAgentWorkspaceCandidates;
exports.readAgentWorkspaceFile = readAgentWorkspaceFile;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const config_1 = require("@/lib/config");
const paths_1 = require("@/lib/paths");
function resolvePath(candidate) {
    if ((0, node_path_1.isAbsolute)(candidate))
        return (0, node_path_1.resolve)(candidate);
    if (!config_1.config.openclawStateDir)
        throw new Error('OPENCLAW_STATE_DIR not configured');
    return (0, paths_1.resolveWithin)(config_1.config.openclawStateDir, candidate);
}
function getAgentWorkspaceCandidates(agentConfig, agentName) {
    const out = [];
    const seen = new Set();
    const push = (value) => {
        if (!value)
            return;
        try {
            const resolved = resolvePath(value);
            if (seen.has(resolved))
                return;
            seen.add(resolved);
            out.push(resolved);
        }
        catch (_a) {
            // ignore invalid/out-of-bounds candidates
        }
    };
    const rawWorkspace = typeof (agentConfig === null || agentConfig === void 0 ? void 0 : agentConfig.workspace) === 'string' ? agentConfig.workspace.trim() : '';
    const openclawIdRaw = typeof (agentConfig === null || agentConfig === void 0 ? void 0 : agentConfig.openclawId) === 'string' && agentConfig.openclawId.trim()
        ? agentConfig.openclawId.trim()
        : agentName;
    const openclawId = openclawIdRaw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    push(rawWorkspace || null);
    push(`workspace-${openclawId}`);
    push(`agents/${openclawId}`);
    push('workspace');
    return out.filter((value) => (0, node_fs_1.existsSync)(value));
}
function readAgentWorkspaceFile(workspaceCandidates, names) {
    const { readFileSync } = require('node:fs');
    for (const workspace of workspaceCandidates) {
        for (const name of names) {
            try {
                const fullPath = (0, paths_1.resolveWithin)(workspace, name);
                if ((0, node_fs_1.existsSync)(fullPath)) {
                    return { content: readFileSync(fullPath, 'utf-8'), path: fullPath, exists: true };
                }
            }
            catch (_a) {
                // ignore and continue
            }
        }
    }
    return { content: '', path: null, exists: false };
}
