import { NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth'
import { applySessionCookie, buildAuthPayload, issueSessionForUser } from '@/lib/auth-v1'
import { loginLimiter } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const rateCheck = loginLimiter(request)
  if (rateCheck) return rateCheck

  const body = await request.json().catch(() => ({}))
  const identifier = String(body?.username || body?.email || '').trim()
  const password = String(body?.password || '')
  if (!identifier || !password) {
    return NextResponse.json({ error: 'Username/email and password are required' }, { status: 400 })
  }

  const user = authenticateUser(identifier, password)
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const { token, expiresAt } = issueSessionForUser(user, request)
  const response = NextResponse.json(buildAuthPayload(user))
  applySessionCookie(response, request, token, expiresAt)
  return response
}
