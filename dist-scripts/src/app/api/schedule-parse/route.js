"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const schedule_parser_1 = require("@/lib/schedule-parser");
/**
 * GET /api/schedule-parse?input=every+morning+at+9am
 * Returns { cronExpr, humanReadable } or { error }
 */
async function GET(request) {
    const input = request.nextUrl.searchParams.get('input');
    if (!input) {
        return server_1.NextResponse.json({ error: 'Missing input parameter' }, { status: 400 });
    }
    const result = (0, schedule_parser_1.parseNaturalSchedule)(input);
    if (!result) {
        return server_1.NextResponse.json({ error: 'Could not parse schedule expression' }, { status: 400 });
    }
    return server_1.NextResponse.json(result);
}
