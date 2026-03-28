import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getDatabase } from '@/lib/db'
import { hashPassword } from '@/lib/password'
import { createSession } from '@/lib/auth'
import { getMcSessionCookieName, getMcSessionCookieOptions, isRequestSecure } from '@/lib/session-cookie'
import { loginLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

/**
 * POST /api/auth/reset-password
 * Body: { token, password }
 * Validates token, updates password, issues new session.
 */
export async function POST(request: Request) {
  try {
    const rateCheck = loginLimiter(request)
    if (rateCheck) return rateCheck

    const body = await request.json().catch(() => ({}))
    const rawToken = String(body?.token || '').trim()
    const newPassword = String(body?.password || '')

    if (!rawToken || !newPassword) {
      return NextResponse.json({ error: 'token and password are required' }, { status: 400 })
    }

    if (newPassword.length < 12) {
      return NextResponse.json({ error: 'Password must be at least 12 characters' }, { status: 400 })
    }

    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const now = Math.floor(Date.now() / 1000)
    const db = getDatabase()

    const record = db.prepare(`
      SELECT prt.id, prt.user_id, u.workspace_id
      FROM password_reset_tokens prt
      JOIN users u ON u.id = prt.user_id
      WHERE prt.token_hash = ?
        AND prt.expires_at > ?
        AND prt.used_at IS NULL
      LIMIT 1
    `).get(tokenHash, now) as { id: number; user_id: number; workspace_id: number } | undefined

    if (!record) {
      return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 })
    }

    // Update password and mark token used in one transaction
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(hashPassword(newPassword), now, record.user_id)
      db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?')
        .run(now, record.id)
      // Invalidate all sessions for this user for security
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(record.user_id)
    })()

    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown'
    const userAgent = request.headers.get('user-agent') || undefined
    const { token, expiresAt } = createSession(record.user_id, ipAddress, userAgent, record.workspace_id)

    const isSecureRequest = isRequestSecure(request)
    const cookieName = getMcSessionCookieName(isSecureRequest)
    const response = NextResponse.json({ ok: true })
    response.cookies.set(cookieName, token, {
      ...getMcSessionCookieOptions({ maxAgeSeconds: expiresAt - now, isSecureRequest }),
    })

    return response
  } catch (error) {
    logger.error({ err: error }, 'POST /api/auth/reset-password error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
