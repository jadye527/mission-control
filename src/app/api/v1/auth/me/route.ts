import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, requireRole, updateUser } from '@/lib/auth'
import { buildAuthPayload, switchCurrentWorkspace } from '@/lib/auth-v1'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { verifyPassword } from '@/lib/password'

export async function GET(request: Request) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  return NextResponse.json(buildAuthPayload(auth.user))
}

export async function PATCH(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  if (body?.workspace_id != null) {
    const workspaceId = Number(body.workspace_id)
    if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
      return NextResponse.json({ error: 'workspace_id must be a positive integer' }, { status: 400 })
    }
    const updated = switchCurrentWorkspace(request, workspaceId)
    if (!updated) return NextResponse.json({ error: 'Workspace not accessible for user' }, { status: 403 })
    return NextResponse.json(buildAuthPayload(updated))
  }

  const updates: { display_name?: string; password?: string; tenant_id?: number } = { tenant_id: auth.user.tenant_id }
  if (typeof body?.display_name === 'string' && body.display_name.trim()) {
    updates.display_name = body.display_name.trim()
  }
  if (body?.new_password) {
    if (!body?.current_password) {
      return NextResponse.json({ error: 'current_password is required' }, { status: 400 })
    }
    const db = getDatabase()
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(auth.user.id) as { password_hash?: string } | undefined
    if (!row?.password_hash || !verifyPassword(String(body.current_password), row.password_hash)) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 })
    }
    updates.password = String(body.new_password)
  }

  if (!updates.display_name && !updates.password) {
    return NextResponse.json({ error: 'No supported fields provided' }, { status: 400 })
  }

  const updated = updateUser(auth.user.id, updates)
  if (!updated) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  logAuditEvent({
    action: 'user_profile_updated',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { display_name: updates.display_name ? true : false, password: updates.password ? true : false },
    ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
  })

  return NextResponse.json(buildAuthPayload(updated))
}
