"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const auth_1 = require("@/lib/auth");
const config_1 = require("@/lib/config");
const hermes_sessions_1 = require("@/lib/hermes-sessions");
const hermes_tasks_1 = require("@/lib/hermes-tasks");
const hermes_memory_1 = require("@/lib/hermes-memory");
const logger_1 = require("@/lib/logger");
const HERMES_HOME = (0, node_path_1.join)(config_1.config.homeDir, '.hermes');
const HOOK_DIR = (0, node_path_1.join)(HERMES_HOME, 'hooks', 'mission-control');
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const installed = (0, hermes_sessions_1.isHermesInstalled)();
        const gatewayRunning = installed ? (0, hermes_sessions_1.isHermesGatewayRunning)() : false;
        const hookInstalled = (0, node_fs_1.existsSync)((0, node_path_1.join)(HOOK_DIR, 'HOOK.yaml'));
        const activeSessions = installed ? (0, hermes_sessions_1.scanHermesSessions)(50).filter(s => s.isActive).length : 0;
        const cronJobCount = installed ? (0, hermes_tasks_1.getHermesTasks)().cronJobs.length : 0;
        const memoryEntries = installed ? (0, hermes_memory_1.getHermesMemory)().agentMemoryEntries : 0;
        return server_1.NextResponse.json({
            installed,
            gatewayRunning,
            hookInstalled,
            activeSessions,
            cronJobCount,
            memoryEntries,
            hookDir: HOOK_DIR,
        });
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Hermes status check failed');
        return server_1.NextResponse.json({ error: 'Failed to check hermes status' }, { status: 500 });
    }
}
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const body = await request.json();
        const { action } = body;
        if (action === 'install-hook') {
            if (!(0, hermes_sessions_1.isHermesInstalled)()) {
                return server_1.NextResponse.json({ error: 'Hermes is not installed (~/.hermes/ not found)' }, { status: 400 });
            }
            (0, node_fs_1.mkdirSync)(HOOK_DIR, { recursive: true });
            // Write HOOK.yaml
            (0, node_fs_1.writeFileSync)((0, node_path_1.join)(HOOK_DIR, 'HOOK.yaml'), HOOK_YAML, 'utf8');
            // Write handler.py
            (0, node_fs_1.writeFileSync)((0, node_path_1.join)(HOOK_DIR, 'handler.py'), HANDLER_PY, 'utf8');
            logger_1.logger.info('Installed Mission Control hook for Hermes Agent');
            return server_1.NextResponse.json({ success: true, message: 'Hook installed', hookDir: HOOK_DIR });
        }
        if (action === 'uninstall-hook') {
            if ((0, node_fs_1.existsSync)(HOOK_DIR)) {
                (0, node_fs_1.rmSync)(HOOK_DIR, { recursive: true, force: true });
            }
            logger_1.logger.info('Uninstalled Mission Control hook for Hermes Agent');
            return server_1.NextResponse.json({ success: true, message: 'Hook uninstalled' });
        }
        return server_1.NextResponse.json({ error: 'Invalid action. Must be: install-hook, uninstall-hook' }, { status: 400 });
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Hermes hook management failed');
        return server_1.NextResponse.json({ error: err.message || 'Hook operation failed' }, { status: 500 });
    }
}
// ---------------------------------------------------------------------------
// Hook file contents
// ---------------------------------------------------------------------------
const HOOK_YAML = `name: mission-control
description: Reports agent telemetry to Mission Control
version: "1.0"
events:
  - agent:start
  - agent:end
  - session:start
`;
const HANDLER_PY = `"""
Mission Control hook for Hermes Agent.
Reports session telemetry to the MC /api/sessions endpoint.

Configuration (via ~/.hermes/.env or environment):
  MC_URL      - Mission Control base URL (default: http://localhost:3000)
  MC_API_KEY  - API key for authentication (optional)
"""

import os
import logging
from datetime import datetime, timezone

logger = logging.getLogger("hooks.mission-control")

MC_URL = os.environ.get("MC_URL", "http://localhost:3000")
MC_API_KEY = os.environ.get("MC_API_KEY", "")


def _headers():
    h = {"Content-Type": "application/json"}
    if MC_API_KEY:
        h["X-Api-Key"] = MC_API_KEY
    return h


async def handle_event(event_name: str, payload: dict) -> None:
    """
    Called by the Hermes hook registry on matching events.
    Fire-and-forget with a short timeout — never blocks the agent.
    """
    try:
        import httpx
    except ImportError:
        logger.debug("httpx not available, skipping MC telemetry")
        return

    try:
        if event_name == "agent:start":
            await _report_agent_start(payload)
        elif event_name == "agent:end":
            await _report_agent_end(payload)
        elif event_name == "session:start":
            await _report_session_start(payload)
    except Exception as exc:
        logger.debug("MC hook error (%s): %s", event_name, exc)


async def _report_agent_start(payload: dict) -> None:
    import httpx

    data = {
        "name": payload.get("agent_name", "hermes"),
        "role": "Hermes Agent",
        "status": "active",
        "source": "hermes-hook",
    }
    async with httpx.AsyncClient(timeout=2.0) as client:
        await client.post(f"{MC_URL}/api/agents", json=data, headers=_headers())


async def _report_agent_end(payload: dict) -> None:
    import httpx

    data = {
        "name": payload.get("agent_name", "hermes"),
        "status": "idle",
        "source": "hermes-hook",
    }
    async with httpx.AsyncClient(timeout=2.0) as client:
        await client.post(f"{MC_URL}/api/agents", json=data, headers=_headers())


async def _report_session_start(payload: dict) -> None:
    import httpx

    data = {
        "event": "session:start",
        "session_id": payload.get("session_id", ""),
        "source": payload.get("source", "cli"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    async with httpx.AsyncClient(timeout=2.0) as client:
        await client.post(f"{MC_URL}/api/hermes/events", json=data, headers=_headers())
`;
exports.dynamic = 'force-dynamic';
