"use strict";
/**
 * Lightweight structured logger for client-side ('use client') components.
 *
 * Mirrors pino's API surface (info/warn/error/debug) so call sites are
 * consistent with the server-side logger in src/lib/logger.ts.
 * In production builds, debug and info messages are suppressed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClientLogger = createClientLogger;
const LOG_LEVELS = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
const minLevel = process.env.NODE_ENV === 'production' ? LOG_LEVELS.warn : LOG_LEVELS.debug;
function shouldLog(level) {
    return LOG_LEVELS[level] >= minLevel;
}
function formatArgs(level, module, msgOrObj, ...rest) {
    const prefix = `[${level.toUpperCase()}] ${module}:`;
    if (typeof msgOrObj === 'string') {
        return [prefix, msgOrObj, ...rest];
    }
    return [prefix, msgOrObj, ...rest];
}
function createClientLogger(module) {
    return {
        debug(msgOrObj, ...rest) {
            if (!shouldLog('debug'))
                return;
            console.debug(...formatArgs('debug', module, msgOrObj, ...rest));
        },
        info(msgOrObj, ...rest) {
            if (!shouldLog('info'))
                return;
            console.info(...formatArgs('info', module, msgOrObj, ...rest));
        },
        warn(msgOrObj, ...rest) {
            if (!shouldLog('warn'))
                return;
            console.warn(...formatArgs('warn', module, msgOrObj, ...rest));
        },
        error(msgOrObj, ...rest) {
            if (!shouldLog('error'))
                return;
            console.error(...formatArgs('error', module, msgOrObj, ...rest));
        },
    };
}
