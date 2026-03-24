import Link from 'next/link'

// Static landing page — no client JS required for core sections
export const metadata = {
  title: 'Mission Control — AI Agent Operations Platform',
  description: 'Run, monitor, and scale your AI agents. Multi-tenant. Real-time. Production-ready.',
}

const FEATURES = [
  {
    icon: '⚡',
    title: 'Real-time agent monitoring',
    description: 'Live heartbeat feeds, task boards, and error logs across all your agents in one view.',
  },
  {
    icon: '🔒',
    title: 'Multi-tenant isolation',
    description: 'Every org gets a fully isolated workspace. Data never crosses tenant boundaries.',
  },
  {
    icon: '📊',
    title: 'Cost & usage tracking',
    description: 'Per-agent token usage, daily API cost, and trend data so you stay on budget.',
  },
  {
    icon: '🤖',
    title: 'Built for Claude agents',
    description: 'Native integration with the OpenClaw agent framework and Anthropic API.',
  },
  {
    icon: '📡',
    title: 'Cron & task scheduling',
    description: 'Schedule agent tasks, manage pipelines, and set approval gates — all from the UI.',
  },
  {
    icon: '🛡️',
    title: 'Audit trail',
    description: 'Every action logged. Full audit history for compliance and debugging.',
  },
]

const TIERS = [
  {
    name: 'Starter',
    price: '$49',
    period: '/mo',
    description: 'Solo operators and small teams.',
    limits: ['3 agents', '500 tasks/mo', '2 users'],
    cta: 'Get started',
    href: '/signup',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$149',
    period: '/mo',
    description: 'Growing teams with active workflows.',
    limits: ['15 agents', '5,000 tasks/mo', '10 users'],
    cta: 'Start free trial',
    href: '/signup',
    highlight: true,
  },
  {
    name: 'Scale',
    price: '$499',
    period: '/mo',
    description: 'Enterprise-grade agent operations.',
    limits: ['Unlimited agents', 'Unlimited tasks', 'Unlimited users'],
    cta: 'Contact sales',
    href: 'mailto:hello@openclaw.ai',
    highlight: false,
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border max-w-6xl mx-auto">
        <span className="font-bold text-lg tracking-tight">Mission Control</span>
        <div className="flex items-center gap-4">
          <Link href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</Link>
          <Link href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Sign in</Link>
          <Link
            href="/signup"
            className="text-sm font-medium px-4 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-4">
          Built on OpenClaw
        </p>
        <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
          AI Agent Operations,<br className="hidden md:block" /> Production-Ready
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Mission Control gives your team a single place to deploy, monitor, and scale Claude-powered agents —
          with real-time dashboards, multi-tenant isolation, and full audit trails.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/signup"
            className="px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
          >
            Start free trial
          </Link>
          <Link
            href="/login"
            className="px-6 py-3 rounded-lg border border-border text-foreground font-medium hover:bg-muted/50 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-2xl md:text-3xl font-semibold text-center mb-12">
          Everything you need to run agents in production
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-6 space-y-2">
              <div className="text-2xl">{f.icon}</div>
              <h3 className="font-semibold text-foreground">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-2xl md:text-3xl font-semibold text-center mb-4">Simple pricing</h2>
        <p className="text-center text-muted-foreground mb-12">Start free. Scale when you&apos;re ready.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`flex flex-col rounded-xl border bg-card p-6 gap-4 ${
                tier.highlight ? 'border-primary ring-1 ring-primary shadow-lg' : 'border-border'
              }`}
            >
              {tier.highlight && (
                <span className="text-xs font-medium uppercase tracking-wide text-primary">Most popular</span>
              )}
              <div>
                <h3 className="text-lg font-semibold">{tier.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">{tier.description}</p>
              </div>
              <div className="flex items-end gap-1">
                <span className="text-3xl font-bold">{tier.price}</span>
                <span className="text-sm text-muted-foreground mb-1">{tier.period}</span>
              </div>
              <ul className="space-y-1.5 flex-1">
                {tier.limits.map((limit) => (
                  <li key={limit} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="text-green-500">✓</span> {limit}
                  </li>
                ))}
              </ul>
              <Link
                href={tier.href}
                className={`text-center text-sm font-medium px-4 py-2 rounded-md transition-opacity ${
                  tier.highlight
                    ? 'bg-primary text-primary-foreground hover:opacity-90'
                    : 'border border-border hover:bg-muted/50'
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <div className="rounded-2xl border border-border bg-card p-12">
          <h2 className="text-2xl md:text-3xl font-semibold mb-4">Ready to run agents in production?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Set up your first workspace in minutes. No infrastructure required.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
          >
            Get started free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6 text-center text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} Mission Control · Built on <a href="https://openclaw.ai" className="hover:text-foreground transition-colors">OpenClaw</a></p>
      </footer>

    </div>
  )
}
