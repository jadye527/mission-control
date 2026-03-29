"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
const path_1 = require("path");
const config_1 = require("@/lib/config");
const db_1 = require("@/lib/db");
const paths_1 = require("@/lib/paths");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const memory_utils_1 = require("@/lib/memory-utils");
const MEMORY_PATH = config_1.config.memoryDir;
const MEMORY_ALLOWED_PREFIXES = (config_1.config.memoryAllowedPrefixes || []).map((p) => p.replace(/\\/g, '/'));
// Ensure memory directory exists on startup
if (MEMORY_PATH && !(0, fs_1.existsSync)(MEMORY_PATH)) {
    try {
        (0, fs_1.mkdirSync)(MEMORY_PATH, { recursive: true });
    }
    catch ( /* ignore */_a) { /* ignore */ }
}
function normalizeRelativePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}
function isPathAllowed(relativePath) {
    if (!MEMORY_ALLOWED_PREFIXES.length)
        return true;
    const normalized = normalizeRelativePath(relativePath);
    return MEMORY_ALLOWED_PREFIXES.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}
function isWithinBase(base, candidate) {
    if (candidate === base)
        return true;
    return candidate.startsWith(base + path_1.sep);
}
async function resolveSafeMemoryPath(baseDir, relativePath) {
    const baseReal = await (0, promises_1.realpath)(baseDir);
    const fullPath = (0, paths_1.resolveWithin)(baseDir, relativePath);
    // For non-existent targets, validate containment using the nearest existing ancestor.
    // This allows nested creates (mkdir -p) while still blocking symlink escapes.
    let current = (0, path_1.dirname)(fullPath);
    let parentReal = '';
    while (!parentReal) {
        try {
            parentReal = await (0, promises_1.realpath)(current);
        }
        catch (err) {
            const code = err.code;
            if (code !== 'ENOENT')
                throw err;
            const next = (0, path_1.dirname)(current);
            if (next === current) {
                throw new Error('Parent directory not found');
            }
            current = next;
        }
    }
    if (!isWithinBase(baseReal, parentReal)) {
        throw new Error('Path escapes base directory (symlink)');
    }
    // If the file exists, ensure it also resolves within base and is not a symlink.
    try {
        const st = await (0, promises_1.lstat)(fullPath);
        if (st.isSymbolicLink()) {
            throw new Error('Symbolic links are not allowed');
        }
        const fileReal = await (0, promises_1.realpath)(fullPath);
        if (!isWithinBase(baseReal, fileReal)) {
            throw new Error('Path escapes base directory (symlink)');
        }
    }
    catch (err) {
        const code = err.code;
        if (code !== 'ENOENT') {
            throw err;
        }
    }
    return fullPath;
}
async function buildFileTree(dirPath, relativePath = '', maxDepth = Number.POSITIVE_INFINITY) {
    try {
        const items = await (0, promises_1.readdir)(dirPath, { withFileTypes: true });
        const files = [];
        for (const item of items) {
            if (item.isSymbolicLink()) {
                continue;
            }
            const itemPath = (0, path_1.join)(dirPath, item.name);
            const itemRelativePath = (0, path_1.join)(relativePath, item.name);
            try {
                const stats = await (0, promises_1.stat)(itemPath);
                if (item.isDirectory()) {
                    const children = maxDepth > 0
                        ? await buildFileTree(itemPath, itemRelativePath, maxDepth - 1)
                        : undefined;
                    files.push({
                        path: itemRelativePath,
                        name: item.name,
                        type: 'directory',
                        modified: stats.mtime.getTime(),
                        children
                    });
                }
                else if (item.isFile()) {
                    files.push({
                        path: itemRelativePath,
                        name: item.name,
                        type: 'file',
                        size: stats.size,
                        modified: stats.mtime.getTime()
                    });
                }
            }
            catch (error) {
                logger_1.logger.error({ err: error, path: itemPath }, 'Error reading file');
            }
        }
        return files.sort((a, b) => {
            // Directories first, then files, alphabetical within each type
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error, path: dirPath }, 'Error reading directory');
        return [];
    }
}
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.readLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const { searchParams } = new URL(request.url);
        const path = searchParams.get('path');
        const action = searchParams.get('action');
        const depthParam = Number.parseInt(searchParams.get('depth') || '', 10);
        const maxDepth = Number.isFinite(depthParam) ? Math.max(0, Math.min(depthParam, 8)) : Number.POSITIVE_INFINITY;
        if (action === 'tree') {
            // Return the file tree
            if (!MEMORY_PATH) {
                return server_1.NextResponse.json({ tree: [] });
            }
            if (path) {
                if (!isPathAllowed(path)) {
                    return server_1.NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
                }
                const fullPath = await resolveSafeMemoryPath(MEMORY_PATH, path);
                const stats = await (0, promises_1.stat)(fullPath).catch(() => null);
                if (!(stats === null || stats === void 0 ? void 0 : stats.isDirectory())) {
                    return server_1.NextResponse.json({ error: 'Directory not found' }, { status: 404 });
                }
                const tree = await buildFileTree(fullPath, path, maxDepth);
                return server_1.NextResponse.json({ tree });
            }
            if (MEMORY_ALLOWED_PREFIXES.length) {
                const tree = [];
                for (const prefix of MEMORY_ALLOWED_PREFIXES) {
                    const folder = prefix.replace(/\/$/, '');
                    const fullPath = (0, path_1.join)(MEMORY_PATH, folder);
                    if (!(0, fs_1.existsSync)(fullPath))
                        continue;
                    try {
                        const stats = await (0, promises_1.stat)(fullPath);
                        if (!stats.isDirectory())
                            continue;
                        tree.push({
                            path: folder,
                            name: folder,
                            type: 'directory',
                            modified: stats.mtime.getTime(),
                            children: await buildFileTree(fullPath, folder, maxDepth),
                        });
                    }
                    catch (_a) {
                        // Skip unreadable roots
                    }
                }
                return server_1.NextResponse.json({ tree });
            }
            const tree = await buildFileTree(MEMORY_PATH, '', maxDepth);
            return server_1.NextResponse.json({ tree });
        }
        if (action === 'content' && path) {
            // Return file content
            if (!isPathAllowed(path)) {
                return server_1.NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
            }
            if (!MEMORY_PATH) {
                return server_1.NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });
            }
            const fullPath = await resolveSafeMemoryPath(MEMORY_PATH, path);
            try {
                const content = await (0, promises_1.readFile)(fullPath, 'utf-8');
                const stats = await (0, promises_1.stat)(fullPath);
                // Extract wiki-links and schema validation for .md files
                const isMarkdown = path.endsWith('.md');
                const wikiLinks = isMarkdown ? (0, memory_utils_1.extractWikiLinks)(content) : [];
                const schemaResult = isMarkdown ? (0, memory_utils_1.validateSchema)(content) : null;
                return server_1.NextResponse.json({
                    content,
                    size: stats.size,
                    modified: stats.mtime.getTime(),
                    path,
                    wikiLinks,
                    schema: schemaResult,
                });
            }
            catch (error) {
                return server_1.NextResponse.json({ error: 'File not found' }, { status: 404 });
            }
        }
        if (action === 'search') {
            const query = searchParams.get('query');
            if (!query) {
                return server_1.NextResponse.json({ error: 'Query required' }, { status: 400 });
            }
            if (!MEMORY_PATH) {
                return server_1.NextResponse.json({ query, results: [] });
            }
            // Simple file search - in production you'd want a more sophisticated search
            const results = [];
            const searchInFile = async (filePath, relativePath) => {
                try {
                    const st = await (0, promises_1.stat)(filePath);
                    // Avoid large-file scanning and memory blowups.
                    if (st.size > 1000000) {
                        return;
                    }
                    const content = await (0, promises_1.readFile)(filePath, 'utf-8');
                    const haystack = content.toLowerCase();
                    const needle = query.toLowerCase();
                    if (!needle)
                        return;
                    let matches = 0;
                    let idx = haystack.indexOf(needle);
                    while (idx !== -1) {
                        matches += 1;
                        idx = haystack.indexOf(needle, idx + needle.length);
                    }
                    if (matches > 0) {
                        results.push({
                            path: relativePath,
                            name: relativePath.split('/').pop() || '',
                            matches
                        });
                    }
                }
                catch (error) {
                    // Skip files that can't be read
                }
            };
            const searchDirectory = async (dirPath, relativePath = '') => {
                try {
                    const items = await (0, promises_1.readdir)(dirPath, { withFileTypes: true });
                    for (const item of items) {
                        if (item.isSymbolicLink()) {
                            continue;
                        }
                        const itemPath = (0, path_1.join)(dirPath, item.name);
                        const itemRelativePath = (0, path_1.join)(relativePath, item.name);
                        if (item.isDirectory()) {
                            await searchDirectory(itemPath, itemRelativePath);
                        }
                        else if (item.isFile() && (item.name.endsWith('.md') || item.name.endsWith('.txt'))) {
                            await searchInFile(itemPath, itemRelativePath);
                        }
                    }
                }
                catch (error) {
                    logger_1.logger.error({ err: error, path: dirPath }, 'Error searching directory');
                }
            };
            if (MEMORY_ALLOWED_PREFIXES.length) {
                for (const prefix of MEMORY_ALLOWED_PREFIXES) {
                    const folder = prefix.replace(/\/$/, '');
                    const fullPath = (0, path_1.join)(MEMORY_PATH, folder);
                    if (!(0, fs_1.existsSync)(fullPath))
                        continue;
                    await searchDirectory(fullPath, folder);
                }
            }
            else {
                await searchDirectory(MEMORY_PATH);
            }
            return server_1.NextResponse.json({
                query,
                results: results.sort((a, b) => b.matches - a.matches)
            });
        }
        return server_1.NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Memory API error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
async function POST(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const body = await request.json();
        const { action, path, content } = body;
        if (!path) {
            return server_1.NextResponse.json({ error: 'Path is required' }, { status: 400 });
        }
        if (!isPathAllowed(path)) {
            return server_1.NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
        }
        if (!MEMORY_PATH) {
            return server_1.NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });
        }
        const fullPath = await resolveSafeMemoryPath(MEMORY_PATH, path);
        if (action === 'save') {
            // Save file content
            if (content === undefined) {
                return server_1.NextResponse.json({ error: 'Content is required for save action' }, { status: 400 });
            }
            // Validate schema if present (warn but don't block save)
            const schemaResult = path.endsWith('.md') ? (0, memory_utils_1.validateSchema)(content) : null;
            const schemaWarnings = (_a = schemaResult === null || schemaResult === void 0 ? void 0 : schemaResult.errors) !== null && _a !== void 0 ? _a : [];
            await (0, promises_1.writeFile)(fullPath, content, 'utf-8');
            try {
                db_1.db_helpers.logActivity('memory_file_saved', 'memory', 0, auth.user.username || 'unknown', `Updated ${path}`, { path, size: content.length });
            }
            catch ( /* best-effort */_b) { /* best-effort */ }
            return server_1.NextResponse.json({
                success: true,
                message: 'File saved successfully',
                schemaWarnings,
            });
        }
        if (action === 'create') {
            // Create new file
            const dirPath = (0, path_1.dirname)(fullPath);
            // Ensure directory exists
            try {
                await (0, promises_1.mkdir)(dirPath, { recursive: true });
            }
            catch (error) {
                // Directory might already exist
            }
            // Check if file already exists
            try {
                await (0, promises_1.stat)(fullPath);
                return server_1.NextResponse.json({ error: 'File already exists' }, { status: 409 });
            }
            catch (error) {
                // File doesn't exist, which is what we want
            }
            await (0, promises_1.writeFile)(fullPath, content || '', 'utf-8');
            try {
                db_1.db_helpers.logActivity('memory_file_created', 'memory', 0, auth.user.username || 'unknown', `Created ${path}`, { path });
            }
            catch ( /* best-effort */_c) { /* best-effort */ }
            return server_1.NextResponse.json({ success: true, message: 'File created successfully' });
        }
        return server_1.NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Memory POST API error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
async function DELETE(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const body = await request.json();
        const { action, path } = body;
        if (!path) {
            return server_1.NextResponse.json({ error: 'Path is required' }, { status: 400 });
        }
        if (!isPathAllowed(path)) {
            return server_1.NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
        }
        if (!MEMORY_PATH) {
            return server_1.NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 });
        }
        const fullPath = await resolveSafeMemoryPath(MEMORY_PATH, path);
        if (action === 'delete') {
            // Check if file exists
            try {
                await (0, promises_1.stat)(fullPath);
            }
            catch (error) {
                return server_1.NextResponse.json({ error: 'File not found' }, { status: 404 });
            }
            await (0, promises_1.unlink)(fullPath);
            try {
                db_1.db_helpers.logActivity('memory_file_deleted', 'memory', 0, auth.user.username || 'unknown', `Deleted ${path}`, { path });
            }
            catch ( /* best-effort */_a) { /* best-effort */ }
            return server_1.NextResponse.json({ success: true, message: 'File deleted successfully' });
        }
        return server_1.NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Memory DELETE API error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
