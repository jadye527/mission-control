import { NextRequest, NextResponse } from 'next/server'
import { listUserApiKeys, requireRole } from '@/lib/auth'
import { createCurrentUserApiKey, revokeCurrentUserApiKey } from '@/lib/auth-v1'

export async function GET(request: Request) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  return NextResponse.json({
    api_keys: listUserApiKeys(auth.user.id, auth.user.tenant_id).map((key) => ({
      id: key.id,
      label: key.label,
      key_prefix: key.key_prefix,
      role: key.role,
      scopes: key.scopes,
      expires_at: key.expires_at,
      last_used_at: key.last_used_at,
      last_used_ip: key.last_used_ip,
      is_revoked: key.is_revoked,
      workspace_id: key.workspace_id,
      tenant_id: key.tenant_id,
      created_at: key.created_at,
    })),
  })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json().catch(() => ({}))
  const label = String(body?.label || '').trim()
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 })
  const created = createCurrentUserApiKey(auth.user, {
    label,
    role: body?.role,
    scopes: Array.isArray(body?.scopes) ? body.scopes.map((value: unknown) => String(value)) : undefined,
    expires_in_days: body?.expires_in_days ? Number(body.expires_in_days) : undefined,
  })
  return NextResponse.json({
    api_key: created.rawKey,
    key: {
      id: created.record.id,
      label: created.record.label,
      key_prefix: created.record.key_prefix,
      role: created.record.role,
      scopes: created.record.scopes,
      expires_at: created.record.expires_at,
      workspace_id: created.record.workspace_id,
      tenant_id: created.record.tenant_id,
      created_at: created.record.created_at,
    },
  }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json().catch(() => ({}))
  const keyId = Number(body?.id)
  if (!Number.isInteger(keyId) || keyId <= 0) {
    return NextResponse.json({ error: 'Key id is required' }, { status: 400 })
  }
  const revoked = revokeCurrentUserApiKey(auth.user, keyId)
  if (!revoked) return NextResponse.json({ error: 'Key not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
