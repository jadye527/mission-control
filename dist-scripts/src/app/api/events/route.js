"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = exports.dynamic = void 0;
exports.GET = GET;
const server_1 = require("next/server");
const event_bus_1 = require("@/lib/event-bus");
const auth_1 = require("@/lib/auth");
exports.dynamic = 'force-dynamic';
exports.runtime = 'nodejs';
/**
 * GET /api/events - Server-Sent Events stream for real-time DB mutations.
 * Clients connect via EventSource and receive JSON-encoded events.
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const encoder = new TextEncoder();
    // Cleanup function, set in start(), called in cancel()
    let cleanup = null;
    const stream = new ReadableStream({
        start(controller) {
            var _a;
            // Send initial connection event
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', data: null, timestamp: Date.now() })}\n\n`));
            // Forward workspace-scoped server events to this SSE client
            const userWorkspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
            const handler = (event) => {
                var _a;
                // Skip events from other workspaces (if event carries workspace_id)
                if (((_a = event.data) === null || _a === void 0 ? void 0 : _a.workspace_id) && event.data.workspace_id !== userWorkspaceId)
                    return;
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                }
                catch (_b) {
                    // Client disconnected, cleanup will happen in cancel()
                }
            };
            event_bus_1.eventBus.on('server-event', handler);
            // Heartbeat every 30s to keep connection alive through proxies
            const heartbeat = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(': heartbeat\n\n'));
                }
                catch (_a) {
                    clearInterval(heartbeat);
                }
            }, 30000);
            cleanup = () => {
                event_bus_1.eventBus.off('server-event', handler);
                clearInterval(heartbeat);
            };
        },
        cancel() {
            if (cleanup) {
                cleanup();
                cleanup = null;
            }
        },
    });
    // Defense-in-depth: if the request is aborted (proxy timeout, network drop)
    // ensure we clean up the event listener even if cancel() doesn't fire.
    request.signal.addEventListener('abort', () => {
        if (cleanup) {
            cleanup();
            cleanup = null;
        }
    }, { once: true });
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no', // Disable nginx buffering
        },
    });
}
