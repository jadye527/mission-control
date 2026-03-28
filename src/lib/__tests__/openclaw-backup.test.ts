/**
 * TASK-055: OpenClaw Backup Scheduler — Unit Tests
 *
 * Tests runOpenClawBackup() behavior via the triggerTask() export:
 *   - daily (no-workspace) backup passes correct args
 *   - weekly (full) backup passes correct args
 *   - lifecycle pruning runs after success
 *   - failure from non-zero exit code returns ok: false
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockRunOpenClaw = vi.fn()
const mockPrepare = vi.fn()
const mockLogAuditEvent = vi.fn()
const mockReaddirSync = vi.fn(() => [] as string[])
const mockStatSync = vi.fn(() => ({ mtimeMs: Date.now() - 1000 }))
const mockUnlinkSync = vi.fn()
const mockMkdirSync = vi.fn()

vi.mock('@/lib/command', () => ({ runOpenClaw: mockRunOpenClaw }))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare: mockPrepare })),
  logAuditEvent: mockLogAuditEvent,
}))
vi.mock('@/lib/config', () => ({
  config: { dbPath: '/tmp/mc.db', retention: {} },
  ensureDirExists: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/agent-sync', () => ({ syncAgentsFromConfig: vi.fn(() => Promise.resolve({ created: 0, updated: 0, synced: 0 })) }))
vi.mock('fs', () => ({
  readdirSync: mockReaddirSync,
  statSync: mockStatSync,
  unlinkSync: mockUnlinkSync,
  mkdirSync: mockMkdirSync,
  existsSync: vi.fn(() => true),
  default: { readdirSync: mockReaddirSync, statSync: mockStatSync, unlinkSync: mockUnlinkSync, mkdirSync: mockMkdirSync, existsSync: vi.fn(() => true) },
}))

beforeEach(() => {
  vi.resetModules()
  mockRunOpenClaw.mockReset()
  mockPrepare.mockReset()
  mockLogAuditEvent.mockReset()
  mockReaddirSync.mockReturnValue([])
  mockMkdirSync.mockReturnValue(undefined)
})
afterEach(() => vi.clearAllMocks())

describe('OpenClaw Backup Scheduler Task', () => {
  it('daily schedule: calls backup create with --no-include-workspace', async () => {
    mockPrepare.mockReturnValue({
      get: vi.fn((key: string) => key === 'general.openclaw_backup_schedule' ? { value: 'daily' } : undefined)
    })
    mockRunOpenClaw.mockResolvedValue({ code: 0, stdout: 'Backup archive: /tmp/daily/2026-03-23T06-00.tar.gz', stderr: '' })

    const { triggerTask } = await import('@/lib/scheduler')
    const result = await triggerTask('openclaw_backup')

    expect(result.ok).toBe(true)
    const [args] = mockRunOpenClaw.mock.calls[0]
    expect(args).toContain('--no-include-workspace')
    expect(args).toContain('--output')
    expect(args.join(' ')).toContain('daily')
  })

  it('weekly schedule: calls backup create without --no-include-workspace', async () => {
    mockPrepare.mockReturnValue({
      get: vi.fn((key: string) => key === 'general.openclaw_backup_schedule' ? { value: 'weekly' } : undefined)
    })
    mockRunOpenClaw.mockResolvedValue({ code: 0, stdout: 'Backup archive: /tmp/weekly/2026-03-23T05-00.tar.gz', stderr: '' })

    const { triggerTask } = await import('@/lib/scheduler')
    const result = await triggerTask('openclaw_backup')

    expect(result.ok).toBe(true)
    const [args] = mockRunOpenClaw.mock.calls[0]
    expect(args).not.toContain('--no-include-workspace')
    expect(args.join(' ')).toContain('weekly')
  })

  it('returns ok: false on non-zero exit code', async () => {
    mockPrepare.mockReturnValue({ get: vi.fn(() => undefined) })
    mockRunOpenClaw.mockResolvedValue({ code: 1, stdout: '', stderr: 'Permission denied' })

    const { triggerTask } = await import('@/lib/scheduler')
    const result = await triggerTask('openclaw_backup')

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/failed|exit/)
  })

  it('prunes old files after successful daily backup', async () => {
    const oldFile = '2026-01-01T00-00.tar.gz'
    const oldMtime = Date.now() - 20 * 24 * 60 * 60 * 1000 // 20 days ago (> 14d threshold)
    mockReaddirSync.mockReturnValue([oldFile])
    mockStatSync.mockReturnValue({ mtimeMs: oldMtime })
    mockPrepare.mockReturnValue({ get: vi.fn(() => undefined) }) // defaults to daily
    mockRunOpenClaw.mockResolvedValue({ code: 0, stdout: 'Backup archive: /tmp/daily/new.tar.gz', stderr: '' })

    const { triggerTask } = await import('@/lib/scheduler')
    await triggerTask('openclaw_backup')

    expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining(oldFile))
  })

  it('returns ok: false and does not throw on openclaw error', async () => {
    mockPrepare.mockReturnValue({ get: vi.fn(() => undefined) })
    mockRunOpenClaw.mockRejectedValue(new Error('spawn ENOENT'))

    const { triggerTask } = await import('@/lib/scheduler')
    const result = await triggerTask('openclaw_backup')

    expect(result.ok).toBe(false)
    expect(result.message).toContain('spawn ENOENT')
  })
})
