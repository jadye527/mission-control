"use strict";
'use client';
Object.defineProperty(exports, "__esModule", { value: true });
exports.useSmartPoll = useSmartPoll;
const react_1 = require("react");
const store_1 = require("@/store");
/**
 * Visibility-aware polling hook that pauses when the browser tab is hidden
 * and resumes immediately when the tab becomes visible again.
 *
 * Always fires an initial fetch on mount (regardless of SSE/WS state)
 * to bootstrap component data. Subsequent polls respect pause options.
 *
 * Returns a function to manually trigger an immediate poll.
 */
function useSmartPoll(callback, intervalMs, options = {}) {
    const { pauseWhenConnected = false, pauseWhenDisconnected = false, pauseWhenSseConnected = false, backoff = false, maxBackoffMultiplier = 3, enabled = true, } = options;
    const callbackRef = (0, react_1.useRef)(callback);
    const intervalRef = (0, react_1.useRef)(undefined);
    const backoffMultiplierRef = (0, react_1.useRef)(1);
    const isVisibleRef = (0, react_1.useRef)(true);
    const initialFiredRef = (0, react_1.useRef)(false);
    const { connection } = (0, store_1.useMissionControl)();
    // Keep callback ref current without re-triggering the effect
    (0, react_1.useEffect)(() => {
        callbackRef.current = callback;
    }, [callback]);
    // Determine if ongoing polling should be active
    const shouldPoll = (0, react_1.useCallback)(() => {
        if (!enabled)
            return false;
        if (!isVisibleRef.current)
            return false;
        if (pauseWhenConnected && connection.isConnected)
            return false;
        if (pauseWhenDisconnected && !connection.isConnected)
            return false;
        if (pauseWhenSseConnected && connection.sseConnected)
            return false;
        return true;
    }, [enabled, pauseWhenConnected, pauseWhenDisconnected, pauseWhenSseConnected, connection.isConnected, connection.sseConnected]);
    const fire = (0, react_1.useCallback)(() => {
        if (!shouldPoll())
            return;
        const result = callbackRef.current();
        if (result instanceof Promise) {
            result.catch(() => {
                if (backoff) {
                    backoffMultiplierRef.current = Math.min(backoffMultiplierRef.current + 0.5, maxBackoffMultiplier);
                }
            });
        }
    }, [shouldPoll, backoff, maxBackoffMultiplier]);
    const startInterval = (0, react_1.useCallback)(() => {
        if (intervalRef.current)
            clearInterval(intervalRef.current);
        if (!shouldPoll())
            return;
        const effectiveInterval = backoff
            ? intervalMs * backoffMultiplierRef.current
            : intervalMs;
        intervalRef.current = setInterval(() => {
            if (shouldPoll()) {
                callbackRef.current();
            }
        }, effectiveInterval);
    }, [intervalMs, shouldPoll, backoff]);
    // Main effect: set up polling + visibility listener
    (0, react_1.useEffect)(() => {
        // Always fire initial fetch to bootstrap data, even if SSE/WS is connected.
        // SSE delivers events (agent.updated, etc.) but not the full initial state.
        if (!initialFiredRef.current && enabled) {
            initialFiredRef.current = true;
            callbackRef.current();
        }
        // Start interval polling (respects shouldPoll for ongoing polls)
        startInterval();
        const handleVisibilityChange = () => {
            isVisibleRef.current = document.visibilityState === 'visible';
            if (isVisibleRef.current) {
                // Tab became visible: fire immediately, reset backoff, restart interval
                backoffMultiplierRef.current = 1;
                fire();
                startInterval();
            }
            else {
                // Tab hidden: stop polling
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                    intervalRef.current = undefined;
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = undefined;
            }
        };
    }, [fire, startInterval, enabled]);
    // Restart interval when connection state changes (WS or SSE)
    (0, react_1.useEffect)(() => {
        startInterval();
    }, [connection.isConnected, connection.sseConnected, startInterval]);
    // Return manual trigger
    return fire;
}
