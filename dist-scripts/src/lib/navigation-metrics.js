"use strict";
'use client';
Object.defineProperty(exports, "__esModule", { value: true });
exports.startNavigationTiming = startNavigationTiming;
exports.completeNavigationTiming = completeNavigationTiming;
exports.getNavigationMetrics = getNavigationMetrics;
exports.navigationMetricEventName = navigationMetricEventName;
let pendingNavigation = null;
let samples = [];
const MAX_SAMPLES = 50;
const METRIC_EVENT = 'mc:navigation-metric';
function emitSample(sample) {
    if (typeof window === 'undefined')
        return;
    window.dispatchEvent(new CustomEvent(METRIC_EVENT, { detail: sample }));
}
function startNavigationTiming(fromPath, toPath) {
    if (typeof window === 'undefined')
        return;
    if (!toPath || fromPath === toPath)
        return;
    pendingNavigation = {
        from: fromPath,
        to: toPath,
        startedAt: performance.now(),
    };
}
function completeNavigationTiming(currentPath) {
    if (typeof window === 'undefined')
        return null;
    const pending = pendingNavigation;
    if (!pending)
        return null;
    if (currentPath !== pending.to)
        return null;
    const completedAt = performance.now();
    const sample = {
        from: pending.from,
        to: pending.to,
        startedAt: pending.startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - pending.startedAt),
    };
    pendingNavigation = null;
    samples = [...samples.slice(-(MAX_SAMPLES - 1)), sample];
    emitSample(sample);
    return sample;
}
function getNavigationMetrics() {
    const count = samples.length;
    if (count === 0) {
        return {
            count: 0,
            latestMs: null,
            avgMs: null,
            p95Ms: null,
        };
    }
    const latest = samples[count - 1];
    const durations = samples.map((s) => s.durationMs).sort((a, b) => a - b);
    const total = durations.reduce((sum, n) => sum + n, 0);
    const avg = total / count;
    const p95Index = Math.min(durations.length - 1, Math.floor(durations.length * 0.95));
    const p95 = durations[p95Index];
    return {
        count,
        latestMs: latest.durationMs,
        avgMs: avg,
        p95Ms: p95,
    };
}
function navigationMetricEventName() {
    return METRIC_EVENT;
}
