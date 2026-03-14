'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('ActiveRunsPanel')

interface RunEntry {
  name: string
  type: 'tmux' | 'cron' | 'collector'
  owner: string | null
  status: 'active' | 'stale' | 'stopped'
  lastProgressTs: number | null
  lastOutput: string
}

interface RunsData {
  runs: RunEntry[]
  counts: {
    active: number
    stale: number
    stopped: number
    total: number
  }
}

type FilterType = 'all' | 'tmux' | 'cron' | 'collector'
type FilterStatus = 'all' | 'active' | 'stale' | 'stopped'

export default function ActiveRunsPanel() {
  const [data, setData] = useState<RunsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/active-runs')
      if (!res.ok) throw new Error('Failed to fetch active runs')
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (err) {
      log.error('Failed to fetch active runs', err)
      setError('Failed to load active runs')
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchRuns().finally(() => setLoading(false))
    const interval = setInterval(fetchRuns, 30000)
    return () => clearInterval(interval)
  }, [fetchRuns])

  const filteredRuns = data?.runs.filter((r) => {
    if (filterType !== 'all' && r.type !== filterType) return false
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    return true
  }) || []

  const statusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-400'
      case 'stale': return 'text-yellow-400'
      case 'stopped': return 'text-red-400'
      default: return 'text-muted-foreground'
    }
  }

  const statusDot = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-400'
      case 'stale': return 'bg-yellow-400'
      case 'stopped': return 'bg-red-400'
      default: return 'bg-gray-400'
    }
  }

  const typeLabel = (type: string) => {
    switch (type) {
      case 'tmux': return 'TMux'
      case 'cron': return 'Cron'
      case 'collector': return 'Collector'
      default: return type
    }
  }

  const formatAge = (ts: number | null) => {
    if (!ts) return 'unknown'
    const ageS = Math.floor((Date.now() - ts) / 1000)
    if (ageS < 60) return `${ageS}s ago`
    if (ageS < 3600) return `${Math.floor(ageS / 60)}m ago`
    if (ageS < 86400) return `${Math.floor(ageS / 3600)}h ago`
    return `${Math.floor(ageS / 86400)}d ago`
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Active Runs</h2>
        <div className="flex items-center gap-3">
          {data && (
            <div className="flex gap-2 text-xs">
              <span className="text-green-400">{data.counts.active} active</span>
              {data.counts.stale > 0 && (
                <span className="text-yellow-400">{data.counts.stale} stale</span>
              )}
              {data.counts.stopped > 0 && (
                <span className="text-red-400">{data.counts.stopped} stopped</span>
              )}
            </div>
          )}
          <button
            onClick={() => fetchRuns()}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 border border-border rounded"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Type:</span>
          {(['all', 'tmux', 'cron', 'collector'] as FilterType[]).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                filterType === t
                  ? 'border-blue-500 bg-blue-500/20 text-blue-400'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'all' ? 'All' : typeLabel(t)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Status:</span>
          {(['all', 'active', 'stale', 'stopped'] as FilterStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                filterStatus === s
                  ? 'border-blue-500 bg-blue-500/20 text-blue-400'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : error ? (
        <div className="text-sm text-red-400">{error}</div>
      ) : filteredRuns.length === 0 ? (
        <div className="border border-border border-dashed rounded-lg p-8 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            {data?.runs.length === 0 ? 'No active runs detected.' : 'No runs match the current filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRuns.map((run) => (
            <div
              key={run.name}
              className="border border-border rounded-lg bg-card overflow-hidden"
            >
              <button
                onClick={() => setExpandedRun(expandedRun === run.name ? null : run.name)}
                className="w-full text-left p-3 flex items-center gap-3 hover:bg-surface-1/30 transition-colors"
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(run.status)}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{run.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-surface-1/60 text-muted-foreground rounded flex-shrink-0">
                      {typeLabel(run.type)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex gap-3">
                    <span className={statusColor(run.status)}>{run.status}</span>
                    {run.owner && <span>owner: {run.owner}</span>}
                    <span>last activity: {formatAge(run.lastProgressTs)}</span>
                  </div>
                </div>
                <span className="text-muted-foreground text-xs flex-shrink-0">
                  {expandedRun === run.name ? '\u25b2' : '\u25bc'}
                </span>
              </button>

              {expandedRun === run.name && run.lastOutput && (
                <div className="border-t border-border px-3 py-2">
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">Last Output</p>
                  <pre className="text-xs text-foreground/80 bg-surface-1/40 rounded px-2 py-1.5 font-mono overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
                    {run.lastOutput}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
