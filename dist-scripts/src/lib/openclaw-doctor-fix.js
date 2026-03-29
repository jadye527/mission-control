"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.archiveOrphanTranscriptsForStateDir = archiveOrphanTranscriptsForStateDir;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function formatArchiveTimestamp(nowMs = Date.now()) {
    return new Date(nowMs).toISOString().replaceAll(':', '-');
}
function isPrimaryTranscriptFile(fileName) {
    return fileName !== 'sessions.json' && fileName.endsWith('.jsonl');
}
function collectReferencedTranscriptNames(store) {
    const referenced = new Set();
    for (const entry of Object.values(store)) {
        if (!entry || typeof entry !== 'object')
            continue;
        const record = entry;
        if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
            referenced.add(`${record.sessionId.trim()}.jsonl`);
        }
        if (typeof record.sessionFile === 'string' && record.sessionFile.trim()) {
            const sessionFileName = node_path_1.default.basename(record.sessionFile.trim());
            if (isPrimaryTranscriptFile(sessionFileName)) {
                referenced.add(sessionFileName);
            }
        }
    }
    return referenced;
}
function archiveOrphanTranscriptsForStateDir(stateDir) {
    const agentsDir = node_path_1.default.join(stateDir, 'agents');
    if (!node_fs_1.default.existsSync(agentsDir)) {
        return { archivedOrphans: 0, storesScanned: 0 };
    }
    let archivedOrphans = 0;
    let storesScanned = 0;
    for (const agentName of node_fs_1.default.readdirSync(agentsDir)) {
        const sessionsDir = node_path_1.default.join(agentsDir, agentName, 'sessions');
        const sessionsFile = node_path_1.default.join(sessionsDir, 'sessions.json');
        if (!node_fs_1.default.existsSync(sessionsFile))
            continue;
        storesScanned += 1;
        let store;
        try {
            store = JSON.parse(node_fs_1.default.readFileSync(sessionsFile, 'utf8'));
        }
        catch (_a) {
            continue;
        }
        const referenced = collectReferencedTranscriptNames(store);
        const archiveTimestamp = formatArchiveTimestamp();
        for (const entry of node_fs_1.default.readdirSync(sessionsDir, { withFileTypes: true })) {
            if (!entry.isFile() || !isPrimaryTranscriptFile(entry.name))
                continue;
            if (referenced.has(entry.name))
                continue;
            const sourcePath = node_path_1.default.join(sessionsDir, entry.name);
            const archivePath = `${sourcePath}.deleted.${archiveTimestamp}`;
            node_fs_1.default.renameSync(sourcePath, archivePath);
            archivedOrphans += 1;
        }
    }
    return { archivedOrphans, storesScanned };
}
