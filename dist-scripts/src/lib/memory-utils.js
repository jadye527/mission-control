"use strict";
/**
 * Memory utilities — wiki-link extraction, schema validation, health diagnostics,
 * MOC generation. Inspired by Ars Contexta's knowledge graph primitives.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractWikiLinks = extractWikiLinks;
exports.extractSchema = extractSchema;
exports.validateSchema = validateSchema;
exports.scanMemoryFiles = scanMemoryFiles;
exports.buildLinkGraph = buildLinkGraph;
exports.runHealthDiagnostics = runHealthDiagnostics;
exports.generateMOCs = generateMOCs;
exports.generateContextPayload = generateContextPayload;
exports.reflectPass = reflectPass;
exports.reweavePass = reweavePass;
const promises_1 = require("fs/promises");
const path_1 = require("path");
// ─── Wiki-link extraction ────────────────────────────────────────
const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
function extractWikiLinks(content) {
    const links = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        let match;
        const re = new RegExp(WIKI_LINK_RE.source, WIKI_LINK_RE.flags);
        while ((match = re.exec(lines[i])) !== null) {
            links.push({
                target: match[1].trim(),
                display: (match[2] || match[1]).trim(),
                line: i + 1,
            });
        }
    }
    return links;
}
/**
 * Extract a _schema YAML block from markdown frontmatter.
 * Expects format:
 * ```
 * ---
 * _schema:
 *   type: note
 *   required: [title, tags]
 *   optional: [source]
 * ---
 * ```
 */
function extractSchema(content) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch)
        return null;
    const fm = fmMatch[1];
    const schemaMatch = fm.match(/_schema:\s*\n((?:\s{2,}.+\n?)*)/);
    if (!schemaMatch)
        return null;
    const block = schemaMatch[1];
    const schema = { type: 'unknown' };
    const typeMatch = block.match(/type:\s*(.+)/);
    if (typeMatch)
        schema.type = typeMatch[1].trim();
    const requiredMatch = block.match(/required:\s*\[([^\]]*)\]/);
    if (requiredMatch) {
        schema.required = requiredMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    }
    const optionalMatch = block.match(/optional:\s*\[([^\]]*)\]/);
    if (optionalMatch) {
        schema.optional = optionalMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    }
    return schema;
}
/**
 * Validate frontmatter fields against a _schema block.
 */
function validateSchema(content) {
    const schema = extractSchema(content);
    if (!schema)
        return { valid: true, errors: [], schema: null };
    const errors = [];
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
        return { valid: false, errors: ['No frontmatter found but _schema declared'], schema };
    }
    const fm = fmMatch[1];
    const fields = new Set();
    for (const line of fm.split('\n')) {
        const fieldMatch = line.match(/^(\w[\w-]*):\s*/);
        if (fieldMatch)
            fields.add(fieldMatch[1]);
    }
    if (schema.required) {
        for (const field of schema.required) {
            if (!fields.has(field)) {
                errors.push(`Missing required field: ${field}`);
            }
        }
    }
    return { valid: errors.length === 0, errors, schema };
}
/**
 * Recursively scan a directory for markdown/text files, skipping symlinks.
 * Caps at 2000 files to prevent runaway scans.
 */
async function scanMemoryFiles(baseDir, opts) {
    var _a, _b;
    const extensions = (_a = opts === null || opts === void 0 ? void 0 : opts.extensions) !== null && _a !== void 0 ? _a : ['.md', '.txt'];
    const maxFiles = (_b = opts === null || opts === void 0 ? void 0 : opts.maxFiles) !== null && _b !== void 0 ? _b : 2000;
    const results = [];
    async function walk(dir) {
        if (results.length >= maxFiles)
            return;
        let entries;
        try {
            entries = await (0, promises_1.readdir)(dir, { withFileTypes: true });
        }
        catch (_a) {
            return;
        }
        for (const entry of entries) {
            if (results.length >= maxFiles)
                break;
            if (entry.isSymbolicLink())
                continue;
            const fullPath = (0, path_1.join)(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            }
            else if (entry.isFile() && extensions.includes((0, path_1.extname)(entry.name).toLowerCase())) {
                try {
                    const st = await (0, promises_1.stat)(fullPath);
                    if (st.size > 1000000)
                        continue; // skip >1MB
                    results.push({
                        path: (0, path_1.relative)(baseDir, fullPath),
                        name: entry.name,
                        size: st.size,
                        modified: st.mtime.getTime(),
                    });
                }
                catch (_b) {
                    // skip unreadable
                }
            }
        }
    }
    await walk(baseDir);
    return results;
}
/**
 * Build a complete wiki-link graph from all markdown files in a directory.
 */
async function buildLinkGraph(baseDir) {
    const files = await scanMemoryFiles(baseDir, { extensions: ['.md'] });
    const nodes = {};
    // Build a lookup: stem -> relative path
    const stemToPath = new Map();
    for (const f of files) {
        const stem = (0, path_1.basename)(f.path, (0, path_1.extname)(f.path));
        // Prefer shorter paths for collision (closer to root = more canonical)
        if (!stemToPath.has(stem) || f.path.length < stemToPath.get(stem).length) {
            stemToPath.set(stem, f.path);
        }
    }
    // First pass: extract links from each file
    for (const f of files) {
        try {
            const content = await (0, promises_1.readFile)((0, path_1.join)(baseDir, f.path), 'utf-8');
            const wikiLinks = extractWikiLinks(content);
            const schema = extractSchema(content);
            const outgoing = [];
            for (const link of wikiLinks) {
                const resolved = stemToPath.get(link.target);
                if (resolved && resolved !== f.path) {
                    outgoing.push(resolved);
                }
            }
            nodes[f.path] = {
                path: f.path,
                name: f.name,
                outgoing: [...new Set(outgoing)],
                incoming: [],
                wikiLinks,
                schema,
            };
        }
        catch (_a) {
            // skip unreadable files
        }
    }
    // Second pass: compute incoming links
    let totalLinks = 0;
    for (const node of Object.values(nodes)) {
        for (const target of node.outgoing) {
            if (nodes[target]) {
                nodes[target].incoming.push(node.path);
            }
            totalLinks++;
        }
    }
    // Find orphans (no incoming or outgoing links)
    const orphans = Object.values(nodes)
        .filter((n) => n.incoming.length === 0 && n.outgoing.length === 0)
        .map((n) => n.path);
    return {
        nodes,
        totalFiles: Object.keys(nodes).length,
        totalLinks,
        orphans,
    };
}
async function runHealthDiagnostics(baseDir) {
    const files = await scanMemoryFiles(baseDir, { extensions: ['.md'] });
    const graph = await buildLinkGraph(baseDir);
    const categories = [];
    // 1. Schema compliance
    {
        let filesWithSchema = 0;
        let validSchemas = 0;
        const schemaIssues = [];
        for (const f of files) {
            try {
                const content = await (0, promises_1.readFile)((0, path_1.join)(baseDir, f.path), 'utf-8');
                const result = validateSchema(content);
                if (result.schema) {
                    filesWithSchema++;
                    if (result.valid)
                        validSchemas++;
                    else
                        schemaIssues.push(`${f.path}: ${result.errors.join(', ')}`);
                }
            }
            catch ( /* skip */_a) { /* skip */ }
        }
        const score = filesWithSchema === 0 ? 100 : Math.round((validSchemas / filesWithSchema) * 100);
        categories.push({
            name: 'Schema Compliance',
            status: score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical',
            score,
            issues: schemaIssues.slice(0, 10),
            suggestions: filesWithSchema === 0
                ? ['Add _schema blocks to frontmatter for structured validation']
                : schemaIssues.length > 0
                    ? ['Fix missing required fields in flagged files']
                    : [],
        });
    }
    // 2. Connectivity (wiki-link health)
    {
        const totalFiles = graph.totalFiles;
        const orphanCount = graph.orphans.length;
        const connectedRatio = totalFiles > 0 ? (totalFiles - orphanCount) / totalFiles : 1;
        const score = Math.round(connectedRatio * 100);
        categories.push({
            name: 'Connectivity',
            status: score >= 70 ? 'healthy' : score >= 40 ? 'warning' : 'critical',
            score,
            issues: orphanCount > 0
                ? [`${orphanCount} orphan file(s) with no [[wiki-links]] in or out`]
                : [],
            suggestions: orphanCount > 0
                ? [
                    'Add [[wiki-links]] to connect orphan files',
                    'Run MOC generation to auto-create index files',
                ]
                : [],
        });
    }
    // 3. Broken links
    {
        const brokenLinks = [];
        const stemToPath = new Map();
        for (const f of files) {
            stemToPath.set((0, path_1.basename)(f.path, (0, path_1.extname)(f.path)), f.path);
        }
        for (const node of Object.values(graph.nodes)) {
            for (const link of node.wikiLinks) {
                if (!stemToPath.has(link.target)) {
                    brokenLinks.push(`${node.path}:${link.line} -> [[${link.target}]]`);
                }
            }
        }
        const totalLinks = Object.values(graph.nodes).reduce((s, n) => s + n.wikiLinks.length, 0);
        const brokenRatio = totalLinks > 0 ? brokenLinks.length / totalLinks : 0;
        const score = Math.round((1 - brokenRatio) * 100);
        categories.push({
            name: 'Link Integrity',
            status: score >= 90 ? 'healthy' : score >= 70 ? 'warning' : 'critical',
            score,
            issues: brokenLinks.slice(0, 10),
            suggestions: brokenLinks.length > 0
                ? ['Create missing target files or fix link targets']
                : [],
        });
    }
    // 4. Staleness (files not modified in 30+ days)
    {
        const now = Date.now();
        const staleThreshold = 30 * 24 * 60 * 60 * 1000;
        const staleFiles = files.filter((f) => now - f.modified > staleThreshold);
        const staleRatio = files.length > 0 ? staleFiles.length / files.length : 0;
        const score = Math.round((1 - staleRatio * 0.5) * 100); // half-weight staleness
        categories.push({
            name: 'Freshness',
            status: score >= 80 ? 'healthy' : score >= 60 ? 'warning' : 'critical',
            score,
            issues: staleFiles.length > 0
                ? [`${staleFiles.length} file(s) not updated in 30+ days`]
                : [],
            suggestions: staleFiles.length > 0
                ? ['Review stale files for relevance', 'Run a /reweave pass to update older notes']
                : [],
        });
    }
    // 5. File size distribution (too large = not atomic)
    {
        const largeFiles = files.filter((f) => f.size > 10000); // >10KB
        const largeRatio = files.length > 0 ? largeFiles.length / files.length : 0;
        const score = Math.round((1 - largeRatio * 0.8) * 100);
        categories.push({
            name: 'Atomicity',
            status: score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical',
            score,
            issues: largeFiles.length > 0
                ? [`${largeFiles.length} file(s) exceed 10KB — consider splitting into atomic notes`]
                : [],
            suggestions: largeFiles.length > 0
                ? ['Break large files into focused atomic notes with wiki-links between them']
                : [],
        });
    }
    // 6. Naming conventions
    {
        const badNames = [];
        for (const f of files) {
            const stem = (0, path_1.basename)(f.path, (0, path_1.extname)(f.path));
            if (/[A-Z]/.test(stem) && /\s/.test(stem)) {
                badNames.push(f.path);
            }
            if (/^(untitled|new-file|document|temp)/i.test(stem)) {
                badNames.push(f.path);
            }
        }
        const unique = [...new Set(badNames)];
        const score = files.length > 0 ? Math.round(((files.length - unique.length) / files.length) * 100) : 100;
        categories.push({
            name: 'Naming Conventions',
            status: score >= 90 ? 'healthy' : score >= 70 ? 'warning' : 'critical',
            score,
            issues: unique.slice(0, 10).map((p) => `Non-standard name: ${p}`),
            suggestions: unique.length > 0
                ? ['Use lowercase-kebab-case for file names', 'Avoid generic names like untitled or temp']
                : [],
        });
    }
    // 7. Directory structure
    {
        const rootFiles = files.filter((f) => !f.path.includes('/') && !f.path.includes('\\'));
        const rootRatio = files.length > 0 ? rootFiles.length / files.length : 0;
        const score = rootRatio > 0.5 ? Math.round((1 - rootRatio) * 100) : 100;
        categories.push({
            name: 'Organization',
            status: score >= 70 ? 'healthy' : score >= 40 ? 'warning' : 'critical',
            score,
            issues: rootRatio > 0.5
                ? [`${rootFiles.length}/${files.length} files at root level — organize into directories`]
                : [],
            suggestions: rootRatio > 0.5
                ? ['Create topic directories to group related notes', 'Use MOC files as directory indexes']
                : [],
        });
    }
    // 8. Description quality (frontmatter description field)
    {
        let withDescription = 0;
        for (const f of files) {
            try {
                const content = await (0, promises_1.readFile)((0, path_1.join)(baseDir, f.path), 'utf-8');
                const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
                if (fmMatch && /description:\s*.+/.test(fmMatch[1])) {
                    withDescription++;
                }
            }
            catch ( /* skip */_b) { /* skip */ }
        }
        const score = files.length > 0 ? Math.round((withDescription / files.length) * 100) : 100;
        categories.push({
            name: 'Description Quality',
            status: score >= 60 ? 'healthy' : score >= 30 ? 'warning' : 'critical',
            score,
            issues: score < 60
                ? [`Only ${withDescription}/${files.length} files have description fields`]
                : [],
            suggestions: score < 60
                ? ['Add description: field to frontmatter for better discoverability']
                : [],
        });
    }
    // Compute overall
    const overallScore = categories.length > 0
        ? Math.round(categories.reduce((s, c) => s + c.score, 0) / categories.length)
        : 100;
    const overall = overallScore >= 70 ? 'healthy' : overallScore >= 40 ? 'warning' : 'critical';
    return {
        overall,
        overallScore,
        categories,
        generatedAt: Date.now(),
    };
}
/**
 * Auto-generate Maps of Content by grouping files by directory
 * and sorting by connectivity.
 */
async function generateMOCs(baseDir) {
    const graph = await buildLinkGraph(baseDir);
    const dirMap = new Map();
    for (const node of Object.values(graph.nodes)) {
        const dir = (0, path_1.dirname)(node.path);
        const dirKey = dir === '.' ? '(root)' : dir;
        if (!dirMap.has(dirKey))
            dirMap.set(dirKey, []);
        // Extract title from first H1 or filename
        let title = (0, path_1.basename)(node.path, (0, path_1.extname)(node.path));
        try {
            const content = await (0, promises_1.readFile)((0, path_1.join)(baseDir, node.path), 'utf-8');
            const h1Match = content.match(/^#\s+(.+)/m);
            if (h1Match)
                title = h1Match[1].trim();
        }
        catch ( /* use filename */_a) { /* use filename */ }
        dirMap.get(dirKey).push({
            title,
            path: node.path,
            linkCount: node.incoming.length + node.outgoing.length,
        });
    }
    // Sort entries within each group by connectivity (most linked first)
    const groups = [];
    for (const [directory, entries] of dirMap.entries()) {
        entries.sort((a, b) => b.linkCount - a.linkCount);
        groups.push({ directory, entries });
    }
    // Sort groups by total connectivity
    groups.sort((a, b) => {
        const aTotal = a.entries.reduce((s, e) => s + e.linkCount, 0);
        const bTotal = b.entries.reduce((s, e) => s + e.linkCount, 0);
        return bTotal - aTotal;
    });
    return groups;
}
/**
 * Generate a context injection payload for agent session start.
 * Provides workspace overview, recent files, and maintenance alerts.
 */
async function generateContextPayload(baseDir) {
    const files = await scanMemoryFiles(baseDir);
    // File tree (just paths)
    const fileTree = files.map((f) => f.path).sort();
    // Recent files (last 10 modified)
    const recentFiles = [...files]
        .sort((a, b) => b.modified - a.modified)
        .slice(0, 10)
        .map((f) => ({ path: f.path, modified: f.modified }));
    // Quick health summary (lightweight — just check orphans and staleness)
    const graph = await buildLinkGraph(baseDir);
    const now = Date.now();
    const staleThreshold = 30 * 24 * 60 * 60 * 1000;
    const staleCount = files.filter((f) => now - f.modified > staleThreshold).length;
    const orphanCount = graph.orphans.length;
    const totalFiles = files.length;
    const connectedRatio = totalFiles > 0 ? (totalFiles - orphanCount) / totalFiles : 1;
    const staleRatio = totalFiles > 0 ? staleCount / totalFiles : 0;
    const quickScore = Math.round(((connectedRatio + (1 - staleRatio)) / 2) * 100);
    const overall = quickScore >= 70 ? 'healthy' : quickScore >= 40 ? 'warning' : 'critical';
    // Maintenance signals
    const signals = [];
    if (orphanCount > 5)
        signals.push(`${orphanCount} orphan files need wiki-links`);
    if (staleRatio > 0.3)
        signals.push(`${staleCount} files stale (30+ days)`);
    if (graph.totalLinks === 0 && totalFiles > 3)
        signals.push('No wiki-links found — consider adding [[connections]]');
    return {
        fileTree,
        recentFiles,
        healthSummary: { overall, score: quickScore },
        maintenanceSignals: signals,
    };
}
/**
 * Generate a "reflect" report — identify connection opportunities between files.
 */
async function reflectPass(baseDir) {
    const graph = await buildLinkGraph(baseDir);
    const suggestions = [];
    // Find files that share directory but aren't linked
    const dirGroups = new Map();
    for (const node of Object.values(graph.nodes)) {
        const dir = (0, path_1.dirname)(node.path);
        if (!dirGroups.has(dir))
            dirGroups.set(dir, []);
        dirGroups.get(dir).push(node.path);
    }
    for (const [dir, paths] of dirGroups) {
        for (let i = 0; i < paths.length; i++) {
            for (let j = i + 1; j < paths.length; j++) {
                const a = graph.nodes[paths[i]];
                const b = graph.nodes[paths[j]];
                if (a && b) {
                    const linked = a.outgoing.includes(b.path) || b.outgoing.includes(a.path);
                    if (!linked) {
                        suggestions.push(`Consider linking [[${(0, path_1.basename)(a.path, (0, path_1.extname)(a.path))}]] <-> [[${(0, path_1.basename)(b.path, (0, path_1.extname)(b.path))}]] (same directory: ${dir})`);
                    }
                }
            }
        }
    }
    return {
        action: 'reflect',
        filesProcessed: graph.totalFiles,
        changes: [],
        suggestions: suggestions.slice(0, 20),
    };
}
/**
 * Generate a "reweave" report — find stale files that could be updated
 * with context from newer files.
 */
async function reweavePass(baseDir) {
    const files = await scanMemoryFiles(baseDir, { extensions: ['.md'] });
    const graph = await buildLinkGraph(baseDir);
    const now = Date.now();
    const staleThreshold = 14 * 24 * 60 * 60 * 1000; // 14 days
    const suggestions = [];
    // Find stale files that have newer linked files
    for (const f of files) {
        if (now - f.modified > staleThreshold) {
            const node = graph.nodes[f.path];
            if (!node)
                continue;
            // Check if any linked files are newer
            const newerLinks = [...node.incoming, ...node.outgoing].filter((linked) => {
                const linkedFile = files.find((lf) => lf.path === linked);
                return linkedFile && linkedFile.modified > f.modified;
            });
            if (newerLinks.length > 0) {
                suggestions.push(`${f.path} is stale but has ${newerLinks.length} newer linked file(s) — review for updates`);
            }
        }
    }
    return {
        action: 'reweave',
        filesProcessed: files.length,
        changes: [],
        suggestions: suggestions.slice(0, 20),
    };
}
