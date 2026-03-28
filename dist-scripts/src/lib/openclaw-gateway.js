import { runOpenClaw } from './command';
export function parseGatewayJsonOutput(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed)
        return null;
    const objectStart = trimmed.indexOf('{');
    const arrayStart = trimmed.indexOf('[');
    const hasObject = objectStart >= 0;
    const hasArray = arrayStart >= 0;
    let start = -1;
    let end = -1;
    if (hasObject && hasArray) {
        if (objectStart < arrayStart) {
            start = objectStart;
            end = trimmed.lastIndexOf('}');
        }
        else {
            start = arrayStart;
            end = trimmed.lastIndexOf(']');
        }
    }
    else if (hasObject) {
        start = objectStart;
        end = trimmed.lastIndexOf('}');
    }
    else if (hasArray) {
        start = arrayStart;
        end = trimmed.lastIndexOf(']');
    }
    if (start < 0 || end < start)
        return null;
    try {
        return JSON.parse(trimmed.slice(start, end + 1));
    }
    catch (_a) {
        return null;
    }
}
export async function callOpenClawGateway(method, params, timeoutMs = 10000) {
    const result = await runOpenClaw([
        'gateway',
        'call',
        method,
        '--timeout',
        String(Math.max(1000, Math.floor(timeoutMs))),
        '--params',
        JSON.stringify(params !== null && params !== void 0 ? params : {}),
        '--json',
    ], { timeoutMs: timeoutMs + 2000 });
    const payload = parseGatewayJsonOutput(result.stdout);
    if (payload == null) {
        throw new Error(`Invalid JSON response from gateway method ${method}`);
    }
    return payload;
}
