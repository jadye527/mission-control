"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseOpenClawDoctorOutput = parseOpenClawDoctorOutput;
const node_path_1 = __importDefault(require("node:path"));
function normalizeLine(line) {
    return line
        .replace(/\u001b\[[0-9;]*m/g, '')
        .replace(/^[\s│┃║┆┊╎╏]+/, '')
        .trim();
}
function isSessionAgingLine(line) {
    return /^agent:[\w:-]+ \(\d+[mh] ago\)$/i.test(line);
}
function isPositiveOrInstructionalLine(line) {
    return /^no .* warnings? detected/i.test(line) ||
        /^no issues/i.test(line) ||
        /^run:\s/i.test(line) ||
        /^all .* (healthy|ok|valid|passed)/i.test(line);
}
/** Issues that are known false positives or non-actionable in this environment */
function isSuppressedIssue(line) {
    // Strip trailing box-drawing chars and whitespace for matching
    const clean = line.replace(/[\s│┃║┆┊╎╏|]+$/g, '').toLowerCase();
    return (clean.includes('mission-control.service') ||
        clean.includes('systemctl --user disable') ||
        clean.includes('openclaw-gateway.service') ||
        clean.includes('requiremention=false') ||
        clean.includes('telegram bot api privacy') ||
        clean.includes('unmentioned group messages') ||
        clean.includes('botfather') ||
        clean.includes('setprivacy') ||
        clean.includes('single gateway') ||
        clean.includes('multiple gateways') ||
        clean.includes('gateway recommendation') ||
        clean.includes('cleanup hints') ||
        clean.includes('gateway-like services'));
}
function isDecorativeLine(line) {
    return /^[▄█▀░\s]+$/.test(line) || /openclaw doctor/i.test(line) || /🦞\s*openclaw\s*🦞/i.test(line);
}
function isStateDirectoryListLine(line) {
    return /^(?:\$OPENCLAW_HOME(?:\/\.openclaw)?|~\/\.openclaw|\/\S+)$/.test(line);
}
function normalizeFsPath(candidate) {
    return node_path_1.default.resolve(candidate.trim());
}
function normalizeDisplayedPath(candidate, stateDir) {
    const trimmed = candidate.trim();
    if (!trimmed)
        return trimmed;
    if (trimmed === '~/.openclaw')
        return stateDir;
    if (trimmed === '$OPENCLAW_HOME' || trimmed === '$OPENCLAW_HOME/.openclaw')
        return stateDir;
    return trimmed;
}
function stripForeignStateDirectoryWarning(rawOutput, stateDir) {
    var _a, _b;
    if (!stateDir)
        return rawOutput;
    const normalizedStateDir = normalizeFsPath(stateDir);
    const lines = rawOutput.split(/\r?\n/);
    const kept = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = (_a = lines[index]) !== null && _a !== void 0 ? _a : '';
        const normalized = normalizeLine(line);
        if (!/multiple state directories detected/i.test(normalized)) {
            kept.push(line);
            continue;
        }
        const blockLines = [line];
        let cursor = index + 1;
        while (cursor < lines.length) {
            const nextLine = (_b = lines[cursor]) !== null && _b !== void 0 ? _b : '';
            const nextNormalized = normalizeLine(nextLine);
            if (!nextNormalized) {
                blockLines.push(nextLine);
                cursor += 1;
                continue;
            }
            if (/^(active state dir:|[-*]\s+(?:\/|~\/|\$OPENCLAW_HOME)|\|)/i.test(nextNormalized)) {
                blockLines.push(nextLine);
                cursor += 1;
                continue;
            }
            break;
        }
        const listedDirs = blockLines
            .map(normalizeLine)
            .filter(entry => /^[-*]\s+/.test(entry))
            .map(entry => entry.replace(/^[-*]\s+/, '').trim())
            .filter(Boolean)
            .map(entry => normalizeDisplayedPath(entry, normalizedStateDir));
        const foreignDirs = listedDirs.filter(entry => normalizeFsPath(entry) !== normalizedStateDir);
        const onlyForeignDirs = foreignDirs.length > 0;
        if (!onlyForeignDirs) {
            kept.push(...blockLines);
        }
        index = cursor - 1;
    }
    return kept.join('\n');
}
function detectCategory(raw, issues) {
    const haystack = `${raw}\n${issues.join('\n')}`.toLowerCase();
    if (/invalid config|config invalid|unrecognized key|invalid option/.test(haystack)) {
        return 'config';
    }
    if (/state integrity|orphan transcript|multiple state directories|session history/.test(haystack)) {
        return 'state';
    }
    if (/security audit|channel security|security /.test(haystack)) {
        return 'security';
    }
    return 'general';
}
function parseOpenClawDoctorOutput(rawOutput, exitCode = 0, options = {}) {
    const raw = stripForeignStateDirectoryWarning(rawOutput.trim(), options.stateDir).trim();
    const lines = raw
        .split(/\r?\n/)
        .map(normalizeLine)
        .filter(Boolean);
    const issues = lines
        .filter(line => /^[-*]\s+/.test(line))
        .map(line => line.replace(/^[-*]\s+/, '').trim())
        .filter(line => !isSessionAgingLine(line) && !isStateDirectoryListLine(line) && !isPositiveOrInstructionalLine(line) && !isSuppressedIssue(line));
    // Strip positive/negated phrases and section headers before checking for warning keywords
    const rawForWarningCheck = raw
        .replace(/\bno\s+\w+\s+(?:security\s+)?warnings?\s+detected\b/gi, '')
        .replace(/\bchannel warnings?\b/gi, '') // section header, not an actual warning
        .replace(/\berrors?:\s*0\b/gi, '') // "Errors: 0" is not an error
        .replace(/\bdoctor warnings?\b/gi, ''); // section header
    const mentionsWarnings = /\bwarning|warnings|problem|problems|invalid config\b/i.test(rawForWarningCheck);
    const mentionsHealthy = /\bok\b|\bhealthy\b|\bno issues\b|\bno\b.*\bwarnings?\s+detected\b|\bvalid\b/i.test(raw);
    // Only flag real issues — if all issues were suppressed, treat as healthy
    let level = 'healthy';
    if (exitCode !== 0 || /\binvalid config\b|\bconfig invalid\b/i.test(raw)) {
        level = 'error';
    }
    else if (issues.length > 0) {
        level = mentionsWarnings ? 'warning' : 'warning';
    }
    else if (mentionsWarnings && !mentionsHealthy) {
        level = 'warning';
    }
    const category = detectCategory(raw, issues);
    const summary = level === 'healthy'
        ? 'OpenClaw doctor reports a healthy configuration.'
        : issues[0] ||
            lines.find(line => !/^run:/i.test(line) &&
                !/^file:/i.test(line) &&
                !isSessionAgingLine(line) &&
                !isDecorativeLine(line)) ||
            'OpenClaw doctor reported configuration issues.';
    const canFix = level !== 'healthy' || /openclaw doctor --fix/i.test(raw);
    return {
        level,
        category,
        healthy: level === 'healthy',
        summary,
        issues,
        canFix,
        raw,
    };
}
