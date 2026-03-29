"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
exports.PUT = PUT;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const auth_1 = require("@/lib/auth");
const paths_1 = require("@/lib/paths");
const skill_registry_1 = require("@/lib/skill-registry");
function resolveSkillRoot(envName, fallback) {
    const override = process.env[envName];
    return override && override.trim().length > 0 ? override.trim() : fallback;
}
async function pathReadable(path) {
    try {
        await (0, promises_1.access)(path, node_fs_1.constants.R_OK);
        return true;
    }
    catch (_a) {
        return false;
    }
}
async function extractDescription(skillPath) {
    const skillDocPath = (0, node_path_1.join)(skillPath, 'SKILL.md');
    if (!(await pathReadable(skillDocPath)))
        return undefined;
    try {
        const content = await (0, promises_1.readFile)(skillDocPath, 'utf8');
        const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
        const firstParagraph = lines.find((line) => !line.startsWith('#'));
        if (!firstParagraph)
            return undefined;
        return firstParagraph.length > 220 ? `${firstParagraph.slice(0, 217)}...` : firstParagraph;
    }
    catch (_a) {
        return undefined;
    }
}
async function collectSkillsFromDir(baseDir, source) {
    if (!(await pathReadable(baseDir)))
        return [];
    try {
        const entries = await (0, promises_1.readdir)(baseDir, { withFileTypes: true });
        const out = [];
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const skillPath = (0, node_path_1.join)(baseDir, entry.name);
            const skillDocPath = (0, node_path_1.join)(skillPath, 'SKILL.md');
            if (!(await pathReadable(skillDocPath)))
                continue;
            out.push({
                id: `${source}:${entry.name}`,
                name: entry.name,
                source,
                path: skillPath,
                description: await extractDescription(skillPath),
            });
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }
    catch (_a) {
        return [];
    }
}
function getSkillRoots() {
    const home = (0, node_os_1.homedir)();
    const cwd = process.cwd();
    const roots = [
        { source: 'user-agents', path: resolveSkillRoot('MC_SKILLS_USER_AGENTS_DIR', (0, node_path_1.join)(home, '.agents', 'skills')) },
        { source: 'user-codex', path: resolveSkillRoot('MC_SKILLS_USER_CODEX_DIR', (0, node_path_1.join)(home, '.codex', 'skills')) },
        { source: 'project-agents', path: resolveSkillRoot('MC_SKILLS_PROJECT_AGENTS_DIR', (0, node_path_1.join)(cwd, '.agents', 'skills')) },
        { source: 'project-codex', path: resolveSkillRoot('MC_SKILLS_PROJECT_CODEX_DIR', (0, node_path_1.join)(cwd, '.codex', 'skills')) },
    ];
    // Add OpenClaw gateway skill roots when configured
    const openclawState = process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || (0, node_path_1.join)(home, '.openclaw');
    const openclawSkills = resolveSkillRoot('MC_SKILLS_OPENCLAW_DIR', (0, node_path_1.join)(openclawState, 'skills'));
    roots.push({ source: 'openclaw', path: openclawSkills });
    // Add OpenClaw workspace-local skills (takes precedence when names conflict)
    const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR || process.env.MISSION_CONTROL_WORKSPACE_DIR || (0, node_path_1.join)(openclawState, 'workspace');
    const workspaceSkills = resolveSkillRoot('MC_SKILLS_WORKSPACE_DIR', (0, node_path_1.join)(workspaceDir, 'skills'));
    roots.push({ source: 'workspace', path: workspaceSkills });
    // Dynamic: scan for workspace-<agent> directories
    try {
        const { readdirSync, existsSync } = require('node:fs');
        const entries = readdirSync(openclawState);
        for (const entry of entries) {
            if (!entry.startsWith('workspace-'))
                continue;
            const skillsDir = (0, node_path_1.join)(openclawState, entry, 'skills');
            if (existsSync(skillsDir)) {
                const agentName = entry.replace('workspace-', '');
                roots.push({ source: `workspace-${agentName}`, path: skillsDir });
            }
        }
    }
    catch (_a) {
        // openclawBase may not exist
    }
    return roots;
}
function normalizeSkillName(raw) {
    const value = raw.trim();
    if (!value)
        return null;
    if (!/^[a-zA-Z0-9._-]+$/.test(value))
        return null;
    return value;
}
function getRootBySource(roots, sourceRaw) {
    const source = String(sourceRaw || '').trim();
    if (!source)
        return null;
    return roots.find((r) => r.source === source) || null;
}
async function upsertSkill(root, name, content) {
    const skillPath = (0, paths_1.resolveWithin)(root.path, name);
    const skillDocPath = (0, paths_1.resolveWithin)(skillPath, 'SKILL.md');
    await (0, promises_1.mkdir)(skillPath, { recursive: true });
    await (0, promises_1.writeFile)(skillDocPath, content, 'utf8');
    // Update DB hash so next sync cycle detects our write
    try {
        const { getDatabase } = await Promise.resolve().then(() => __importStar(require('@/lib/db')));
        const db = getDatabase();
        const hash = (0, node_crypto_1.createHash)('sha256').update(content, 'utf8').digest('hex');
        const now = new Date().toISOString();
        const descLines = content.split('\n').map(l => l.trim()).filter(Boolean);
        const desc = descLines.find(l => !l.startsWith('#'));
        db.prepare(`
      INSERT INTO skills (name, source, path, description, content_hash, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, name) DO UPDATE SET
        path = excluded.path,
        description = excluded.description,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at
    `).run(name, root.source, skillPath, desc ? (desc.length > 220 ? `${desc.slice(0, 217)}...` : desc) : null, hash, now, now);
    }
    catch ( /* DB not ready yet — sync will catch it */_a) { /* DB not ready yet — sync will catch it */ }
    return { skillPath, skillDocPath };
}
async function deleteSkill(root, name) {
    const skillPath = (0, paths_1.resolveWithin)(root.path, name);
    await (0, promises_1.rm)(skillPath, { recursive: true, force: true });
    // Remove from DB
    try {
        const { getDatabase } = await Promise.resolve().then(() => __importStar(require('@/lib/db')));
        const db = getDatabase();
        db.prepare('DELETE FROM skills WHERE source = ? AND name = ?').run(root.source, name);
    }
    catch ( /* best-effort */_a) { /* best-effort */ }
    return { skillPath };
}
/**
 * Try to serve skill list from DB (fast path).
 * Falls back to filesystem scan if DB has no data yet.
 */
function getSkillsFromDB() {
    try {
        const { getDatabase } = require('@/lib/db');
        const db = getDatabase();
        const rows = db.prepare('SELECT name, source, path, description, registry_slug, security_status FROM skills ORDER BY name').all();
        if (rows.length === 0)
            return null; // DB empty — fall back to fs scan
        return rows.map(r => ({
            id: `${r.source}:${r.name}`,
            name: r.name,
            source: r.source,
            path: r.path,
            description: r.description || undefined,
            registry_slug: r.registry_slug,
            security_status: r.security_status,
        }));
    }
    catch (_a) {
        return null;
    }
}
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const roots = getSkillRoots();
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode');
    if (mode === 'content') {
        const source = String(searchParams.get('source') || '');
        const name = normalizeSkillName(String(searchParams.get('name') || ''));
        if (!source || !name) {
            return server_1.NextResponse.json({ error: 'source and valid name are required' }, { status: 400 });
        }
        const root = roots.find((r) => r.source === source);
        if (!root)
            return server_1.NextResponse.json({ error: 'Invalid source' }, { status: 400 });
        const skillPath = (0, node_path_1.join)(root.path, name);
        const skillDocPath = (0, node_path_1.join)(skillPath, 'SKILL.md');
        if (!(await pathReadable(skillDocPath))) {
            return server_1.NextResponse.json({ error: 'SKILL.md not found' }, { status: 404 });
        }
        const content = await (0, promises_1.readFile)(skillDocPath, 'utf8');
        // Run security check inline
        const security = (0, skill_registry_1.checkSkillSecurity)(content);
        return server_1.NextResponse.json({
            source,
            name,
            skillPath,
            skillDocPath,
            content,
            security,
        });
    }
    if (mode === 'check') {
        // Security-check a specific skill's content
        const source = String(searchParams.get('source') || '');
        const name = normalizeSkillName(String(searchParams.get('name') || ''));
        if (!source || !name) {
            return server_1.NextResponse.json({ error: 'source and valid name are required' }, { status: 400 });
        }
        const root = roots.find((r) => r.source === source);
        if (!root)
            return server_1.NextResponse.json({ error: 'Invalid source' }, { status: 400 });
        const skillPath = (0, node_path_1.join)(root.path, name);
        const skillDocPath = (0, node_path_1.join)(skillPath, 'SKILL.md');
        if (!(await pathReadable(skillDocPath))) {
            return server_1.NextResponse.json({ error: 'SKILL.md not found' }, { status: 404 });
        }
        const content = await (0, promises_1.readFile)(skillDocPath, 'utf8');
        const security = (0, skill_registry_1.checkSkillSecurity)(content);
        // Update DB with security status
        try {
            const { getDatabase } = await Promise.resolve().then(() => __importStar(require('@/lib/db')));
            const db = getDatabase();
            db.prepare('UPDATE skills SET security_status = ?, updated_at = ? WHERE source = ? AND name = ?')
                .run(security.status, new Date().toISOString(), source, name);
        }
        catch ( /* best-effort */_a) { /* best-effort */ }
        return server_1.NextResponse.json({ source, name, security });
    }
    // Try DB-backed fast path first
    const dbSkills = getSkillsFromDB();
    if (dbSkills) {
        // Group by source for the groups response
        const groupMap = new Map();
        for (const root of roots) {
            groupMap.set(root.source, { source: root.source, path: root.path, skills: [] });
        }
        for (const skill of dbSkills) {
            // Dynamically add workspace-* groups not already in roots
            if (!groupMap.has(skill.source) && skill.source.startsWith('workspace-')) {
                groupMap.set(skill.source, { source: skill.source, path: '', skills: [] });
            }
            const group = groupMap.get(skill.source);
            if (group)
                group.skills.push(skill);
        }
        const deduped = new Map();
        for (const skill of dbSkills) {
            if (!deduped.has(skill.name))
                deduped.set(skill.name, skill);
        }
        return server_1.NextResponse.json({
            skills: Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name)),
            groups: Array.from(groupMap.values()),
            total: deduped.size,
        });
    }
    // Fallback: filesystem scan (first load before sync runs)
    const bySource = await Promise.all(roots.map(async (root) => ({
        source: root.source,
        path: root.path,
        skills: await collectSkillsFromDir(root.path, root.source),
    })));
    const all = bySource.flatMap((group) => group.skills);
    const deduped = new Map();
    for (const skill of all) {
        if (!deduped.has(skill.name))
            deduped.set(skill.name, skill);
    }
    return server_1.NextResponse.json({
        skills: Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name)),
        groups: bySource,
        total: deduped.size,
    });
}
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const roots = getSkillRoots();
    const body = await request.json().catch(() => ({}));
    const root = getRootBySource(roots, body === null || body === void 0 ? void 0 : body.source);
    const name = normalizeSkillName(String((body === null || body === void 0 ? void 0 : body.name) || ''));
    const contentRaw = typeof (body === null || body === void 0 ? void 0 : body.content) === 'string' ? body.content : '';
    const content = contentRaw.trim() || `# ${name || 'skill'}\n\nDescribe this skill.\n`;
    if (!root || !name) {
        return server_1.NextResponse.json({ error: 'Valid source and name are required' }, { status: 400 });
    }
    await (0, promises_1.mkdir)(root.path, { recursive: true });
    const { skillPath, skillDocPath } = await upsertSkill(root, name, content);
    return server_1.NextResponse.json({ ok: true, source: root.source, name, skillPath, skillDocPath });
}
async function PUT(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const roots = getSkillRoots();
    const body = await request.json().catch(() => ({}));
    const root = getRootBySource(roots, body === null || body === void 0 ? void 0 : body.source);
    const name = normalizeSkillName(String((body === null || body === void 0 ? void 0 : body.name) || ''));
    const content = typeof (body === null || body === void 0 ? void 0 : body.content) === 'string' ? body.content : null;
    if (!root || !name || content == null) {
        return server_1.NextResponse.json({ error: 'Valid source, name, and content are required' }, { status: 400 });
    }
    await (0, promises_1.mkdir)(root.path, { recursive: true });
    const { skillPath, skillDocPath } = await upsertSkill(root, name, content);
    return server_1.NextResponse.json({ ok: true, source: root.source, name, skillPath, skillDocPath });
}
async function DELETE(request) {
    const auth = (0, auth_1.requireRole)(request, 'operator');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const { searchParams } = new URL(request.url);
    const roots = getSkillRoots();
    const root = getRootBySource(roots, searchParams.get('source'));
    const name = normalizeSkillName(String(searchParams.get('name') || ''));
    if (!root || !name) {
        return server_1.NextResponse.json({ error: 'Valid source and name are required' }, { status: 400 });
    }
    const { skillPath } = await deleteSkill(root, name);
    return server_1.NextResponse.json({ ok: true, source: root.source, name, skillPath });
}
exports.dynamic = 'force-dynamic';
