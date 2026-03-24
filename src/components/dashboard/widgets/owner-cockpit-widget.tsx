'use client'

import { useCallback, useState } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import type { DashboardData } from '../widget-primitives'

type OwnerCockpitTrend = 'up' | 'down' | 'flat'
type OwnerCockpitStatus = 'good' | 'warn' | 'bad'

type OwnerCockpitMetric = {
  id: string
  label: string
  value: string
  detail: string
  trend: OwnerCockpitTrend
  trendLabel: string
  status: OwnerCockpitStatus
  source: string
}

type OwnerCockpitDataResponse = {
  generatedAt: number
  metrics: OwnerCockpitMetric[]
}

function TrendIcon({ trend }: { trend: OwnerCockpitTrend }) {
  if (trend === 'up') {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
        <path d="M4 10 8 6l4 4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  if (trend === 'down') {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
        <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
      <path d="M4 8h8" strokeLinecap="round" />
    </svg>
  )
}

function MetricTile({ metric }: { metric: OwnerCockpitMetric }) {
  const toneClass = metric.status === 'good'
    ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-200'
    : metric.status === 'warn'
      ? 'border-amber-500/25 bg-amber-500/8 text-amber-200'
      : 'border-rose-500/25 bg-rose-500/8 text-rose-200'

  const pillClass = metric.status === 'good'
    ? 'bg-emerald-500/15 text-emerald-300'
    : metric.status === 'warn'
      ? 'bg-amber-500/15 text-amber-300'
      : 'bg-rose-500/15 text-rose-300'

  return (
    <article className={`rounded-xl border p-3.5 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.16em] text-current/65">{metric.label}</div>
          <div className="mt-2 break-words font-mono-tight text-xl font-semibold leading-tight text-foreground">
            {metric.value}
          </div>
          <div className="mt-1 text-xs text-current/70">{metric.detail}</div>
        </div>
        <div className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${pillClass}`}>
          <TrendIcon trend={metric.trend} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-current/70">
        <span className="truncate">{metric.trendLabel}</span>
        <span className="truncate text-right text-current/55">{metric.source}</span>
      </div>
    </article>
  )
}

export function OwnerCockpitWidget(_props: { data: DashboardData }) {
  const [cockpit, setCockpit] = useState<OwnerCockpitDataResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const loadCockpit = useCallback(async () => {
    const response = await fetch('/api/owner-cockpit', { cache: 'no-store' })
    if (!response.ok) throw new Error('Failed to load owner cockpit metrics')
    const payload = await response.json() as OwnerCockpitDataResponse
    setCockpit(payload)
    setLoading(false)
  }, [])

  useSmartPoll(loadCockpit, 60000)

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h3 className="text-sm font-semibold">Owner Cockpit</h3>
          <p className="mt-1 text-2xs text-muted-foreground">Cost, trading, signal freshness, and heartbeat error pressure.</p>
        </div>
        {cockpit?.generatedAt && (
          <span className="text-2xs text-muted-foreground">
            {new Date(cockpit.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
      </div>
      <div className="panel-body">
        {loading && !cockpit ? (
          <div className="rounded-xl border border-border/60 bg-secondary/20 p-4 text-sm text-muted-foreground">
            Loading owner metrics...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 min-[375px]:grid-cols-2">
            {(cockpit?.metrics || []).map((metric) => (
              <MetricTile key={metric.id} metric={metric} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
