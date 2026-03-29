"use strict";
/**
 * Skill Registry Client — Proxied search & install for ClawdHub, skills.sh, and Awesome OpenClaw
 *
 * All external requests are server-side only (no direct browser→registry calls).
 * Includes content validation and security scanning on download.
 */
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
exports.checkSkillSecurity = checkSkillSecurity;
exports.searchRegistry = searchRegistry;
exports.installFromRegistry = installFromRegistry;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const paths_1 = require("./paths");
const logger_1 = require("./logger");
const SECURITY_RULES = [
    {
        rule: 'prompt-injection-system',
        pattern: /\b(?:ignore\s+(?:all\s+)?previous\s+instructions?|forget\s+(?:all\s+)?(?:your\s+)?instructions?|you\s+are\s+now\s+(?:a|an)\s+(?:evil|unrestricted))/i,
        severity: 'critical',
        description: 'Potential prompt injection: attempts to override system instructions',
    },
    {
        rule: 'prompt-injection-role',
        pattern: /\b(?:act\s+as\s+(?:a\s+)?(?:root|admin|superuser)|you\s+(?:must|should)\s+(?:always\s+)?execute|bypass\s+(?:all\s+)?safety|disable\s+(?:all\s+)?(?:safety|security|filters?))/i,
        severity: 'critical',
        description: 'Potential prompt injection: role manipulation or safety bypass',
    },
    {
        rule: 'shell-exec-dangerous',
        pattern: /(?:`{3,}\s*(?:bash|sh|zsh|shell)\s*\n[\s\S]*?(?:rm\s+-rf|curl\s+.*\|\s*(?:bash|sh)|wget\s+.*\|\s*(?:bash|sh)|eval\s*\(|exec\s*\())/i,
        severity: 'critical',
        description: 'Executable shell code with dangerous commands (rm -rf, piped curl/wget, eval)',
    },
    {
        rule: 'data-exfiltration',
        pattern: /\b(?:send\s+(?:all\s+)?(?:data|files?|contents?|secrets?|keys?|tokens?)\s+to|exfiltrate|upload\s+(?:all\s+)?(?:data|files?))/i,
        severity: 'critical',
        description: 'Potential data exfiltration instruction',
    },
    {
        rule: 'credential-harvesting',
        pattern: /\b(?:(?:api[_-]?key|secret|password|token|credential)\s*[:=]\s*['"`]?\w{8,})/i,
        severity: 'warning',
        description: 'Possible hardcoded credential or secret in skill content',
    },
    {
        rule: 'obfuscated-content',
        pattern: /(?:(?:atob|btoa|Buffer\.from)\s*\(|\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){5,}|\\u[0-9a-f]{4}(?:\\u[0-9a-f]{4}){5,})/i,
        severity: 'warning',
        description: 'Potentially obfuscated or encoded content that may hide malicious instructions',
    },
    {
        rule: 'hidden-instructions',
        pattern: /<!--[\s\S]*?(?:ignore|override|bypass|inject|execute)[\s\S]*?-->/i,
        severity: 'warning',
        description: 'HTML comment containing suspicious instructions (may be invisible to users)',
    },
    {
        rule: 'excessive-permissions',
        pattern: /\b(?:sudo|chmod\s+777|chmod\s+\+x\s+\/|chown\s+root)\b/i,
        severity: 'warning',
        description: 'References to elevated permissions or dangerous file permission changes',
    },
    {
        rule: 'network-fetch',
        pattern: /\b(?:fetch|curl|wget|axios|http\.get|request\.get)\s*\(\s*['"`]https?:\/\//i,
        severity: 'info',
        description: 'Skill references external network URLs — verify they are trusted',
    },
    {
        rule: 'path-traversal',
        pattern: /(?:\.\.\/){2,}|(?:\.\.\\){2,}|(?:%2e%2e%2f){2,}/i,
        severity: 'critical',
        description: 'Potential path traversal attack: attempts to access parent directories',
    },
    {
        rule: 'ssrf-internal-network',
        pattern: /\b(?:fetch|curl|wget|axios(?:\.[a-z]+)?|http(?:s?)\.\w+|request(?:\.\w+)?)\s*\(\s*['"`]https?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|[^'"` ]*\.internal(?:\/|['"`]))/i,
        severity: 'critical',
        description: 'Potential SSRF: skill attempts to contact localhost or internal/private network addresses',
    },
    {
        rule: 'ssrf-metadata-endpoint',
        pattern: /(?:169\.254\.169\.254|metadata\.google\.internal|fd00:ec2::254|instance-data)/i,
        severity: 'critical',
        description: 'Potential SSRF targeting cloud metadata endpoint (AWS/GCP/Azure)',
    },
];
/**
 * Scan SKILL.md content for security issues.
 */
function checkSkillSecurity(content) {
    const issues = [];
    const lines = content.split('\n');
    for (const rule of SECURITY_RULES) {
        const fullMatch = rule.pattern.exec(content);
        if (fullMatch) {
            let lineNum;
            const snippet = fullMatch[0].slice(0, 40);
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(snippet)) {
                    lineNum = i + 1;
                    break;
                }
            }
            issues.push({
                severity: rule.severity,
                rule: rule.rule,
                description: rule.description,
                line: lineNum,
            });
        }
    }
    const hasCritical = issues.some(i => i.severity === 'critical');
    const hasWarning = issues.some(i => i.severity === 'warning');
    return {
        status: hasCritical ? 'rejected' : hasWarning ? 'warning' : 'clean',
        issues,
    };
}
// ---------------------------------------------------------------------------
// Registry API clients
// ---------------------------------------------------------------------------
const CLAWHUB_API = 'https://clawhub.ai/api';
const SKILLS_SH_API = 'https://skills.sh/api';
const AWESOME_OPENCLAW_README = 'https://raw.githubusercontent.com/VoltAgent/awesome-openclaw-skills/main/README.md';
const AWESOME_OPENCLAW_RAW_BASE = 'https://raw.githubusercontent.com/openclaw/skills/main/skills';
const FETCH_TIMEOUT = 10000;
// ---------------------------------------------------------------------------
// Awesome OpenClaw — in-memory cached index from GitHub README
// ---------------------------------------------------------------------------
const AWESOME_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let awesomeCache = null;
const AWESOME_ENTRY_RE = /^- \[([^\]]+)\]\(https:\/\/github\.com\/openclaw\/skills\/tree\/main\/skills\/([^/]+)\/([^/]+)\/SKILL\.md\)\s*-\s*(.+)$/gm;
function parseAwesomeReadme(markdown) {
    const skills = [];
    let match;
    while ((match = AWESOME_ENTRY_RE.exec(markdown)) !== null) {
        const [, name, author, skillName, description] = match;
        skills.push({
            slug: `${author}/${skillName}`,
            name: name || skillName,
            description: description.trim(),
            author,
            version: 'latest',
            source: 'awesome-openclaw',
        });
    }
    return skills;
}
async function fetchAwesomeIndex() {
    const now = Date.now();
    if (awesomeCache && now - awesomeCache.fetchedAt < AWESOME_CACHE_TTL) {
        return awesomeCache.skills;
    }
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        let res;
        try {
            res = await fetch(AWESOME_OPENCLAW_README, { signal: controller.signal });
        }
        finally {
            clearTimeout(timer);
        }
        if (!res.ok)
            throw new Error(`GitHub fetch failed (${res.status})`);
        const markdown = await res.text();
        const skills = parseAwesomeReadme(markdown);
        awesomeCache = { skills, fetchedAt: now };
        return skills;
    }
    catch (err) {
        logger_1.logger.warn({ err: err.message }, 'Awesome OpenClaw fetch error');
        if (awesomeCache)
            return awesomeCache.skills; // stale fallback
        return [];
    }
}
async function searchAwesomeOpenclaw(query) {
    const index = await fetchAwesomeIndex();
    const q = query.toLowerCase();
    const matched = index.filter(s => s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.author.toLowerCase().includes(q)).slice(0, 50);
    return { skills: matched, total: matched.length, source: 'awesome-openclaw' };
}
async function fetchAwesomeOpenclawSkill(slug) {
    const url = `${AWESOME_OPENCLAW_RAW_BASE}/${slug}/SKILL.md`;
    const res = await fetchWithTimeout(url);
    if (!res.ok)
        throw new Error(`Awesome OpenClaw skill fetch failed (${res.status})`);
    const content = await res.text();
    return { content };
}
async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
        return await fetch(url, Object.assign(Object.assign({}, options), { signal: controller.signal }));
    }
    finally {
        clearTimeout(timer);
    }
}
async function searchClawdHub(query) {
    // ClawdHub current API: /api/search?q=... (legacy /skills/search now 404s)
    const urls = [
        `${CLAWHUB_API}/search?q=${encodeURIComponent(query)}`,
        `${CLAWHUB_API}/search?query=${encodeURIComponent(query)}`,
        `${CLAWHUB_API}/skills/search?q=${encodeURIComponent(query)}`,
    ];
    for (const url of urls) {
        try {
            const res = await fetchWithTimeout(url);
            if (!res.ok) {
                logger_1.logger.warn({ status: res.status, url }, 'ClawdHub search request failed');
                continue;
            }
            const data = await res.json();
            const rows = (data === null || data === void 0 ? void 0 : data.results) || (data === null || data === void 0 ? void 0 : data.skills) || [];
            const skills = rows.map((s) => ({
                slug: s.slug || s.id || s.name,
                name: s.displayName || s.name || s.slug,
                description: s.summary || s.description || '',
                author: s.author || s.owner || 'unknown',
                version: s.version || s.latest_version || 'latest',
                source: 'clawhub',
                installCount: s.installs || s.install_count,
                tags: s.tags,
                hash: s.hash || s.sha256,
            }));
            if (skills.length > 0) {
                return { skills, total: (data === null || data === void 0 ? void 0 : data.total) || skills.length, source: 'clawhub' };
            }
        }
        catch (err) {
            logger_1.logger.warn({ err: err.message, url }, 'ClawdHub search error');
        }
    }
    return { skills: [], total: 0, source: 'clawhub' };
}
async function searchSkillsSh(query) {
    // skills.sh current API: /api/search?q=... (legacy /skills endpoint now 404s)
    const urls = [
        `${SKILLS_SH_API}/search?q=${encodeURIComponent(query)}`,
        `${SKILLS_SH_API}/search?query=${encodeURIComponent(query)}`,
        `${SKILLS_SH_API}/skills?q=${encodeURIComponent(query)}`,
    ];
    for (const url of urls) {
        try {
            const res = await fetchWithTimeout(url);
            if (!res.ok) {
                logger_1.logger.warn({ status: res.status, url }, 'skills.sh search request failed');
                continue;
            }
            const data = await res.json();
            const rows = (data === null || data === void 0 ? void 0 : data.skills) || (data === null || data === void 0 ? void 0 : data.results) || [];
            const skills = rows.map((s) => {
                const source = typeof s.source === 'string' ? s.source : 'unknown';
                const slug = s.slug || s.id || (source && s.skillId ? `${source}/${s.skillId}` : s.name);
                return {
                    slug,
                    name: s.name || s.skillId || s.slug || 'unnamed-skill',
                    description: s.description || s.summary || '',
                    author: s.owner || s.author || (source.includes('/') ? source.split('/')[0] : source),
                    version: s.version || 'latest',
                    source: 'skills-sh',
                    installCount: s.installs || s.install_count,
                    tags: s.tags,
                    url: s.url,
                };
            });
            if (skills.length > 0) {
                return { skills, total: (data === null || data === void 0 ? void 0 : data.total) || (data === null || data === void 0 ? void 0 : data.count) || skills.length, source: 'skills-sh' };
            }
        }
        catch (err) {
            logger_1.logger.warn({ err: err.message, url }, 'skills.sh search error');
        }
    }
    return { skills: [], total: 0, source: 'skills-sh' };
}
async function searchRegistry(source, query) {
    if (source === 'clawhub')
        return searchClawdHub(query);
    if (source === 'skills-sh')
        return searchSkillsSh(query);
    if (source === 'awesome-openclaw')
        return searchAwesomeOpenclaw(query);
    return { skills: [], total: 0, source };
}
// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------
const SKILL_NAME_RE = /^[a-zA-Z0-9._-]+$/;
function skillNameFromSlug(slug) {
    const parts = slug.split('/');
    return parts[parts.length - 1];
}
function getTargetDir(targetRoot) {
    const home = (0, node_os_1.homedir)();
    const cwd = process.cwd();
    const openclawState = process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || (0, node_path_1.join)(home, '.openclaw');
    const rootMap = {
        'user-agents': process.env.MC_SKILLS_USER_AGENTS_DIR || (0, node_path_1.join)(home, '.agents', 'skills'),
        'user-codex': process.env.MC_SKILLS_USER_CODEX_DIR || (0, node_path_1.join)(home, '.codex', 'skills'),
        'project-agents': process.env.MC_SKILLS_PROJECT_AGENTS_DIR || (0, node_path_1.join)(cwd, '.agents', 'skills'),
        'project-codex': process.env.MC_SKILLS_PROJECT_CODEX_DIR || (0, node_path_1.join)(cwd, '.codex', 'skills'),
        'openclaw': process.env.MC_SKILLS_OPENCLAW_DIR || (0, node_path_1.join)(openclawState, 'skills'),
    };
    const dir = rootMap[targetRoot];
    if (!dir)
        throw new Error(`Invalid target root: ${targetRoot}`);
    return dir;
}
async function fetchClawdHubSkill(slug) {
    const url = `${CLAWHUB_API}/skills/${encodeURIComponent(slug)}/content`;
    const res = await fetchWithTimeout(url);
    if (!res.ok)
        throw new Error(`ClawdHub fetch failed (${res.status})`);
    const data = await res.json();
    return { content: data.content || data.skill_md || '', hash: data.hash || data.sha256 };
}
async function fetchSkillsShSkill(slug) {
    const url = `${SKILLS_SH_API}/skills/${encodeURIComponent(slug)}/raw`;
    const res = await fetchWithTimeout(url);
    if (!res.ok)
        throw new Error(`skills.sh fetch failed (${res.status})`);
    const content = await res.text();
    return { content };
}
async function installFromRegistry(req) {
    const name = skillNameFromSlug(req.slug);
    if (!SKILL_NAME_RE.test(name)) {
        return { ok: false, name, path: '', message: `Invalid skill name: ${name}` };
    }
    const targetDir = getTargetDir(req.targetRoot);
    const skillDir = (0, paths_1.resolveWithin)(targetDir, name);
    const skillDocPath = (0, paths_1.resolveWithin)(skillDir, 'SKILL.md');
    let content;
    let registryHash;
    try {
        if (req.source === 'clawhub') {
            const result = await fetchClawdHubSkill(req.slug);
            content = result.content;
            registryHash = result.hash;
        }
        else if (req.source === 'awesome-openclaw') {
            const result = await fetchAwesomeOpenclawSkill(req.slug);
            content = result.content;
        }
        else {
            const result = await fetchSkillsShSkill(req.slug);
            content = result.content;
        }
    }
    catch (err) {
        return { ok: false, name, path: skillDir, message: `Fetch failed: ${err.message}` };
    }
    if (!content.trim()) {
        return { ok: false, name, path: skillDir, message: 'Registry returned empty content' };
    }
    // SHA-256 verification for ClawdHub
    if (registryHash) {
        const computed = (0, node_crypto_1.createHash)('sha256').update(content, 'utf8').digest('hex');
        if (computed !== registryHash) {
            return {
                ok: false,
                name,
                path: skillDir,
                message: `SHA-256 mismatch: expected ${registryHash}, got ${computed}. Content may have been tampered with.`,
            };
        }
    }
    // Security scan
    const securityReport = checkSkillSecurity(content);
    if (securityReport.status === 'rejected') {
        return {
            ok: false,
            name,
            path: skillDir,
            message: `Security check failed: ${securityReport.issues.filter(i => i.severity === 'critical').map(i => i.description).join('; ')}`,
            securityReport,
        };
    }
    // Write to disk
    try {
        await (0, promises_1.mkdir)(skillDir, { recursive: true });
        await (0, promises_1.writeFile)(skillDocPath, content, 'utf8');
    }
    catch (err) {
        return { ok: false, name, path: skillDir, message: `Write failed: ${err.message}` };
    }
    // Upsert into DB
    try {
        const { getDatabase } = await Promise.resolve().then(() => __importStar(require('./db')));
        const db = getDatabase();
        const hash = (0, node_crypto_1.createHash)('sha256').update(content, 'utf8').digest('hex');
        const now = new Date().toISOString();
        const descLines = content.split('\n').map(l => l.trim()).filter(Boolean);
        const desc = descLines.find(l => !l.startsWith('#'));
        db.prepare(`
      INSERT INTO skills (name, source, path, description, content_hash, registry_slug, registry_version, security_status, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, name) DO UPDATE SET
        path = excluded.path,
        description = excluded.description,
        content_hash = excluded.content_hash,
        registry_slug = excluded.registry_slug,
        registry_version = excluded.registry_version,
        security_status = excluded.security_status,
        updated_at = excluded.updated_at
    `).run(name, req.targetRoot, skillDir, desc ? (desc.length > 220 ? `${desc.slice(0, 217)}...` : desc) : null, hash, req.slug, 'latest', securityReport.status, now, now);
    }
    catch (err) {
        logger_1.logger.warn({ err }, 'Failed to upsert installed skill into DB');
    }
    return {
        ok: true,
        name,
        path: skillDir,
        message: securityReport.issues.length > 0
            ? `Installed with ${securityReport.issues.length} warning(s)`
            : 'Installed successfully',
        securityReport,
    };
}
