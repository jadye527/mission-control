import { NextResponse } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { getDatabase } from '@/lib/db'
import { sendPasswordResetEmail } from '@/lib/email'
import { loginLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const TOKEN_TTL = 60 * 60 // 1 hour in seconds

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Always returns 200 to prevent email enumeration.
 */
export async function POST(request: Request) {
  try {
    const rateCheck = loginLimiter(request)
    if (rateCheck) return rateCheck

    const body = await request.json().catch(() => ({}))
    const email = String(body?.email || '').trim().toLowerCase()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const db = getDatabase()
    const user = db
      .prepare('SELECT id, email FROM users WHERE email = ? LIMIT 1')
      .get(email) as { id: number; email: string } | undefined

    // Always 200 — don't reveal whether email exists
    if (!user) {
      return NextResponse.json({ ok: true })
    }

    // Invalidate existing tokens for this user
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id)

    // Generate token
    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL

    db.prepare(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
    ).run(user.id, tokenHash, expiresAt)

    const result = await sendPasswordResetEmail(user.email, rawToken)
    if (!result.ok) {
      logger.error({ err: result.error, userId: user.id }, 'Failed to send password reset email')
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/auth/forgot-password error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
