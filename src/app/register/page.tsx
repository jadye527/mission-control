'use client'

import { FormEvent, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LanguageSwitcherSelect } from '@/components/ui/language-switcher'

export default function RegisterPage() {
  const searchParams = useSearchParams()
  const inviteToken = searchParams.get('invite') || ''
  const invitedMode = Boolean(inviteToken)
  const [form, setForm] = useState({
    username: '',
    display_name: '',
    email: '',
    password: '',
    tenant_name: '',
    workspace_name: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const canSubmit = useMemo(() => {
    if (!form.username || !form.display_name || !form.email || !form.password) return false
    if (!invitedMode && !form.tenant_name) return false
    return true
  }, [form, invitedMode])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          tenant_slug: form.tenant_name,
          invite_token: inviteToken || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Registration failed')
        setLoading(false)
        return
      }
      window.location.href = '/'
    } catch {
      setError('Network error')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcherSelect />
      </div>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">{invitedMode ? 'Join Workspace' : 'Create Workspace'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {invitedMode ? 'Accept your team invite and finish setting up your account.' : 'Create a new tenant, default workspace, and admin account.'}
          </p>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-foreground">Display name</span>
              <input
                value={form.display_name}
                onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
                className="w-full h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground"
                required
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-foreground">Username</span>
              <input
                value={form.username}
                onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                className="w-full h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground"
                required
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-foreground">Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              className="w-full h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground"
              required
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-foreground">Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              className="w-full h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground"
              minLength={12}
              required
            />
          </label>

          {!invitedMode && (
            <>
              <label className="block text-sm">
                <span className="mb-1 block text-foreground">Organization</span>
                <input
                  value={form.tenant_name}
                  onChange={(event) => setForm((current) => ({ ...current, tenant_name: event.target.value }))}
                  className="w-full h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground"
                  placeholder="Acme"
                  required
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-foreground">Default workspace</span>
                <input
                  value={form.workspace_name}
                  onChange={(event) => setForm((current) => ({ ...current, workspace_name: event.target.value }))}
                  className="w-full h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground"
                  placeholder="Operations"
                />
              </label>
            </>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={!canSubmit || loading}>
            {loading ? 'Creating account...' : invitedMode ? 'Join workspace' : 'Create workspace'}
          </Button>
        </form>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          Already have an account?{' '}
          <a href="/login" className="text-primary hover:underline">
            Sign in
          </a>
        </div>
      </div>
    </div>
  )
}
