"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const fs_1 = require("fs");
const path_1 = require("path");
let cachedSpec = null;
async function GET() {
    if (!cachedSpec) {
        const specPath = (0, path_1.join)(process.cwd(), 'openapi.json');
        cachedSpec = (0, fs_1.readFileSync)(specPath, 'utf-8');
    }
    return new server_1.NextResponse(cachedSpec, {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600',
        },
    });
}
