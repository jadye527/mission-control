'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

interface FormState {
  email: string
  password: string
  org_name: string
}

export default function SignupPage() {
  const [form, setForm] = useState<FormState>({ email: '', password: '', org_name: '' })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const canSubmit = form.email.trim() && form.password.length >= 12 && form.org_name.trim()

  function update(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          org_name: form.org_name.trim(),
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data?.error || 'Signup failed. Please try again.')
        setLoading(false)
        return
      }

      // Session cookie set by server — redirect to dashboard
      window.location.href = '/'
    } catch {
      setError('Network error. Please check your connection.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">

        {/* Logo / brand */}
        <div className="text-center mb-8">
          <Link href="/landing" className="text-xl font-bold text-foreground hover:opacity-80 transition-opacity">
            Mission Control
          </Link>
          <p className="text-sm text-muted-foreground mt-1">Start your free trial — no credit card required</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-foreground mb-1">Create your account</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Your org workspace will be ready in seconds.
          </p>

          {error && (
            <div role="alert" className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-foreground">Work email</span>
              <input
                type="email"
                value={form.email}
                onChange={update('email')}
                placeholder="you@yourcompany.com"
                className="w-full h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                autoComplete="email"
                required
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-foreground">Password</span>
              <input
                type="password"
                value={form.password}
                onChange={update('password')}
                placeholder="At least 12 characters"
                className="w-full h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                autoComplete="new-password"
                minLength={12}
                required
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-foreground">Organization name</span>
              <input
                type="text"
                value={form.org_name}
                onChange={update('org_name')}
                placeholder="Acme Inc."
                className="w-full h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                autoComplete="organization"
                required
              />
            </label>

            <Button
              type="submit"
              size="lg"
              className="w-full mt-2"
              disabled={!canSubmit || loading}
            >
              {loading ? 'Creating your workspace…' : 'Create account'}
            </Button>
          </form>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          By creating an account you agree to our{' '}
          <Link href="/landing#terms" className="hover:text-foreground transition-colors">Terms</Link>
          {' '}and{' '}
          <Link href="/landing#privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>.
        </p>

      </div>
    </div>
  )
}
