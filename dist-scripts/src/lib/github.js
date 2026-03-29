"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGitHubToken = getGitHubToken;
exports.githubFetch = githubFetch;
exports.fetchIssues = fetchIssues;
exports.fetchIssue = fetchIssue;
exports.createIssueComment = createIssueComment;
exports.updateIssueState = updateIssueState;
exports.updateIssue = updateIssue;
exports.createIssue = createIssue;
exports.createLabel = createLabel;
exports.ensureLabels = ensureLabels;
exports.updateIssueLabels = updateIssueLabels;
exports.createRef = createRef;
exports.getRef = getRef;
exports.fetchPullRequests = fetchPullRequests;
exports.createPullRequest = createPullRequest;
/**
 * GitHub API client for Mission Control issue sync.
 * Resolves GITHUB_TOKEN from the OpenClaw integration env file first,
 * then falls back to process.env for deployments that export it directly.
 */
const runtime_env_1 = require("@/lib/runtime-env");
async function getGitHubToken() {
    return await (0, runtime_env_1.getEffectiveEnvValue)('GITHUB_TOKEN') || null;
}
/**
 * Authenticated fetch wrapper for GitHub API.
 */
async function githubFetch(path, options = {}) {
    const token = await getGitHubToken();
    if (!token) {
        throw new Error('GITHUB_TOKEN not configured');
    }
    const url = path.startsWith('https://')
        ? path
        : `https://api.github.com${path.startsWith('/') ? '' : '/'}${path}`;
    const headers = Object.assign({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'MissionControl/1.0' }, (options.headers || {}));
    if (options.body) {
        headers['Content-Type'] = 'application/json';
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetch(url, Object.assign(Object.assign({}, options), { headers, signal: controller.signal }));
        return res;
    }
    finally {
        clearTimeout(timeout);
    }
}
/**
 * Fetch issues from a GitHub repo.
 */
async function fetchIssues(repo, params) {
    var _a, _b;
    const searchParams = new URLSearchParams();
    if (params === null || params === void 0 ? void 0 : params.state)
        searchParams.set('state', params.state);
    if (params === null || params === void 0 ? void 0 : params.labels)
        searchParams.set('labels', params.labels);
    if (params === null || params === void 0 ? void 0 : params.since)
        searchParams.set('since', params.since);
    searchParams.set('per_page', String((_a = params === null || params === void 0 ? void 0 : params.per_page) !== null && _a !== void 0 ? _a : 30));
    searchParams.set('page', String((_b = params === null || params === void 0 ? void 0 : params.page) !== null && _b !== void 0 ? _b : 1));
    const qs = searchParams.toString();
    const res = await githubFetch(`/repos/${repo}/issues?${qs}`);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    // Filter out pull requests (GitHub API returns PRs in issues endpoint)
    return data.filter((item) => !item.pull_request);
}
/**
 * Fetch a single issue.
 */
async function fetchIssue(repo, issueNumber) {
    const res = await githubFetch(`/repos/${repo}/issues/${issueNumber}`);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
    return res.json();
}
/**
 * Post a comment on a GitHub issue.
 */
async function createIssueComment(repo, issueNumber, body) {
    const res = await githubFetch(`/repos/${repo}/issues/${issueNumber}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
}
/**
 * Update an issue's state (open/closed).
 */
async function updateIssueState(repo, issueNumber, state) {
    const res = await githubFetch(`/repos/${repo}/issues/${issueNumber}`, {
        method: 'PATCH',
        body: JSON.stringify({ state }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
}
/**
 * Update an issue (title, body, state, labels, assignees).
 */
async function updateIssue(repo, issueNumber, updates) {
    const res = await githubFetch(`/repos/${repo}/issues/${issueNumber}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
    return res.json();
}
/**
 * Create a new issue on GitHub.
 */
async function createIssue(repo, issue) {
    const res = await githubFetch(`/repos/${repo}/issues`, {
        method: 'POST',
        body: JSON.stringify(issue),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
    return res.json();
}
/**
 * Create a label on a GitHub repo (ignores 422 = already exists).
 */
async function createLabel(repo, label) {
    const res = await githubFetch(`/repos/${repo}/labels`, {
        method: 'POST',
        body: JSON.stringify(label),
    });
    // 422 = label already exists, that's fine
    if (!res.ok && res.status !== 422) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
}
/**
 * Idempotently ensure all specified labels exist on the repo.
 */
async function ensureLabels(repo, labels) {
    for (const label of labels) {
        await createLabel(repo, label);
    }
}
/**
 * Set the labels on an issue (replaces all existing labels).
 */
async function updateIssueLabels(repo, issueNumber, labels) {
    const res = await githubFetch(`/repos/${repo}/issues/${issueNumber}/labels`, {
        method: 'PUT',
        body: JSON.stringify({ labels }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
}
/**
 * Create a git ref (branch).
 */
async function createRef(repo, ref, sha) {
    const res = await githubFetch(`/repos/${repo}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref, sha }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
}
/**
 * Get a git ref SHA.
 */
async function getRef(repo, ref) {
    const res = await githubFetch(`/repos/${repo}/git/refs/${ref}`);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    return { sha: data.object.sha };
}
/**
 * Fetch pull requests from a GitHub repo.
 */
async function fetchPullRequests(repo, params) {
    var _a;
    const searchParams = new URLSearchParams();
    if (params === null || params === void 0 ? void 0 : params.head)
        searchParams.set('head', params.head);
    if (params === null || params === void 0 ? void 0 : params.state)
        searchParams.set('state', params.state);
    searchParams.set('per_page', String((_a = params === null || params === void 0 ? void 0 : params.per_page) !== null && _a !== void 0 ? _a : 30));
    const qs = searchParams.toString();
    const res = await githubFetch(`/repos/${repo}/pulls?${qs}`);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
    return res.json();
}
/**
 * Create a pull request.
 */
async function createPullRequest(repo, pr) {
    const res = await githubFetch(`/repos/${repo}/pulls`, {
        method: 'POST',
        body: JSON.stringify(pr),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
    return res.json();
}
