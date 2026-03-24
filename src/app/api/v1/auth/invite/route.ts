import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createInviteForCurrentUser, revokeCurrentTenantInvite } from '@/lib/auth-v1'
import { listTenantInvites } from '@/lib/auth'

export async function GET(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  return NextResponse.json({
    invites: listTenantInvites(auth.user.tenant_id).map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      tenant_id: invite.tenant_id,
      workspace_id: invite.workspace_id,
      workspace_name: invite.workspace_name,
      workspace_slug: invite.workspace_slug,
      invited_by_username: invite.invited_by_username,
      token_hint: invite.token_hint,
      expires_at: invite.expires_at,
      accepted_at: invite.accepted_at,
      revoked_at: invite.revoked_at,
      created_at: invite.created_at,
    })),
  })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json().catch(() => ({}))
  const email = String(body?.email || '').trim().toLowerCase()
  const role = String(body?.role || 'viewer') as 'admin' | 'operator' | 'viewer'
  if (!email || !['admin', 'operator', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'Valid email and role are required' }, { status: 400 })
  }
  try {
    const created = createInviteForCurrentUser(auth.user, {
      email,
      role,
      workspace_id: body?.workspace_id ? Number(body.workspace_id) : undefined,
      expires_in_days: body?.expires_in_days ? Number(body.expires_in_days) : undefined,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to create invite' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json().catch(() => ({}))
  const inviteId = Number(body?.id)
  if (!Number.isInteger(inviteId) || inviteId <= 0) {
    return NextResponse.json({ error: 'Invite id is required' }, { status: 400 })
  }
  const ok = revokeCurrentTenantInvite(auth.user, inviteId)
  if (!ok) return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
