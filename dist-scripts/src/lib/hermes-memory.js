"use strict";
/**
 * Hermes Memory Scanner
 *
 * Read-only bridge that reads Hermes Agent's persistent memory files:
 * - ~/.hermes/memories/MEMORY.md — Agent's persistent memory (section-delimited entries)
 * - ~/.hermes/memories/USER.md — User profile memory
 *
 * Follows the same read-only pattern as other Hermes scanners.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHermesMemory = getHermesMemory;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const config_1 = require("./config");
const logger_1 = require("./logger");
const MEMORY_DIR = () => (0, node_path_1.join)(config_1.config.homeDir, '.hermes', 'memories');
function countSectionEntries(content) {
    if (!content)
        return 0;
    // Count section delimiters (lines starting with or containing the section sign)
    const matches = content.match(/\u00A7/g);
    return matches ? matches.length : 0;
}
function readMemoryFile(filePath) {
    if (!(0, node_fs_1.existsSync)(filePath)) {
        return { content: null, size: 0, entries: 0 };
    }
    try {
        const content = (0, node_fs_1.readFileSync)(filePath, 'utf-8');
        return {
            content,
            size: content.length,
            entries: countSectionEntries(content),
        };
    }
    catch (_a) {
        return { content: null, size: 0, entries: 0 };
    }
}
function getHermesMemory() {
    const memDir = MEMORY_DIR();
    try {
        const agent = readMemoryFile((0, node_path_1.join)(memDir, 'MEMORY.md'));
        const user = readMemoryFile((0, node_path_1.join)(memDir, 'USER.md'));
        return {
            agentMemory: agent.content,
            userMemory: user.content,
            agentMemorySize: agent.size,
            userMemorySize: user.size,
            agentMemoryEntries: agent.entries,
            userMemoryEntries: user.entries,
        };
    }
    catch (err) {
        logger_1.logger.warn({ err }, 'Failed to read Hermes memory');
        return {
            agentMemory: null,
            userMemory: null,
            agentMemorySize: 0,
            userMemorySize: 0,
            agentMemoryEntries: 0,
            userMemoryEntries: 0,
        };
    }
}
