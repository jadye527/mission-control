import { NextResponse } from 'next/server'
import { clearSessionCookie, logoutCurrentSession } from '@/lib/auth-v1'
import { logAuditEvent } from '@/lib/db'

export async function POST(request: Request) {
  const { user } = logoutCurrentSession(request)
  if (user) {
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({ action: 'logout', actor: user.username, actor_id: user.id, ip_address: ipAddress })
  }

  const response = NextResponse.json({ ok: true })
  clearSessionCookie(response, request)
  return response
}
