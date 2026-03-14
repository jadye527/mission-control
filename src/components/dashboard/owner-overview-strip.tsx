'use client'

import { useState, useEffect, useCallback } from 'react'
import { useNavigateToPanel } from '@/lib/navigation'

interface OwnerOverview {
  priorities: string[]
  blockedTasks: Array<{ id: number; title: string; assigned_to: string | null; updated_at: number }>
  qcQueue: Array<{ id: number; title: string; assigned_to: string | null; updated_at: number }>
  activeRuns: Array<{ name: string; status: string; lastOutput: string }>
  staleRuns: Array<{ name: string; status: string; lastOutput: string }>
  agentUpdates: Array<{ agent: string; status: string; lastActivity: string; currentTask: string | null }>
  counts: {
    blocked: number
    qcWaiting: number
    activeRuns: number
    staleRuns: number
    inProgress: number
  }
}

interface RunEntry {
  name: string
  type: 'tmux' | 'cron' | 'collector'
  owner: string | null
  status: 'active' | 'stale' | 'stopped'
  lastProgressTs: number | null
  lastOutput: string
}

interface ActiveRunsData {
  runs: RunEntry[]
  counts: { active: number; stale: number; stopped: number; total: number }
}

// SVG icons (16x16, stroke-based, matching codebase style)
function TargetIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="3" />
      <circle cx="8" cy="8" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function BlockedIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="8" cy="8" r="6" />
      <path d="M4 4l8 8" />
    </svg>
  )
}

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M8 1.5L2 4v4c0 3.5 2.5 5.5 6 7 3.5-1.5 6-3.5 6-7V4L8 1.5z" />
      <path d="M5.5 8l2 2 3-3.5" />
    </svg>
  )
}

function TerminalIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="1" y="2" width="14" height="12" rx="1.5" />
      <path d="M4 6l3 2-3 2M9 10h3" />
    </svg>
  )
}

function AgentIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14c0-3 2.5-5 6-5s6 2 6 5" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M8 1.5L1 14h14L8 1.5z" />
      <path d="M8 6v4M8 12h.01" />
    </svg>
  )
}

interface CountBadgeProps {
  count: number
  label: string
  icon: React.ReactNode
  color: 'default' | 'success' | 'warning' | 'danger'
  onClick?: () => void
}

function CountBadge({ count, label, icon, color, onClick }: CountBadgeProps) {
  const colorMap = {
    default: 'border-border text-void-cyan',
    success: 'border-void-mint/30 text-void-mint',
    warning: 'border-void-amber/30 text-void-amber',
    danger: 'border-void-crimson/30 text-void-crimson',
  }

  const bgMap = {
    default: '',
    success: 'bg-void-mint/5',
    warning: 'bg-void-amber/5',
    danger: 'bg-void-crimson/5',
  }

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${colorMap[color]} ${bgMap[color]} hover:opacity-80 transition-opacity cursor-pointer`}
    >
      <span className="opacity-60">{icon}</span>
      <span className="text-lg font-bold font-mono">{count}</span>
      <span className="text-xs text-muted-foreground hidden sm:inline">{label}</span>
    </button>
  )
}

export function OwnerOverviewStrip() {
  const [data, setData] = useState<OwnerOverview | null>(null)
  const [runsData, setRunsData] = useState<ActiveRunsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const navigateToPanel = useNavigateToPanel()

  const loadData = useCallback(async () => {
    try {
      const [overviewRes, runsRes] = await Promise.all([
        fetch('/api/owner-overview'),
        fetch('/api/active-runs'),
      ])
      if (overviewRes.ok) {
        const json = await overviewRes.json()
        if (json && !json.error) setData(json)
      }
      if (runsRes.ok) {
        const json = await runsRes.json()
        if (json && !json.error) setRunsData(json)
      }
    } catch {
      // Silently fail — strip is supplementary
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 60_000) // refresh every 60s
    return () => clearInterval(interval)
  }, [loadData])

  if (loading) {
    return (
      <div className="void-panel p-4 mx-4 mt-4 animate-pulse">
        <div className="h-10 bg-muted/20 rounded" />
      </div>
    )
  }

  if (!data) return null

  const activeRunCount = runsData?.counts.active ?? data.counts.activeRuns
  const staleRunCount = runsData?.counts.stale ?? data.counts.staleRuns
  const hasIssues = data.counts.blocked > 0 || staleRunCount > 0

  return (
    <div className="mx-4 mt-4 space-y-3">
      {/* Summary strip */}
      <div className={`void-panel p-4 ${hasIssues ? 'border-void-amber/30' : ''}`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground tracking-wide uppercase">Owner Overview</h2>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>

        {/* Count badges row */}
        <div className="flex flex-wrap gap-3">
          <CountBadge
            count={data.counts.inProgress}
            label="In Progress"
            icon={<TargetIcon />}
            color="success"
            onClick={() => navigateToPanel('tasks')}
          />
          <CountBadge
            count={data.counts.blocked}
            label="Blocked"
            icon={<BlockedIcon />}
            color={data.counts.blocked > 0 ? 'danger' : 'default'}
            onClick={() => navigateToPanel('tasks')}
          />
          <CountBadge
            count={data.counts.qcWaiting}
            label="QC Queue"
            icon={<ShieldCheckIcon />}
            color={data.counts.qcWaiting > 0 ? 'warning' : 'default'}
            onClick={() => navigateToPanel('tasks')}
          />
          <CountBadge
            count={activeRunCount}
            label="Active Runs"
            icon={<TerminalIcon />}
            color="success"
          />
          <CountBadge
            count={staleRunCount}
            label="Stale Runs"
            icon={<AlertIcon />}
            color={staleRunCount > 0 ? 'danger' : 'default'}
          />
        </div>

        {/* Top priorities (always visible) */}
        {data.priorities.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wider">Top Priorities</p>
            <ul className="space-y-1">
              {data.priorities.slice(0, 3).map((p, i) => (
                <li key={i} className="text-sm text-foreground flex items-start gap-2">
                  <span className="text-void-cyan mt-0.5 shrink-0">{'>'}</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Expanded detail sections */}
      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Blocked tasks */}
          <DetailCard title="Blocked Tasks" color={data.counts.blocked > 0 ? 'danger' : 'default'}>
            {data.blockedTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No blocked tasks</p>
            ) : (
              <ul className="space-y-1.5">
                {data.blockedTasks.map(t => (
                  <li key={t.id} className="text-sm">
                    <span className="text-foreground">{t.title}</span>
                    {t.assigned_to && (
                      <span className="text-xs text-muted-foreground ml-1">({t.assigned_to})</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </DetailCard>

          {/* QC Queue */}
          <DetailCard title="Quality Review Queue" color={data.counts.qcWaiting > 0 ? 'warning' : 'default'}>
            {data.qcQueue.length === 0 ? (
              <p className="text-xs text-muted-foreground">No tasks awaiting review</p>
            ) : (
              <ul className="space-y-1.5">
                {data.qcQueue.map(t => (
                  <li key={t.id} className="text-sm">
                    <span className="text-foreground">{t.title}</span>
                    {t.assigned_to && (
                      <span className="text-xs text-muted-foreground ml-1">({t.assigned_to})</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </DetailCard>

          {/* Agent updates */}
          <DetailCard title="Agent Status" color="default">
            {data.agentUpdates.length === 0 ? (
              <p className="text-xs text-muted-foreground">No agents registered</p>
            ) : (
              <ul className="space-y-2">
                {data.agentUpdates.map(a => (
                  <li key={a.agent} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        a.status === 'busy' ? 'bg-void-mint' :
                        a.status === 'idle' ? 'bg-void-amber' :
                        a.status === 'error' ? 'bg-void-crimson' :
                        'bg-muted-foreground'
                      }`} />
                      <span className="font-medium text-foreground">{a.agent}</span>
                      <span className="text-xs text-muted-foreground">{a.status}</span>
                    </div>
                    {a.currentTask && (
                      <p className="text-xs text-muted-foreground ml-4 mt-0.5">
                        Working on: {a.currentTask}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </DetailCard>

          {/* Active runs — uses /api/active-runs for richer data */}
          {runsData && runsData.runs.length > 0 && (
            <DetailCard title="Machine Runs" color={staleRunCount > 0 ? 'warning' : 'success'}>
              <ul className="space-y-2">
                {runsData.runs
                  .sort((a, b) => (a.status === 'stale' ? -1 : 1) - (b.status === 'stale' ? -1 : 1))
                  .map(r => (
                  <li key={r.name} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        r.status === 'stale' ? 'bg-void-crimson' :
                        r.status === 'active' ? 'bg-void-mint' :
                        'bg-muted-foreground'
                      }`} />
                      <span className="font-medium text-foreground">{r.name}</span>
                      <span className={`text-xs ${
                        r.status === 'stale' ? 'text-void-crimson' :
                        r.status === 'active' ? 'text-void-mint' :
                        'text-muted-foreground'
                      }`}>{r.status}</span>
                      <span className="text-[10px] text-muted-foreground">{r.type}</span>
                      {r.owner && (
                        <span className="text-[10px] text-muted-foreground">({r.owner})</span>
                      )}
                    </div>
                    {r.lastOutput && (
                      <pre className="text-[10px] text-muted-foreground ml-4 mt-0.5 font-mono truncate max-w-full">
                        {r.lastOutput.slice(0, 150)}
                      </pre>
                    )}
                    {r.lastProgressTs && (
                      <p className="text-[10px] text-muted-foreground ml-4">
                        Last activity: {new Date(r.lastProgressTs).toLocaleTimeString()}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </DetailCard>
          )}
        </div>
      )}
    </div>
  )
}

function DetailCard({ title, children, color = 'default' }: {
  title: string
  children: React.ReactNode
  color?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const borderMap = {
    default: '',
    success: 'border-void-mint/20',
    warning: 'border-void-amber/20',
    danger: 'border-void-crimson/20',
  }

  return (
    <div className={`void-panel p-3 ${borderMap[color]}`}>
      <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  )
}
