/**
 * Skill Sync — Bidirectional disk ↔ DB synchronization for agent skills.
 *
 * Scans 5 skill roots for directories containing SKILL.md, hashes content,
 * and upserts into the `skills` DB table.  UI edits write through to disk
 * and update the content hash so the next sync cycle skips them.
 *
 * Conflict policy: **disk wins** when both sides change between syncs.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getDatabase } from './db';
import { logger } from './logger';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sha256(content) {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}
function extractDescription(content) {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const first = lines.find(l => !l.startsWith('#'));
    if (!first)
        return undefined;
    return first.length > 220 ? `${first.slice(0, 217)}...` : first;
}
function getSkillRoots() {
    const home = homedir();
    const cwd = process.cwd();
    const openclawState = process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || join(home, '.openclaw');
    const roots = [
        { source: 'user-agents', path: process.env.MC_SKILLS_USER_AGENTS_DIR || join(home, '.agents', 'skills') },
        { source: 'user-codex', path: process.env.MC_SKILLS_USER_CODEX_DIR || join(home, '.codex', 'skills') },
        { source: 'project-agents', path: process.env.MC_SKILLS_PROJECT_AGENTS_DIR || join(cwd, '.agents', 'skills') },
        { source: 'project-codex', path: process.env.MC_SKILLS_PROJECT_CODEX_DIR || join(cwd, '.codex', 'skills') },
        { source: 'openclaw', path: process.env.MC_SKILLS_OPENCLAW_DIR || join(openclawState, 'skills') },
        { source: 'workspace', path: process.env.MC_SKILLS_WORKSPACE_DIR || join(process.env.OPENCLAW_WORKSPACE_DIR || process.env.MISSION_CONTROL_WORKSPACE_DIR || join(openclawState, 'workspace'), 'skills') },
    ];
    // Dynamic: scan for workspace-<agent> directories
    try {
        const entries = readdirSync(openclawState);
        for (const entry of entries) {
            if (!entry.startsWith('workspace-'))
                continue;
            const skillsDir = join(openclawState, entry, 'skills');
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
// ---------------------------------------------------------------------------
// Disk scanner
// ---------------------------------------------------------------------------
function scanDiskSkills() {
    const skills = [];
    for (const root of getSkillRoots()) {
        if (!existsSync(root.path))
            continue;
        let entries;
        try {
            entries = readdirSync(root.path);
        }
        catch (_a) {
            continue;
        }
        for (const entry of entries) {
            const skillPath = join(root.path, entry);
            try {
                if (!statSync(skillPath).isDirectory())
                    continue;
            }
            catch (_b) {
                continue;
            }
            const skillDoc = join(skillPath, 'SKILL.md');
            if (!existsSync(skillDoc))
                continue;
            try {
                const content = readFileSync(skillDoc, 'utf8');
                skills.push({
                    name: entry,
                    source: root.source,
                    path: skillPath,
                    description: extractDescription(content),
                    contentHash: sha256(content),
                });
            }
            catch (_c) {
                // Unreadable — skip
            }
        }
    }
    return skills;
}
// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------
export async function syncSkillsFromDisk() {
    try {
        const db = getDatabase();
        const diskSkills = scanDiskSkills();
        const now = new Date().toISOString();
        // Build a lookup of what's on disk
        const diskMap = new Map();
        for (const s of diskSkills) {
            diskMap.set(`${s.source}:${s.name}`, s);
        }
        // Fetch current DB rows (only local sources, not registry-installed via slug)
        const localSources = ['user-agents', 'user-codex', 'project-agents', 'project-codex', 'openclaw', 'workspace'];
        // Also include any dynamic workspace-* sources from disk
        for (const s of diskSkills) {
            if (s.source.startsWith('workspace-') && !localSources.includes(s.source)) {
                localSources.push(s.source);
            }
        }
        const dbRows = db.prepare(`SELECT * FROM skills WHERE source IN (${localSources.map(() => '?').join(',')})`).all(...localSources);
        const dbMap = new Map();
        for (const r of dbRows) {
            dbMap.set(`${r.source}:${r.name}`, r);
        }
        let created = 0;
        let updated = 0;
        let deleted = 0;
        const insertStmt = db.prepare(`
      INSERT INTO skills (name, source, path, description, content_hash, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        const updateStmt = db.prepare(`
      UPDATE skills SET path = ?, description = ?, content_hash = ?, updated_at = ?
      WHERE source = ? AND name = ?
    `);
        const deleteStmt = db.prepare(`DELETE FROM skills WHERE source = ? AND name = ?`);
        db.transaction(() => {
            // Disk → DB: additions and changes
            for (const [key, disk] of diskMap) {
                const existing = dbMap.get(key);
                if (!existing) {
                    insertStmt.run(disk.name, disk.source, disk.path, disk.description || null, disk.contentHash, now, now);
                    created++;
                }
                else if (existing.content_hash !== disk.contentHash) {
                    // Disk wins: content changed on disk since last sync
                    updateStmt.run(disk.path, disk.description || null, disk.contentHash, now, disk.source, disk.name);
                    updated++;
                }
            }
            // DB → Disk: detect removals (skill deleted from disk since last sync)
            for (const [key, row] of dbMap) {
                if (!diskMap.has(key) && !row.registry_slug) {
                    // Only auto-delete non-registry skills that vanished from disk
                    deleteStmt.run(row.source, row.name);
                    deleted++;
                }
            }
        })();
        const msg = `Skill sync: ${created} added, ${updated} updated, ${deleted} removed (${diskSkills.length} on disk)`;
        if (created > 0 || updated > 0 || deleted > 0) {
            logger.info(msg);
        }
        return { ok: true, message: msg };
    }
    catch (err) {
        logger.error({ err }, 'Skill sync failed');
        return { ok: false, message: `Skill sync failed: ${err.message}` };
    }
}
