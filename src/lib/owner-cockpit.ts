import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getDatabase } from '@/lib/db'

export type OwnerCockpitStatus = 'good' | 'warn' | 'bad'
export type OwnerCockpitTrend = 'up' | 'down' | 'flat'

export interface OwnerCockpitMetric {
  id: 'apiCost' | 'activeTrades' | 'lastSignal' | 'errorRate'
  label: string
  value: string
  detail: string
  trend: OwnerCockpitTrend
  trendLabel: string
  status: OwnerCockpitStatus
  source: string
  rawValue: number | null
  previousRawValue: number | null
}

export interface OwnerCockpitData {
  generatedAt: number
  metrics: OwnerCockpitMetric[]
}

export interface OwnerCockpitSources {
  missionControlDbPath?: string
  paperTradeDbPaths?: string[]
  signalEventPaths?: string[]
  scannerLogPaths?: string[]
  heartbeatLogDir?: string
  openClawAgentSessionsGlobBase?: string
}

type TimeWindow = {
  currentStart: number
  currentEnd: number
  previousStart: number
  previousEnd: number
}

function getDefaultSources(): Required<OwnerCockpitSources> {
  const workspaceRoot = path.resolve(process.cwd(), '..')

  return {
    missionControlDbPath: path.join(process.cwd(), '.data', 'mission-control.db'),
    paperTradeDbPaths: [
      path.join(workspaceRoot, 'polymarket-trading-bot', 'data', 'paper_trades.db'),
      path.join(workspaceRoot, 'polymarket-trading-bot', 'data-azure', 'paper_trades.db'),
      path.join(os.homedir(), '.openclaw', 'workspace-sentinel', 'data', 'paper_trades.db'),
    ],
    signalEventPaths: [
      path.join(workspaceRoot, 'btc-5m-latency', 'data', 'signal_events.jsonl'),
    ],
    scannerLogPaths: [
      path.join(workspaceRoot, 'polymarket-trading-bot', 'scanner_run.log'),
    ],
    heartbeatLogDir: path.join(os.homedir(), '.mission-control', 'logs'),
    openClawAgentSessionsGlobBase: path.join(os.homedir(), '.openclaw', 'agents'),
  }
}

function getDayBounds(now = new Date()): TimeWindow {
  const currentStartDate = new Date(now)
  currentStartDate.setHours(0, 0, 0, 0)
  const currentEndDate = new Date(now)
  const previousStartDate = new Date(currentStartDate.getTime() - 24 * 60 * 60 * 1000)
  const previousEndDate = new Date(currentStartDate.getTime() - 1)

  return {
    currentStart: currentStartDate.getTime(),
    currentEnd: currentEndDate.getTime(),
    previousStart: previousStartDate.getTime(),
    previousEnd: previousEndDate.getTime(),
  }
}

function getRolling24hBounds(now = Date.now()): TimeWindow {
  return {
    currentStart: now - 24 * 60 * 60 * 1000,
    currentEnd: now,
    previousStart: now - 48 * 60 * 60 * 1000,
    previousEnd: now - 24 * 60 * 60 * 1000,
  }
}

function toTrend(current: number | null, previous: number | null): OwnerCockpitTrend {
  if (current == null || previous == null) return 'flat'
  if (current > previous) return 'up'
  if (current < previous) return 'down'
  return 'flat'
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function formatTimestamp(value: number | null): string {
  if (value == null) return 'Unavailable'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatRelativeAge(value: number | null, now = Date.now()): string {
  if (value == null) return 'No signal found'
  const diffMs = Math.max(0, now - value)
  const diffMinutes = Math.floor(diffMs / 60000)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function formatTrendDelta(current: number | null, previous: number | null, formatter: (value: number) => string, emptyLabel = 'vs yesterday'): string {
  if (current == null || previous == null) return emptyLabel
  const diff = current - previous
  if (Math.abs(diff) < 0.0001) return 'vs yesterday flat'
  const prefix = diff > 0 ? '+' : '-'
  return `vs yesterday ${prefix}${formatter(Math.abs(diff))}`
}

function formatSignalTrend(current: number | null, previous: number | null): string {
  if (current == null && previous == null) return 'No signal history'
  if (current == null) return 'No signal today'
  if (previous == null) return 'New signal source'
  if (current === previous) return 'Matches yesterday'
  return current > previous ? 'Newer than yesterday' : 'Older than yesterday'
}

function safeExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000
  }
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getApiCostFromMissionControlDb(now: Date, dbPath: string): { current: number; previous: number; source: string } | null {
  if (!safeExists(dbPath)) return null

  const db = getDatabase()
  const dayBounds = getDayBounds(now)

  const rows = db.prepare(`
    SELECT created_at, cost_usd
    FROM token_usage
    WHERE created_at >= ? AND created_at < ?
    ORDER BY created_at ASC
  `).all(
    Math.floor(dayBounds.previousStart / 1000),
    Math.ceil(dayBounds.currentEnd / 1000),
  ) as Array<{ created_at: number; cost_usd: number | null }>

  if (rows.length === 0) return null

  let current = 0
  let previous = 0

  for (const row of rows) {
    const tsMs = row.created_at * 1000
    const cost = Number(row.cost_usd || 0)
    if (tsMs >= dayBounds.currentStart && tsMs <= dayBounds.currentEnd) current += cost
    if (tsMs >= dayBounds.previousStart && tsMs <= dayBounds.previousEnd) previous += cost
  }

  return {
    current,
    previous,
    source: 'Mission Control token_usage',
  }
}

function getApiCostFromSessionLogs(now: Date, sessionsRoot: string): { current: number; previous: number; source: string } | null {
  if (!safeExists(sessionsRoot)) return null

  const dayBounds = getDayBounds(now)
  const filePaths = fs.readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const sessionDir = path.join(sessionsRoot, entry.name, 'sessions')
      if (!safeExists(sessionDir)) return []
      return fs.readdirSync(sessionDir)
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => path.join(sessionDir, name))
    })

  let current = 0
  let previous = 0

  for (const filePath of filePaths) {
    try {
      const stat = fs.statSync(filePath)
      if (stat.mtimeMs < dayBounds.previousStart) continue

      const lines = fs.readFileSync(filePath, 'utf8').split('\n')
      for (const line of lines) {
        if (!line.includes('"usage"') || !line.includes('"cost"')) continue
        try {
          const parsed = JSON.parse(line)
          const message = parsed?.message
          const ts = parseTimestamp(parsed?.timestamp || message?.timestamp)
          const cost = Number(message?.usage?.cost?.total)
          if (ts == null || !Number.isFinite(cost) || cost <= 0) continue
          if (ts >= dayBounds.currentStart && ts <= dayBounds.currentEnd) current += cost
          if (ts >= dayBounds.previousStart && ts <= dayBounds.previousEnd) previous += cost
        } catch {
          continue
        }
      }
    } catch {
      continue
    }
  }

  if (current === 0 && previous === 0) return null

  return {
    current,
    previous,
    source: 'OpenClaw session usage logs',
  }
}

function parsePaperTradeRows(dbPath: string): Array<{ timestamp: number | null; resolved: boolean; resolvedAt: number | null }> {
  if (!safeExists(dbPath)) return []

  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const rows = db.prepare('SELECT timestamp, resolved, resolved_at FROM paper_trades').all() as Array<{
      timestamp: string
      resolved: number | null
      resolved_at: string | null
    }>

    return rows.map((row) => ({
      timestamp: parseTimestamp(row.timestamp),
      resolved: Boolean(row.resolved),
      resolvedAt: parseTimestamp(row.resolved_at),
    }))
  } catch {
    return []
  } finally {
    db.close()
  }
}

function getPaperTradeSnapshot(now: Date, dbPaths: string[]): { current: number; previous: number; source: string } {
  const currentStart = getDayBounds(now).currentStart
  let current = 0
  let previous = 0
  let sources = 0

  for (const dbPath of dbPaths) {
    if (!safeExists(dbPath)) continue
    sources += 1
    for (const row of parsePaperTradeRows(dbPath)) {
      const openedAt = row.timestamp
      if (openedAt == null) continue
      const stillOpen = !row.resolved || row.resolvedAt == null
      if (stillOpen) current += 1

      const openAtYesterdayClose =
        openedAt < currentStart &&
        (!row.resolvedAt || row.resolvedAt >= currentStart)

      if (openAtYesterdayClose) previous += 1
    }
  }

  return {
    current,
    previous,
    source: sources > 0 ? 'paper_trades.db' : 'paper_trades.db unavailable',
  }
}

function getSignalSnapshot(now: Date, signalPaths: string[], scannerLogPaths: string[]): { current: number | null; previous: number | null; source: string } {
  const dayBounds = getDayBounds(now)
  let current: number | null = null
  let previous: number | null = null

  for (const signalPath of signalPaths) {
    if (!safeExists(signalPath)) continue
    try {
      const lines = fs.readFileSync(signalPath, 'utf8').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          const ts = parseTimestamp(parsed.reference_received_ts_ms ?? parsed.reference_event_ts_ms ?? parsed.timestamp ?? parsed.created_at)
          if (ts == null) continue
          if (current == null || ts > current) current = ts
          if (ts >= dayBounds.previousStart && ts <= dayBounds.previousEnd && (previous == null || ts > previous)) previous = ts
        } catch {
          continue
        }
      }
      if (current != null || previous != null) {
        return { current, previous, source: path.basename(signalPath) }
      }
    } catch {
      continue
    }
  }

  for (const scannerLogPath of scannerLogPaths) {
    if (!safeExists(scannerLogPath)) continue
    try {
      const stat = fs.statSync(scannerLogPath)
      current = stat.mtimeMs
      if (current >= dayBounds.previousStart && current <= dayBounds.previousEnd) previous = current
      return { current, previous, source: path.basename(scannerLogPath) }
    } catch {
      continue
    }
  }

  return {
    current: null,
    previous: null,
    source: 'signal logs unavailable',
  }
}

function getHeartbeatErrorSnapshot(now: Date, heartbeatLogDir: string, sessionsRoot: string): { currentRate: number; previousRate: number; currentErrors: number; currentTotal: number; source: string } {
  const windows = getRolling24hBounds(now.getTime())

  const heartbeatLogs = safeExists(heartbeatLogDir)
    ? fs.readdirSync(heartbeatLogDir)
        .filter((name) => /^agent-heartbeat-.*\.log$/.test(name))
        .map((name) => path.join(heartbeatLogDir, name))
    : []

  if (heartbeatLogs.length > 0) {
    let currentErrors = 0
    let currentTotal = 0
    let previousErrors = 0
    let previousTotal = 0

    for (const logPath of heartbeatLogs) {
      try {
        const lines = fs.readFileSync(logPath, 'utf8').split('\n')
        for (const line of lines) {
          const match = line.match(/^\[(.+?)\]\s+\[(.+?)\]/)
          if (!match) continue
          const ts = parseTimestamp(match[1])
          if (ts == null) continue
          const isError = match[2] === 'ERROR'
          const isTotal = line.includes('Checking heartbeat for agent:')
          if (ts >= windows.currentStart && ts <= windows.currentEnd) {
            if (isTotal) currentTotal += 1
            if (isError) currentErrors += 1
          }
          if (ts >= windows.previousStart && ts < windows.previousEnd) {
            if (isTotal) previousTotal += 1
            if (isError) previousErrors += 1
          }
        }
      } catch {
        continue
      }
    }

    return {
      currentRate: currentTotal > 0 ? currentErrors / currentTotal : 0,
      previousRate: previousTotal > 0 ? previousErrors / previousTotal : 0,
      currentErrors,
      currentTotal,
      source: 'agent-heartbeat logs',
    }
  }

  let currentErrors = 0
  let currentTotal = 0
  let previousErrors = 0
  let previousTotal = 0

  if (safeExists(sessionsRoot)) {
    const agentDirs = fs.readdirSync(sessionsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())

    for (const agentDir of agentDirs) {
      const sessionDir = path.join(sessionsRoot, agentDir.name, 'sessions')
      if (!safeExists(sessionDir)) continue
      const sessionFiles = fs.readdirSync(sessionDir)
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => path.join(sessionDir, name))

      for (const filePath of sessionFiles) {
        try {
          const stat = fs.statSync(filePath)
          if (stat.mtimeMs < windows.previousStart) continue
          const lines = fs.readFileSync(filePath, 'utf8').split('\n')
          for (const line of lines) {
            if (!line.includes('Read HEARTBEAT.md if it exists')) continue
            try {
              const parsed = JSON.parse(line)
              const ts = parseTimestamp(parsed.timestamp ?? parsed?.message?.timestamp)
              if (ts == null) continue

              let text = ''
              const content = parsed?.message?.content
              if (Array.isArray(content)) {
                for (const item of content) {
                  if (item?.type === 'text') text += item.text || ''
                }
              }

              const isError = /\b(ERROR|Exec failed|produced no output|timed out|terminated)\b/i.test(text)

              if (ts >= windows.currentStart && ts <= windows.currentEnd) {
                currentTotal += 1
                if (isError) currentErrors += 1
              }
              if (ts >= windows.previousStart && ts < windows.previousEnd) {
                previousTotal += 1
                if (isError) previousErrors += 1
              }
            } catch {
              continue
            }
          }
        } catch {
          continue
        }
      }
    }
  }

  return {
    currentRate: currentTotal > 0 ? currentErrors / currentTotal : 0,
    previousRate: previousTotal > 0 ? previousErrors / previousTotal : 0,
    currentErrors,
    currentTotal,
    source: 'OpenClaw heartbeat session logs',
  }
}

export async function collectOwnerCockpitData(sources: OwnerCockpitSources = {}, now: Date = new Date()): Promise<OwnerCockpitData> {
  const resolved = { ...getDefaultSources(), ...sources }
  const dbCost = getApiCostFromMissionControlDb(now, resolved.missionControlDbPath)
  const sessionCost = getApiCostFromSessionLogs(now, resolved.openClawAgentSessionsGlobBase)
  const apiCostSnapshot = dbCost ?? sessionCost ?? { current: 0, previous: 0, source: 'No API cost records found' }

  const paperTradeSnapshot = getPaperTradeSnapshot(now, resolved.paperTradeDbPaths)
  const signalSnapshot = getSignalSnapshot(now, resolved.signalEventPaths, resolved.scannerLogPaths)
  const heartbeatSnapshot = getHeartbeatErrorSnapshot(now, resolved.heartbeatLogDir, resolved.openClawAgentSessionsGlobBase)

  const apiTrend = toTrend(apiCostSnapshot.current, apiCostSnapshot.previous)
  const tradeTrend = toTrend(paperTradeSnapshot.current, paperTradeSnapshot.previous)
  const signalTrend = toTrend(signalSnapshot.current, signalSnapshot.previous)
  const errorTrend = toTrend(heartbeatSnapshot.currentRate, heartbeatSnapshot.previousRate)

  const apiStatus: OwnerCockpitStatus =
    apiCostSnapshot.current >= 25 ? 'bad' :
    apiCostSnapshot.current >= 10 ? 'warn' :
    'good'

  const tradeStatus: OwnerCockpitStatus =
    paperTradeSnapshot.current > 6 ? 'bad' :
    paperTradeSnapshot.current > 2 ? 'warn' :
    'good'

  const signalAgeHours = signalSnapshot.current == null ? Number.POSITIVE_INFINITY : (Date.now() - signalSnapshot.current) / 3600000
  const signalStatus: OwnerCockpitStatus =
    signalAgeHours > 24 ? 'bad' :
    signalAgeHours > 6 ? 'warn' :
    'good'

  const errorRatePercent = heartbeatSnapshot.currentRate * 100
  const previousErrorRatePercent = heartbeatSnapshot.previousRate * 100
  const errorStatus: OwnerCockpitStatus =
    errorRatePercent >= 20 ? 'bad' :
    errorRatePercent >= 5 ? 'warn' :
    'good'

  return {
    generatedAt: Date.now(),
    metrics: [
      {
        id: 'apiCost',
        label: 'Daily API Cost',
        value: formatCurrency(apiCostSnapshot.current),
        detail: apiCostSnapshot.source,
        trend: apiTrend,
        trendLabel: formatTrendDelta(apiCostSnapshot.current, apiCostSnapshot.previous, (value) => formatCurrency(value)),
        status: apiStatus,
        source: apiCostSnapshot.source,
        rawValue: apiCostSnapshot.current,
        previousRawValue: apiCostSnapshot.previous,
      },
      {
        id: 'activeTrades',
        label: 'Paper Trades Open',
        value: formatNumber(paperTradeSnapshot.current),
        detail: paperTradeSnapshot.source,
        trend: tradeTrend,
        trendLabel: formatTrendDelta(paperTradeSnapshot.current, paperTradeSnapshot.previous, (value) => formatNumber(value)),
        status: tradeStatus,
        source: paperTradeSnapshot.source,
        rawValue: paperTradeSnapshot.current,
        previousRawValue: paperTradeSnapshot.previous,
      },
      {
        id: 'lastSignal',
        label: 'Last Market Signal',
        value: formatTimestamp(signalSnapshot.current),
        detail: formatRelativeAge(signalSnapshot.current),
        trend: signalTrend,
        trendLabel: formatSignalTrend(signalSnapshot.current, signalSnapshot.previous),
        status: signalStatus,
        source: signalSnapshot.source,
        rawValue: signalSnapshot.current,
        previousRawValue: signalSnapshot.previous,
      },
      {
        id: 'errorRate',
        label: 'Agent Error Rate',
        value: formatPercent(errorRatePercent),
        detail: `${heartbeatSnapshot.currentErrors}/${heartbeatSnapshot.currentTotal} heartbeats in last 24h`,
        trend: errorTrend,
        trendLabel: formatTrendDelta(errorRatePercent, previousErrorRatePercent, (value) => formatPercent(value), 'vs prior 24h'),
        status: errorStatus,
        source: heartbeatSnapshot.source,
        rawValue: errorRatePercent,
        previousRawValue: previousErrorRatePercent,
      },
    ],
  }
}
