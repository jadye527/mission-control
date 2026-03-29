"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.APP_VERSION = void 0;
// Single source of truth for the application version.
// Reads from package.json at build time so every consumer
// (header, websocket handshake, API routes) stays in sync.
const package_json_1 = __importDefault(require("../../package.json"));
exports.APP_VERSION = package_json_1.default.version;
