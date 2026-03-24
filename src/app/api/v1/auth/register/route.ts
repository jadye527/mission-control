import { NextResponse } from 'next/server'
import { applySessionCookie, buildAuthPayload, issueSessionForUser, registerUserWithTenant } from '@/lib/auth-v1'
import { logger } from '@/lib/logger'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const username = String(body?.username || '').trim()
    const password = String(body?.password || '')
    const displayName = String(body?.display_name || body?.displayName || username).trim()
    const email = body?.email ? String(body.email).trim().toLowerCase() : null

    if (!username || !password || !displayName) {
      return NextResponse.json({ error: 'username, password, and display_name are required' }, { status: 400 })
    }

    const user = registerUserWithTenant({
      username,
      password,
      displayName,
      email,
      inviteToken: body?.invite_token ? String(body.invite_token) : null,
      tenantName: body?.tenant_name ? String(body.tenant_name) : null,
      tenantSlug: body?.tenant_slug ? String(body.tenant_slug) : null,
      workspaceName: body?.workspace_name ? String(body.workspace_name) : null,
    })

    const { token, expiresAt } = issueSessionForUser(user, request)
    const response = NextResponse.json(buildAuthPayload(user), { status: 201 })
    applySessionCookie(response, request, token, expiresAt)
    return response
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/v1/auth/register error')
    const message = error?.message?.includes('UNIQUE constraint failed')
      ? 'Username or email already exists'
      : error?.message || 'Failed to register account'
    const status = /exists|invalid|expired|required|match/i.test(message) ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
