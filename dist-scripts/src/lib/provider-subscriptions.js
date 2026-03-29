"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectProviderSubscriptions = detectProviderSubscriptions;
exports.getProviderSubscriptionFlags = getProviderSubscriptionFlags;
exports.getPrimarySubscription = getPrimarySubscription;
exports.getProviderFromModel = getProviderFromModel;
const node_fs_1 = require("node:fs");
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const config_1 = require("@/lib/config");
const NEGATIVE_TYPES = new Set(['none', 'no', 'false', 'free', 'unknown', 'api_key', 'apikey']);
const OPENAI_CREDENTIAL_PATHS = [
    node_path_1.default.join(node_os_1.default.homedir(), '.config', 'openai', 'auth.json'),
    node_path_1.default.join(node_os_1.default.homedir(), '.openai', 'auth.json'),
    node_path_1.default.join(node_os_1.default.homedir(), '.codex', 'auth.json'),
];
let detectionCache = null;
const CACHE_TTL_MS = 30000;
function normalizeProvider(provider) {
    return provider.trim().toLowerCase();
}
function normalizeType(value) {
    return value.trim().toLowerCase();
}
function isPositiveSubscription(type) {
    if (!type)
        return false;
    return !NEGATIVE_TYPES.has(normalizeType(type));
}
function parseJsonFile(filePath) {
    try {
        if (!(0, node_fs_1.existsSync)(filePath))
            return null;
        return JSON.parse((0, node_fs_1.readFileSync)(filePath, 'utf-8'));
    }
    catch (_a) {
        return null;
    }
}
function findNestedString(root, keys) {
    const queue = [root];
    const wanted = new Set(keys.map(k => k.toLowerCase()));
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || typeof current !== 'object')
            continue;
        if (Array.isArray(current)) {
            for (const item of current)
                queue.push(item);
            continue;
        }
        for (const [rawKey, value] of Object.entries(current)) {
            const key = rawKey.toLowerCase();
            if (wanted.has(key) && typeof value === 'string' && value.trim()) {
                return value.trim();
            }
            if (value && typeof value === 'object')
                queue.push(value);
        }
    }
    return null;
}
function detectAnthropicFromFile() {
    // Try credentials file first (legacy Claude Code 1.x)
    const credsPath = node_path_1.default.join(config_1.config.claudeHome, '.credentials.json');
    const creds = parseJsonFile(credsPath);
    if (creds && typeof creds === 'object') {
        const oauth = creds.claudeAiOauth;
        const subscriptionType = typeof (oauth === null || oauth === void 0 ? void 0 : oauth.subscriptionType) === 'string' ? oauth.subscriptionType : '';
        if (isPositiveSubscription(subscriptionType)) {
            return { provider: 'anthropic', type: normalizeType(subscriptionType), source: 'file' };
        }
    }
    // Fallback: Claude Code 2.x stores OAuth in keychain — use CLI to query
    try {
        const raw = (0, node_child_process_1.execFileSync)('claude', ['auth', 'status'], {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: Object.assign(Object.assign({}, process.env), { HOME: node_os_1.default.homedir() }),
        });
        const status = JSON.parse(raw.trim());
        const subType = typeof (status === null || status === void 0 ? void 0 : status.subscriptionType) === 'string' ? status.subscriptionType : '';
        if (isPositiveSubscription(subType)) {
            return { provider: 'anthropic', type: normalizeType(subType), source: 'file' };
        }
    }
    catch (_a) {
        // claude CLI not available or auth check failed
    }
    return null;
}
function detectOpenAIFromFile() {
    for (const credsPath of OPENAI_CREDENTIAL_PATHS) {
        const creds = parseJsonFile(credsPath);
        if (!creds)
            continue;
        // Codex stores auth_mode: "chatgpt" to indicate ChatGPT subscription auth
        const authMode = typeof creds.auth_mode === 'string' ? creds.auth_mode : '';
        if (authMode === 'chatgpt') {
            return { provider: 'openai', type: 'chatgpt', source: 'file' };
        }
        const plan = findNestedString(creds, [
            'subscriptionType',
            'subscription_type',
            'accountPlan',
            'account_plan',
            'plan',
            'tier',
        ]);
        if (!plan || !isPositiveSubscription(plan))
            continue;
        return {
            provider: 'openai',
            type: normalizeType(plan),
            source: 'file',
        };
    }
    return null;
}
function detectFromEnv() {
    const active = {};
    const allProvidersRaw = process.env.MC_SUBSCRIBED_PROVIDERS || '';
    if (allProvidersRaw.trim()) {
        for (const raw of allProvidersRaw.split(',')) {
            const provider = normalizeProvider(raw);
            if (!provider)
                continue;
            active[provider] = {
                provider,
                type: 'subscription',
                source: 'env',
            };
        }
    }
    for (const [key, value] of Object.entries(process.env)) {
        if (!value)
            continue;
        const explicitMatch = key.match(/^MC_([A-Z0-9_]+)_SUBSCRIPTION(?:_TYPE)?$/);
        if (explicitMatch) {
            const provider = normalizeProvider(explicitMatch[1].replace(/_/g, '-'));
            const type = normalizeType(value);
            if (isPositiveSubscription(type)) {
                active[provider] = { provider, type, source: 'env' };
            }
            else {
                delete active[provider];
            }
            continue;
        }
        const providerMatch = key.match(/^([A-Z0-9_]+)_SUBSCRIPTION_TYPE$/);
        if (providerMatch) {
            const provider = normalizeProvider(providerMatch[1].replace(/_/g, '-'));
            const type = normalizeType(value);
            if (isPositiveSubscription(type)) {
                active[provider] = { provider, type, source: 'env' };
            }
            else {
                delete active[provider];
            }
        }
    }
    return active;
}
function detectProviderSubscriptions(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && detectionCache && (now - detectionCache.ts) < CACHE_TTL_MS) {
        return detectionCache.value;
    }
    const active = detectFromEnv();
    const anthropic = detectAnthropicFromFile();
    if (anthropic)
        active.anthropic = anthropic;
    const openai = detectOpenAIFromFile();
    if (openai)
        active.openai = openai;
    const value = { active };
    detectionCache = { ts: now, value };
    return value;
}
function getProviderSubscriptionFlags(forceRefresh = false) {
    const detected = detectProviderSubscriptions(forceRefresh);
    return Object.fromEntries(Object.keys(detected.active).map((provider) => [provider, true]));
}
function getPrimarySubscription(forceRefresh = false) {
    const detected = detectProviderSubscriptions(forceRefresh).active;
    return detected.anthropic || detected.openai || Object.values(detected)[0] || null;
}
function getProviderFromModel(modelName) {
    const normalized = modelName.trim().toLowerCase();
    if (!normalized)
        return 'unknown';
    const [prefix] = normalized.split('/');
    if (prefix && !prefix.includes(':')) {
        // Most models are provider-prefixed, e.g., "anthropic/claude-sonnet-4-5".
        if (prefix === 'claude')
            return 'anthropic';
        if (prefix === 'gpt' || prefix === 'o1' || prefix === 'o3')
            return 'openai';
        return prefix;
    }
    if (normalized.includes('claude'))
        return 'anthropic';
    if (normalized.includes('gpt') || normalized.includes('codex') || normalized.includes('o1') || normalized.includes('o3'))
        return 'openai';
    return 'unknown';
}
