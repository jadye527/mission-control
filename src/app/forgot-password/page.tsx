'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error || 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }
      setSubmitted(true)
    } catch {
      setError('Network error. Please check your connection.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/landing" className="text-xl font-bold text-foreground hover:opacity-80 transition-opacity">
            Mission Control
          </Link>
        </div>

        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          {submitted ? (
            <div className="text-center space-y-3">
              <div className="text-3xl">📬</div>
              <h1 className="text-lg font-semibold">Check your email</h1>
              <p className="text-sm text-muted-foreground">
                If an account exists for <strong>{email}</strong>, we sent a reset link.
                It expires in 1 hour.
              </p>
              <Link href="/login" className="text-sm text-primary hover:underline">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-semibold mb-1">Forgot your password?</h1>
              <p className="text-sm text-muted-foreground mb-6">
                Enter your email and we&apos;ll send a reset link.
              </p>

              {error && (
                <div role="alert" className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-foreground">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@yourcompany.com"
                    className="w-full h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    autoComplete="email"
                    required
                  />
                </label>
                <Button type="submit" size="lg" className="w-full" disabled={!email.trim() || loading}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </Button>
              </form>

              <p className="mt-5 text-center text-xs text-muted-foreground">
                Remember your password?{' '}
                <Link href="/login" className="text-primary hover:underline">Sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
