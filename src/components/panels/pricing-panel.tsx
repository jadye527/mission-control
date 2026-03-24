'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PricingTier {
  name: string
  tierKey: 'starter' | 'pro' | 'scale'
  price: number
  description: string
  limits: {
    agents: number | string
    tasksPerMonth: number | string
    users: number | string
    retention: string
  }
  features: string[]
  highlighted?: boolean
  cta: string
}

interface StripeLinks {
  starter: string | null
  pro: string | null
  scale: string | null
}

const TIERS: PricingTier[] = [
  {
    name: 'Starter',
    tierKey: 'starter',
    price: 49,
    description: 'For solo operators and small teams getting started with AI agents.',
    limits: {
      agents: 3,
      tasksPerMonth: 500,
      users: 2,
      retention: '7 days',
    },
    features: [
      'Up to 3 agents',
      '500 tasks/month',
      '2 users',
      '7-day activity log',
      'Community support',
    ],
    cta: 'Get Started',
  },
  {
    name: 'Pro',
    tierKey: 'pro',
    price: 149,
    description: 'For growing teams running active agent workflows.',
    limits: {
      agents: 15,
      tasksPerMonth: 5000,
      users: 10,
      retention: '30 days',
    },
    features: [
      'Up to 15 agents',
      '5,000 tasks/month',
      '10 users',
      '30-day activity log',
      'Multi-tenant isolation',
      'Email support',
    ],
    highlighted: true,
    cta: 'Start Free Trial',
  },
  {
    name: 'Scale',
    tierKey: 'scale',
    price: 499,
    description: 'For enterprises with high-volume agent operations.',
    limits: {
      agents: 'Unlimited',
      tasksPerMonth: 'Unlimited',
      users: 'Unlimited',
      retention: '90 days',
    },
    features: [
      'Unlimited agents',
      'Unlimited tasks',
      'Unlimited users',
      '90-day activity log',
      'Multi-tenant isolation',
      'Priority support',
      'Custom integrations',
      'SLA guarantee',
    ],
    cta: 'Contact Sales',
  },
]

export function PricingPanel() {
  const [stripeLinks, setStripeLinks] = useState<StripeLinks>({ starter: null, pro: null, scale: null })

  useEffect(() => {
    fetch('/api/stripe-links')
      .then((r) => r.json())
      .then((data) => setStripeLinks(data))
      .catch(() => {})
  }, [])

  function getTierHref(tier: PricingTier): string {
    return stripeLinks[tier.tierKey] || '/signup'
  }

  return (
    <div className="flex flex-col gap-6 p-4 max-w-5xl mx-auto w-full">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">Pricing</h1>
        <p className="text-sm text-muted-foreground">
          Simple, transparent pricing for every team size.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className={cn(
              'flex flex-col rounded-xl border bg-card p-5 gap-4',
              tier.highlighted
                ? 'border-primary shadow-md ring-1 ring-primary'
                : 'border-border'
            )}
          >
            {tier.highlighted && (
              <div className="text-xs font-medium text-primary uppercase tracking-wide">
                Most Popular
              </div>
            )}

            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">{tier.name}</h2>
              <p className="text-xs text-muted-foreground">{tier.description}</p>
            </div>

            <div className="flex items-end gap-1">
              <span className="text-3xl font-bold text-foreground">${tier.price}</span>
              <span className="text-sm text-muted-foreground mb-1">/mo</span>
            </div>

            <div className="space-y-1 text-xs border border-border rounded-lg p-3 bg-muted/30">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agents</span>
                <span className="font-medium text-foreground">{tier.limits.agents}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tasks/mo</span>
                <span className="font-medium text-foreground">{tier.limits.tasksPerMonth.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Users</span>
                <span className="font-medium text-foreground">{tier.limits.users}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Log retention</span>
                <span className="font-medium text-foreground">{tier.limits.retention}</span>
              </div>
            </div>

            <ul className="space-y-1.5 flex-1">
              {tier.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="text-green-500 shrink-0">✓</span>
                  {feature}
                </li>
              ))}
            </ul>

            <a href={getTierHref(tier)} target={stripeLinks[tier.tierKey] ? '_blank' : undefined} rel="noreferrer">
              <Button
                variant={tier.highlighted ? 'default' : 'outline'}
                size="sm"
                className="w-full mt-auto"
              >
                {tier.cta}
              </Button>
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}
