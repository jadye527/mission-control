import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { collectOwnerCockpitData } from '@/lib/owner-cockpit'

const tempDirs: string[] = []

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-cockpit-'))
  tempDirs.push(dir)
  return dir
}

function writePaperTrades(dbPath: string) {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      resolved BOOLEAN DEFAULT 0,
      resolved_at TEXT
    );
  `)
  db.prepare('INSERT INTO paper_trades (timestamp, resolved, resolved_at) VALUES (?, ?, ?)').run('2026-03-18T10:00:00-04:00', 0, null)
  db.prepare('INSERT INTO paper_trades (timestamp, resolved, resolved_at) VALUES (?, ?, ?)').run('2026-03-17T10:00:00-04:00', 0, null)
  db.prepare('INSERT INTO paper_trades (timestamp, resolved, resolved_at) VALUES (?, ?, ?)').run('2026-03-17T09:00:00-04:00', 1, '2026-03-17T18:00:00-04:00')
  db.close()
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('owner cockpit collector', () => {
  it('builds metrics from real source files and logs', async () => {
    const tempDir = makeTempDir()
    const signalsDir = path.join(tempDir, 'signals')
    const heartbeatDir = path.join(tempDir, 'heartbeats')
    const openClawAgentsDir = path.join(tempDir, 'agents')
    const paperDbPath = path.join(tempDir, 'paper_trades.db')

    fs.mkdirSync(signalsDir, { recursive: true })
    fs.mkdirSync(heartbeatDir, { recursive: true })
    fs.mkdirSync(path.join(openClawAgentsDir, 'alpha', 'sessions'), { recursive: true })

    writePaperTrades(paperDbPath)

    fs.writeFileSync(path.join(signalsDir, 'signal_events.jsonl'), [
      JSON.stringify({ reference_received_ts_ms: Date.parse('2026-03-17T14:00:00-04:00') }),
      JSON.stringify({ reference_received_ts_ms: Date.parse('2026-03-18T11:00:00-04:00') }),
    ].join('\n'))

    fs.writeFileSync(path.join(openClawAgentsDir, 'alpha', 'sessions', 'alpha.jsonl'), [
      JSON.stringify({
        timestamp: '2026-03-18T10:05:00.000-04:00',
        message: {
          content: [
            {
              type: 'text',
              text: 'System: Exec failed (abc)\nRead HEARTBEAT.md if it exists (workspace context). Follow it strictly.',
            },
          ],
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-18T09:05:00.000-04:00',
        message: {
          content: [
            {
              type: 'text',
              text: 'Read HEARTBEAT.md if it exists (workspace context). Follow it strictly.',
            },
          ],
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-18T08:05:00.000-04:00',
        message: {
          usage: { cost: { total: 1.25 } },
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-17T08:05:00.000-04:00',
        message: {
          usage: { cost: { total: 0.5 } },
        },
      }),
    ].join('\n'))

    const result = await collectOwnerCockpitData(
      {
        missionControlDbPath: path.join(tempDir, 'missing-mc.db'),
        paperTradeDbPaths: [paperDbPath],
        signalEventPaths: [path.join(signalsDir, 'signal_events.jsonl')],
        scannerLogPaths: [],
        heartbeatLogDir: heartbeatDir,
        openClawAgentSessionsGlobBase: openClawAgentsDir,
      },
      new Date('2026-03-18T12:00:00-04:00'),
    )

    expect(result.metrics).toHaveLength(4)

    const apiCost = result.metrics.find((metric) => metric.id === 'apiCost')
    expect(apiCost?.value).toBe('$1.25')
    expect(apiCost?.trend).toBe('up')

    const trades = result.metrics.find((metric) => metric.id === 'activeTrades')
    expect(trades?.value).toBe('2')

    const signal = result.metrics.find((metric) => metric.id === 'lastSignal')
    expect(signal?.value).toContain('Mar')
    expect(signal?.source).toBe('signal_events.jsonl')

    const errorRate = result.metrics.find((metric) => metric.id === 'errorRate')
    expect(errorRate?.value).toBe('50.0%')
    expect(errorRate?.detail).toContain('1/2')
  })
})
