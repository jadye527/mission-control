'use client'

import { FormEvent, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function ResetPasswordPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const mismatch = confirm.length > 0 && password !== confirm
  const canSubmit = token && password.length >= 12 && password === confirm

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Reset failed. The link may have expired.')
        setLoading(false)
        return
      }
      setDone(true)
      // Redirect to dashboard — session cookie was set by server
      setTimeout(() => { window.location.href = '/' }, 1500)
    } catch {
      setError('Network error. Please check your connection.')
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-3">
          <p className="text-sm text-destructive font-medium">Invalid reset link.</p>
          <Link href="/forgot-password" className="text-sm text-primary hover:underline">
            Request a new one
          </Link>
        </div>
      </div>
    )
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
          {done ? (
            <div className="text-center space-y-3">
              <div className="text-3xl">✅</div>
              <h1 className="text-lg font-semibold">Password updated</h1>
              <p className="text-sm text-muted-foreground">Redirecting you to the dashboard…</p>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-semibold mb-1">Choose a new password</h1>
              <p className="text-sm text-muted-foreground mb-6">Must be at least 12 characters.</p>

              {error && (
                <div role="alert" className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-foreground">New password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 12 characters"
                    className="w-full h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    autoComplete="new-password"
                    minLength={12}
                    required
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-foreground">Confirm password</span>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat password"
                    className={`w-full h-10 rounded-lg border px-3 text-sm text-foreground placeholder:text-muted-foreground bg-secondary focus:outline-none focus:ring-2 focus:ring-ring ${mismatch ? 'border-destructive' : 'border-border'}`}
                    autoComplete="new-password"
                    required
                  />
                  {mismatch && <span className="text-xs text-destructive mt-1 block">Passwords don&apos;t match</span>}
                </label>
                <Button type="submit" size="lg" className="w-full" disabled={!canSubmit || loading}>
                  {loading ? 'Updating…' : 'Update password'}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
