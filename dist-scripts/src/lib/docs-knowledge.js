"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listDocsRoots = listDocsRoots;
exports.isDocsPathAllowed = isDocsPathAllowed;
exports.getDocsTree = getDocsTree;
exports.readDocsContent = readDocsContent;
exports.searchDocs = searchDocs;
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
const path_1 = require("path");
const paths_1 = require("@/lib/paths");
const config_1 = require("@/lib/config");
const DOC_ROOT_CANDIDATES = ['docs', 'knowledge-base', 'knowledge', 'memory'];
function normalizeRelativePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}
function isWithinBase(base, candidate) {
    if (candidate === base)
        return true;
    return candidate.startsWith(base + path_1.sep);
}
async function resolveSafePath(baseDir, relativePath) {
    const baseReal = await (0, promises_1.realpath)(baseDir);
    const fullPath = (0, paths_1.resolveWithin)(baseDir, relativePath);
    let parentReal;
    try {
        parentReal = await (0, promises_1.realpath)((0, path_1.dirname)(fullPath));
    }
    catch (err) {
        const code = err.code;
        if (code === 'ENOENT')
            throw new Error('Parent directory not found');
        throw err;
    }
    if (!isWithinBase(baseReal, parentReal)) {
        throw new Error('Path escapes base directory (symlink)');
    }
    try {
        const st = await (0, promises_1.lstat)(fullPath);
        if (st.isSymbolicLink())
            throw new Error('Symbolic links are not allowed');
        const fileReal = await (0, promises_1.realpath)(fullPath);
        if (!isWithinBase(baseReal, fileReal)) {
            throw new Error('Path escapes base directory (symlink)');
        }
    }
    catch (err) {
        const code = err.code;
        if (code !== 'ENOENT')
            throw err;
    }
    return fullPath;
}
function allowedRoots(baseDir) {
    const candidateRoots = DOC_ROOT_CANDIDATES.filter((root) => (0, fs_1.existsSync)((0, path_1.join)(baseDir, root)));
    if (candidateRoots.length > 0)
        return candidateRoots;
    const fromConfig = (config_1.config.memoryAllowedPrefixes || [])
        .map((prefix) => normalizeRelativePath(prefix).replace(/\/$/, ''))
        .filter((prefix) => prefix.length > 0)
        .filter((prefix) => (0, fs_1.existsSync)((0, path_1.join)(baseDir, prefix)));
    return fromConfig;
}
function listDocsRoots() {
    const baseDir = config_1.config.memoryDir;
    if (!baseDir || !(0, fs_1.existsSync)(baseDir))
        return [];
    return allowedRoots(baseDir);
}
function isDocsPathAllowed(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized)
        return false;
    const baseDir = config_1.config.memoryDir;
    if (!baseDir || !(0, fs_1.existsSync)(baseDir))
        return false;
    const roots = allowedRoots(baseDir);
    if (roots.length === 0)
        return false;
    return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}
async function buildTreeFrom(dirPath, relativeBase) {
    const items = await (0, promises_1.readdir)(dirPath, { withFileTypes: true });
    const nodes = [];
    for (const item of items) {
        if (item.isSymbolicLink())
            continue;
        const fullPath = (0, path_1.join)(dirPath, item.name);
        const relativePath = normalizeRelativePath((0, path_1.join)(relativeBase, item.name));
        try {
            const info = await (0, promises_1.stat)(fullPath);
            if (item.isDirectory()) {
                const children = await buildTreeFrom(fullPath, relativePath);
                nodes.push({
                    path: relativePath,
                    name: item.name,
                    type: 'directory',
                    modified: info.mtime.getTime(),
                    children,
                });
            }
            else if (item.isFile()) {
                nodes.push({
                    path: relativePath,
                    name: item.name,
                    type: 'file',
                    size: info.size,
                    modified: info.mtime.getTime(),
                });
            }
        }
        catch (_a) {
            // Ignore unreadable files
        }
    }
    return nodes.sort((a, b) => {
        if (a.type !== b.type)
            return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}
async function getDocsTree() {
    const baseDir = config_1.config.memoryDir;
    if (!baseDir || !(0, fs_1.existsSync)(baseDir))
        return [];
    const roots = allowedRoots(baseDir);
    const tree = [];
    for (const root of roots) {
        const rootPath = (0, path_1.join)(baseDir, root);
        try {
            const info = await (0, promises_1.stat)(rootPath);
            if (!info.isDirectory())
                continue;
            tree.push({
                path: root,
                name: root,
                type: 'directory',
                modified: info.mtime.getTime(),
                children: await buildTreeFrom(rootPath, root),
            });
        }
        catch (_a) {
            // Ignore unreadable roots
        }
    }
    return tree;
}
async function readDocsContent(relativePath) {
    if (!isDocsPathAllowed(relativePath)) {
        throw new Error('Path not allowed');
    }
    const baseDir = config_1.config.memoryDir;
    if (!baseDir || !(0, fs_1.existsSync)(baseDir)) {
        throw new Error('Docs directory not configured');
    }
    const safePath = await resolveSafePath(baseDir, relativePath);
    const content = await (0, promises_1.readFile)(safePath, 'utf-8');
    const info = await (0, promises_1.stat)(safePath);
    return {
        content,
        size: info.size,
        modified: info.mtime.getTime(),
        path: normalizeRelativePath(relativePath),
    };
}
function isSearchable(name) {
    return name.endsWith('.md') || name.endsWith('.txt');
}
async function searchDocs(query, limit = 100) {
    const baseDir = config_1.config.memoryDir;
    if (!baseDir || !(0, fs_1.existsSync)(baseDir))
        return [];
    const roots = allowedRoots(baseDir);
    if (roots.length === 0)
        return [];
    const q = query.trim().toLowerCase();
    if (!q)
        return [];
    const results = [];
    const searchFile = async (fullPath, relativePath) => {
        try {
            const info = await (0, promises_1.stat)(fullPath);
            if (info.size > 1000000)
                return;
            const content = (await (0, promises_1.readFile)(fullPath, 'utf-8')).toLowerCase();
            let count = 0;
            let idx = content.indexOf(q);
            while (idx !== -1) {
                count += 1;
                idx = content.indexOf(q, idx + q.length);
            }
            if (count > 0) {
                results.push({
                    path: normalizeRelativePath(relativePath),
                    name: relativePath.split('/').pop() || relativePath,
                    matches: count,
                });
            }
        }
        catch (_a) {
            // Ignore unreadable files
        }
    };
    const searchDir = async (fullDir, relativeDir) => {
        const items = await (0, promises_1.readdir)(fullDir, { withFileTypes: true });
        for (const item of items) {
            if (item.isSymbolicLink())
                continue;
            const itemFull = (0, path_1.join)(fullDir, item.name);
            const itemRel = normalizeRelativePath((0, path_1.join)(relativeDir, item.name));
            if (item.isDirectory()) {
                await searchDir(itemFull, itemRel);
            }
            else if (item.isFile() && isSearchable(item.name.toLowerCase())) {
                await searchFile(itemFull, itemRel);
            }
        }
    };
    for (const root of roots) {
        const rootPath = (0, path_1.join)(baseDir, root);
        try {
            await searchDir(rootPath, root);
        }
        catch (_a) {
            // Ignore unreadable roots
        }
    }
    return results.sort((a, b) => b.matches - a.matches).slice(0, Math.max(1, Math.min(limit, 200)));
}
