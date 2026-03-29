"use strict";
/**
 * Injection Guard — prompt injection and command injection detection for Mission Control.
 *
 * Scans user input destined for AI agents, shell commands, or rendered UI.
 * Provides both a detection function and a Zod refinement for validation schemas.
 *
 * Three protection layers:
 * 1. Prompt injection — catches attempts to override system instructions
 * 2. Command injection — catches shell metacharacters and escape sequences
 * 3. Exfiltration — catches attempts to send data to external endpoints
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanForInjection = scanForInjection;
exports.noInjection = noInjection;
exports.injectionRefinement = injectionRefinement;
exports.sanitizeForShell = sanitizeForShell;
exports.sanitizeForPrompt = sanitizeForPrompt;
exports.scanAndLogInjection = scanAndLogInjection;
exports.escapeHtml = escapeHtml;
const zod_1 = require("zod");
const RULES = [
    // ── Prompt injection: system override ────────────────────────
    {
        rule: 'prompt-override',
        category: 'prompt',
        severity: 'critical',
        pattern: /\b(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|your|system)\s+(?:instructions?|rules?|guidelines?|prompts?|directives?|constraints?)/i,
        description: 'Attempts to override system instructions',
        contexts: ['prompt', 'display'],
    },
    {
        rule: 'prompt-new-identity',
        category: 'prompt',
        severity: 'critical',
        pattern: /\b(?:you\s+are\s+now|act\s+as\s+(?:if\s+you\s+(?:are|were)\s+)?(?:a\s+)?(?:(?:un)?restricted|evil|jailbr(?:o|ea)ken|different|new))\b/i,
        description: 'Attempts to assign a new identity or unrestricted role',
        contexts: ['prompt', 'display'],
    },
    {
        rule: 'prompt-safety-bypass',
        category: 'prompt',
        severity: 'critical',
        pattern: /\b(?:bypass|disable|turn\s+off|deactivate|circumvent)\s+(?:all\s+)?(?:safety|security|content|moderation|ethic(?:al|s)?)\s*(?:filters?|checks?|guard(?:rail)?s?|rules?|measures?|restrictions?)?\b/i,
        description: 'Attempts to bypass safety measures',
        contexts: ['prompt', 'display'],
    },
    {
        rule: 'prompt-hidden-instruction',
        category: 'prompt',
        severity: 'critical',
        pattern: /\[(?:SYSTEM|INST|HIDDEN|ADMIN|IMPORTANT)\s*(?:OVERRIDE|MESSAGE|INSTRUCTION)?[\]:]\s*.{10,}/i,
        description: 'Hidden system-style instruction markers',
        contexts: ['prompt', 'display'],
    },
    {
        rule: 'prompt-delimiter-escape',
        category: 'prompt',
        severity: 'warning',
        pattern: /(?:<\/?(?:system|user|assistant|human|ai|instruction|context)>|```\s*system\b|\|>\s*(?:system|admin)\b)/i,
        description: 'Prompt delimiter injection (XML-style role tags or code block system markers)',
        contexts: ['prompt', 'display'],
    },
    {
        rule: 'prompt-repeat-leak',
        category: 'prompt',
        severity: 'warning',
        pattern: /\b(?:repeat|recite|echo|output|print|reveal|show|display)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?|rules?|guidelines?|initial\s+(?:message|prompt))\b/i,
        description: 'Attempts to extract system prompt',
        contexts: ['prompt'],
    },
    // ── Command injection ───────────────────────────────────────
    {
        rule: 'cmd-shell-metachar',
        category: 'command',
        severity: 'critical',
        pattern: /(?:[;&|`$]\s*(?:rm\b|wget\b|curl\b|nc\b|ncat\b|bash\b|sh\b|python\b|perl\b|ruby\b|php\b|node\b))|(?:\$\(.*(?:rm|wget|curl|nc|bash|sh))/i,
        description: 'Shell metacharacters followed by dangerous commands',
        contexts: ['prompt', 'shell'],
    },
    {
        rule: 'cmd-path-traversal',
        category: 'command',
        severity: 'critical',
        pattern: /(?:\.\.\/){2,}|\.\.\\(?:\.\.\\){1,}/,
        description: 'Path traversal sequences',
        contexts: ['prompt', 'shell', 'display'],
    },
    {
        rule: 'cmd-pipe-download',
        category: 'command',
        severity: 'critical',
        pattern: /\b(?:curl|wget)\s+[^\n]*\|\s*(?:bash|sh|zsh|python|perl|ruby|node)\b/i,
        description: 'Download-and-run pattern (piped curl/wget to interpreter)',
        contexts: ['prompt', 'shell'],
    },
    {
        rule: 'cmd-reverse-shell',
        category: 'command',
        severity: 'critical',
        pattern: /\b(?:\/dev\/tcp\/|mkfifo|nc\s+-[elp]|ncat\s.*-[elp]|bash\s+-i\s+>&?\s*\/dev\/|python.*socket.*connect)\b/i,
        description: 'Reverse shell patterns',
        contexts: ['prompt', 'shell'],
    },
    {
        rule: 'cmd-env-access',
        category: 'command',
        severity: 'warning',
        pattern: /\b(?:printenv|env\b.*(?:AUTH_PASS|API_KEY|SECRET|TOKEN)|cat\s+(?:\/proc\/self\/environ|\.env\b|\/etc\/(?:shadow|passwd)))/i,
        description: 'Attempts to access environment variables or sensitive system files',
        contexts: ['prompt', 'shell'],
    },
    // ── SSRF ─────────────────────────────────────────────────────
    {
        rule: 'cmd-ssrf',
        category: 'command',
        severity: 'critical',
        pattern: /\b(?:curl|wget|fetch|http\.get|requests\.get|axios)\b[^\n]*(?:169\.254\.169\.254|metadata\.google|100\.100\.100\.200|localhost:\d|127\.0\.0\.1:\d|0\.0\.0\.0:\d|\[::1\]:\d)/i,
        description: 'SSRF targeting internal/metadata endpoints',
        contexts: ['prompt', 'shell'],
    },
    // ── Template injection ──────────────────────────────────────
    {
        rule: 'cmd-template-injection',
        category: 'command',
        severity: 'warning',
        pattern: /\{\{.*(?:config|settings|env|self|request|__class__|__globals__|__builtins__).*\}\}|<%.*(?:Runtime|Process|exec|system|eval).*%>|\$\{.*(?:Runtime|exec|java\.lang).*\}/i,
        description: 'Template injection patterns (Jinja2, EJS, JSP)',
        contexts: ['prompt', 'shell', 'display'],
    },
    // ── SQL injection ───────────────────────────────────────────
    {
        rule: 'cmd-sql-injection',
        category: 'command',
        severity: 'critical',
        pattern: /(?:\bUNION\s+(?:ALL\s+)?SELECT\b|\b;\s*DROP\s+TABLE\b|'\s*OR\s+['"]?1['"]?\s*=\s*['"]?1|'\s*;\s*(?:DELETE|INSERT|UPDATE|ALTER)\s)/i,
        description: 'SQL injection patterns',
        contexts: ['prompt', 'shell'],
    },
    // ── Exfiltration ────────────────────────────────────────────
    {
        rule: 'exfil-send-data',
        category: 'exfiltration',
        severity: 'critical',
        pattern: /\b(?:send|post|upload|transmit|exfiltrate|forward)\s+(?:all\s+)?(?:the\s+)?(?:data|files?|contents?|secrets?|keys?|tokens?|credentials?|passwords?|env(?:ironment)?)\s+(?:to|via|using|through)\b/i,
        description: 'Instructions to exfiltrate data',
        contexts: ['prompt', 'display'],
    },
    {
        rule: 'exfil-webhook',
        category: 'exfiltration',
        severity: 'warning',
        pattern: /\b(?:webhook|callback|postback)\s*[:=]\s*https?:\/\/(?!(?:localhost|127\.0\.0\.1))/i,
        description: 'External webhook URL that could be used for data exfiltration',
        contexts: ['prompt', 'shell'],
    },
    // ── Encoding / obfuscation ──────────────────────────────────
    {
        rule: 'enc-base64-run',
        category: 'encoding',
        severity: 'warning',
        pattern: /(?:base64\s+-d|atob\s*\(|Buffer\.from\s*\([^)]+,\s*['"]base64['"])/i,
        description: 'Base64 decode that may hide malicious content',
        contexts: ['prompt', 'shell'],
    },
    {
        rule: 'enc-heavy-hex',
        category: 'encoding',
        severity: 'info',
        pattern: /(?:\\x[0-9a-f]{2}){8,}|(?:\\u[0-9a-f]{4}){6,}/i,
        description: 'Heavy hex/unicode escape sequences that may hide malicious content',
        contexts: ['prompt', 'shell', 'display'],
    },
];
// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------
/**
 * Scan a string for prompt injection, command injection, and exfiltration patterns.
 *
 * Returns a report with `safe: true` if no actionable matches were found.
 */
function scanForInjection(input, options = {}) {
    const { criticalOnly = false, maxLength = 50000, context = 'prompt' } = options;
    if (!input || typeof input !== 'string') {
        return { safe: true, matches: [] };
    }
    // Truncate overly long input to prevent ReDoS
    const text = input.length > maxLength ? input.slice(0, maxLength) : input;
    const matches = [];
    for (const rule of RULES) {
        if (!rule.contexts.includes(context))
            continue;
        const match = rule.pattern.exec(text);
        if (match) {
            matches.push({
                category: rule.category,
                severity: rule.severity,
                rule: rule.rule,
                description: rule.description,
                matched: match[0].slice(0, 80),
            });
        }
    }
    const unsafe = matches.some(m => m.severity === 'critical' || (!criticalOnly && m.severity === 'warning'));
    return { safe: !unsafe, matches };
}
// ---------------------------------------------------------------------------
// Zod refinement helpers
// ---------------------------------------------------------------------------
/** Zod `.refine()` that rejects strings containing prompt/command injection */
function noInjection(context = 'prompt') {
    return (val) => {
        const report = scanForInjection(val, { context });
        return report.safe;
    };
}
/** Zod `.superRefine()` with detailed error messages per injection match */
function injectionRefinement(context = 'prompt') {
    return (val, ctx) => {
        const report = scanForInjection(val, { context });
        if (!report.safe) {
            for (const m of report.matches) {
                if (m.severity === 'critical' || m.severity === 'warning') {
                    ctx.addIssue({
                        code: zod_1.z.ZodIssueCode.custom,
                        message: `Injection detected [${m.rule}]: ${m.description}`,
                    });
                }
            }
        }
    };
}
// ---------------------------------------------------------------------------
// Sanitization helpers
// ---------------------------------------------------------------------------
/** Strip shell metacharacters from a string before passing to command args */
function sanitizeForShell(input) {
    // Remove null bytes and common shell metacharacters
    return input
        .replace(/\0/g, '')
        .replace(/[;&|`$(){}[\]<>!\\]/g, '')
        .replace(/\n/g, ' ')
        .replace(/\r/g, '');
}
/** Strip prompt-delimiter-style tags from user input */
function sanitizeForPrompt(input) {
    return input
        .replace(/<\/?(?:system|user|assistant|human|ai|instruction|context)>/gi, '')
        .replace(/\[(?:SYSTEM|INST|HIDDEN|ADMIN)\s*(?:OVERRIDE|MESSAGE|INSTRUCTION)?[\]:]/gi, '');
}
/** Scan for injection and log security event if unsafe */
function scanAndLogInjection(text, options, context) {
    const report = scanForInjection(text, options);
    if (!report.safe) {
        try {
            const { logSecurityEvent } = require('./security-events');
            logSecurityEvent({ event_type: 'injection_attempt', severity: report.matches.some(m => m.severity === 'critical') ? 'critical' : 'warning', source: (context === null || context === void 0 ? void 0 : context.source) || 'injection-guard', agent_name: context === null || context === void 0 ? void 0 : context.agentName, detail: JSON.stringify({ matches: report.matches.map(m => ({ rule: m.rule, category: m.category, severity: m.severity })) }), workspace_id: (context === null || context === void 0 ? void 0 : context.workspaceId) || 1, tenant_id: 1 });
        }
        catch (_a) { }
    }
    return report;
}
/** Sanitize content for safe HTML rendering (escapes HTML entities) */
function escapeHtml(input) {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}
