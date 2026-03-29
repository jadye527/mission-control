"use strict";
'use client';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateDeviceIdentity = getOrCreateDeviceIdentity;
exports.signPayload = signPayload;
exports.getCachedDeviceToken = getCachedDeviceToken;
exports.cacheDeviceToken = cacheDeviceToken;
exports.clearDeviceIdentity = clearDeviceIdentity;
const client_logger_1 = require("@/lib/client-logger");
const log = (0, client_logger_1.createClientLogger)('DeviceIdentity');
/**
 * Ed25519 device identity for OpenClaw gateway protocol v3 challenge-response.
 *
 * Generates a persistent Ed25519 key pair on first use, stores it in localStorage,
 * and signs server nonces during the WebSocket connect handshake.
 *
 * Falls back gracefully when Ed25519 is unavailable (older browsers) —
 * the handshake proceeds without device identity (auth-token-only mode).
 */
// localStorage keys
const STORAGE_DEVICE_ID = 'mc-device-id';
const STORAGE_PUBKEY = 'mc-device-pubkey';
const STORAGE_PRIVKEY = 'mc-device-privkey';
const STORAGE_DEVICE_TOKEN = 'mc-device-token';
// ── Helpers ──────────────────────────────────────────────────────
function toBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer));
    const bytes = new Uint8Array(digest);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
// ── Key management ───────────────────────────────────────────────
async function importPrivateKey(pkcs8Bytes) {
    return crypto.subtle.importKey('pkcs8', pkcs8Bytes, 'Ed25519', false, ['sign']);
}
async function createNewIdentity() {
    const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const privPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    // OpenClaw expects device.id = sha256(rawPublicKey) in lowercase hex.
    const deviceId = await sha256Hex(pubRaw);
    const publicKeyBase64 = toBase64Url(pubRaw);
    const privateKeyBase64 = toBase64Url(privPkcs8);
    localStorage.setItem(STORAGE_DEVICE_ID, deviceId);
    localStorage.setItem(STORAGE_PUBKEY, publicKeyBase64);
    localStorage.setItem(STORAGE_PRIVKEY, privateKeyBase64);
    return {
        deviceId,
        publicKeyBase64,
        privateKey: keyPair.privateKey,
    };
}
// ── Public API ───────────────────────────────────────────────────
/**
 * Returns existing device identity from localStorage or generates a new one.
 * Throws if Ed25519 is not supported by the browser.
 */
async function getOrCreateDeviceIdentity() {
    const storedId = localStorage.getItem(STORAGE_DEVICE_ID);
    const storedPub = localStorage.getItem(STORAGE_PUBKEY);
    const storedPriv = localStorage.getItem(STORAGE_PRIVKEY);
    if (storedId && storedPub && storedPriv) {
        try {
            const privateKey = await importPrivateKey(fromBase64Url(storedPriv));
            return {
                deviceId: storedId,
                publicKeyBase64: storedPub,
                privateKey,
            };
        }
        catch (_a) {
            // Stored key corrupted — regenerate
            log.warn('Device identity keys corrupted, regenerating...');
        }
    }
    return createNewIdentity();
}
/**
 * Signs an auth payload with the Ed25519 private key.
 * Returns base64url signature and signing timestamp.
 */
async function signPayload(privateKey, payload, signedAt = Date.now()) {
    const encoder = new TextEncoder();
    const payloadBytes = encoder.encode(payload);
    const signatureBuffer = await crypto.subtle.sign('Ed25519', privateKey, payloadBytes);
    return {
        signature: toBase64Url(signatureBuffer),
        signedAt,
    };
}
/** Reads cached device token from localStorage (returned by gateway on successful connect). */
function getCachedDeviceToken() {
    return localStorage.getItem(STORAGE_DEVICE_TOKEN);
}
/** Caches the device token returned by the gateway after successful connect. */
function cacheDeviceToken(token) {
    localStorage.setItem(STORAGE_DEVICE_TOKEN, token);
}
/** Removes all device identity data from localStorage (for troubleshooting). */
function clearDeviceIdentity() {
    localStorage.removeItem(STORAGE_DEVICE_ID);
    localStorage.removeItem(STORAGE_PUBKEY);
    localStorage.removeItem(STORAGE_PRIVKEY);
    localStorage.removeItem(STORAGE_DEVICE_TOKEN);
}
