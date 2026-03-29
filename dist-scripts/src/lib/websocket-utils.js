"use strict";
/**
 * Pure utility functions extracted from the WebSocket module for testability.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NON_RETRYABLE_ERROR_CODES = exports.ConnectErrorDetailCodes = void 0;
exports.readErrorDetailCode = readErrorDetailCode;
exports.isNonRetryableErrorCode = isNonRetryableErrorCode;
exports.shouldRetryWithoutDeviceIdentity = shouldRetryWithoutDeviceIdentity;
exports.calculateBackoff = calculateBackoff;
exports.detectSequenceGap = detectSequenceGap;
/** Known gateway connect error detail codes (structured error codes sent by newer gateways) */
exports.ConnectErrorDetailCodes = {
    AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
    AUTH_PASSWORD_MISSING: 'AUTH_PASSWORD_MISSING',
    AUTH_PASSWORD_MISMATCH: 'AUTH_PASSWORD_MISMATCH',
    AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED',
    AUTH_TOKEN_MISMATCH: 'AUTH_TOKEN_MISMATCH',
    ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
    DEVICE_SIGNATURE_INVALID: 'DEVICE_SIGNATURE_INVALID',
};
/** Extract structured error code from a gateway error frame, if present. */
function readErrorDetailCode(error) {
    var _a;
    if (!error || typeof error !== 'object')
        return null;
    // Newer gateways include a structured details object with a code field
    const detailsCode = (_a = error.details) === null || _a === void 0 ? void 0 : _a.code;
    if (typeof detailsCode === 'string' && detailsCode.length > 0)
        return detailsCode;
    // Some frames carry code at the top level
    const topCode = error.code;
    if (typeof topCode === 'string' && topCode.length > 0)
        return topCode;
    return null;
}
/** Error codes that should never trigger auto-reconnect. */
exports.NON_RETRYABLE_ERROR_CODES = new Set([
    exports.ConnectErrorDetailCodes.AUTH_TOKEN_MISSING,
    exports.ConnectErrorDetailCodes.AUTH_PASSWORD_MISSING,
    exports.ConnectErrorDetailCodes.AUTH_PASSWORD_MISMATCH,
    exports.ConnectErrorDetailCodes.AUTH_RATE_LIMITED,
    exports.ConnectErrorDetailCodes.ORIGIN_NOT_ALLOWED,
    exports.ConnectErrorDetailCodes.DEVICE_SIGNATURE_INVALID,
]);
/** Check whether a given error code is non-retryable. */
function isNonRetryableErrorCode(code) {
    return exports.NON_RETRYABLE_ERROR_CODES.has(code);
}
/**
 * Retry once without browser device identity when a valid gateway auth token
 * exists but the browser's cached device credentials appear invalid.
 */
function shouldRetryWithoutDeviceIdentity(message, error, hasAuthToken, alreadyRetried) {
    if (!hasAuthToken || alreadyRetried)
        return false;
    const code = readErrorDetailCode(error);
    if (code === exports.ConnectErrorDetailCodes.DEVICE_SIGNATURE_INVALID)
        return true;
    const normalized = message.toLowerCase();
    return (normalized.includes('device_auth_signature_invalid') ||
        normalized.includes('device signature invalid') ||
        normalized.includes('invalid device token') ||
        normalized.includes('device token invalid'));
}
/**
 * Calculate exponential backoff delay for reconnect attempts.
 * Uses base * 1.7^attempt, capped at 15000ms.
 * Returns only the deterministic base (without jitter) for testability.
 */
function calculateBackoff(attempt) {
    return Math.min(1000 * Math.pow(1.7, attempt), 15000);
}
/**
 * Detect a gap in event sequence numbers.
 * Returns info about the gap, or null if there is no gap.
 */
function detectSequenceGap(lastSeq, currentSeq) {
    if (lastSeq === null)
        return null;
    if (currentSeq <= lastSeq + 1)
        return null;
    const from = lastSeq + 1;
    const to = currentSeq - 1;
    return { from, to, count: to - from + 1 };
}
