'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useNavigateToPanel } from '@/lib/navigation'

interface PlanWarning {
  metric: string
  used: number
  limit: number
  pct: number
}

interface PlanLimitData {
  tier: string
  softWarning: boolean
  hardBlock: boolean
  warnings: PlanWarning[]
}

const METRIC_LABELS: Record<string, string> = {
  agents: 'agents',
  tasksThisMonth: 'tasks this month',
  users: 'users',
}

export function PlanLimitBanner() {
  const [data, setData] = useState<PlanLimitData | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const navigateToPanel = useNavigateToPanel()

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const res = await fetch('/api/plan-limits')
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch {
        // non-fatal — banner simply won't show
      }
    }

    check()
    const interval = setInterval(check, 5 * 60 * 1000) // re-check every 5 min
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  if (!data || (!data.softWarning && !data.hardBlock) || dismissed) return null

  const topWarning = [...data.warnings].sort((a, b) => b.pct - a.pct)[0]
  if (!topWarning) return null

  const pct = Math.round(topWarning.pct * 100)
  const label = METRIC_LABELS[topWarning.metric] ?? topWarning.metric
  const isOver = topWarning.pct >= 1
  const color = isOver ? 'void-crimson' : 'void-amber'

  return (
    <div className={`mx-4 mt-3 mb-0 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-${color}/5 border border-${color}/20 text-sm`}>
      <span className={`w-1.5 h-1.5 rounded-full bg-${color} shrink-0`} />
      <p className="flex-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {isOver ? 'Plan limit reached: ' : 'Approaching plan limit: '}
        </span>
        {pct}% of {data.tier} {label} limit used ({topWarning.used}/{topWarning.limit}).
        {isOver ? ' Upgrade to avoid disruption.' : ' Consider upgrading soon.'}
      </p>
      <Button
        variant="outline"
        size="xs"
        onClick={() => navigateToPanel('pricing')}
        className="shrink-0 text-2xs font-medium"
      >
        Upgrade
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => setDismissed(true)}
        className="shrink-0 text-muted-foreground hover:text-foreground hover:bg-transparent"
        title="Dismiss"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </Button>
    </div>
  )
}
