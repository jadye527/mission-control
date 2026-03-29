"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLocalDashboardHost = isLocalDashboardHost;
exports.shouldRedirectDashboardToHttps = shouldRedirectDashboardToHttps;
function normalizeHostname(hostname) {
    return hostname.trim().toLowerCase();
}
function isLocalDashboardHost(hostname) {
    const normalized = normalizeHostname(hostname);
    return (normalized === 'localhost' ||
        normalized === '127.0.0.1' ||
        normalized === '::1' ||
        normalized.endsWith('.local'));
}
function shouldRedirectDashboardToHttps(input) {
    if (!input.forceHttps)
        return false;
    return input.protocol === 'http:' && !isLocalDashboardHost(input.hostname);
}
