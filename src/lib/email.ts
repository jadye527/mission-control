/**
 * Email sending via Resend.
 * Set RESEND_API_KEY in environment to enable.
 * Falls back to console.log in dev/no-key mode.
 */

import { Resend } from 'resend'

const FROM_ADDRESS = process.env.MC_EMAIL_FROM || 'Mission Control <noreply@missioncontrol.ai>'
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.MC_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  return new Resend(key)
}

export interface SendResult {
  ok: boolean
  id?: string
  error?: string
}

export async function sendPasswordResetEmail(
  toEmail: string,
  resetToken: string
): Promise<SendResult> {
  const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`
  const subject = 'Reset your Mission Control password'
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <h2 style="font-size:20px;font-weight:600;margin-bottom:8px">Reset your password</h2>
      <p style="color:#6b7280;margin-bottom:24px">
        We received a request to reset the password for your Mission Control account.
        Click the button below to choose a new password. This link expires in 1 hour.
      </p>
      <a href="${resetUrl}"
         style="display:inline-block;padding:12px 24px;background:#000;color:#fff;border-radius:8px;text-decoration:none;font-weight:500">
        Reset password
      </a>
      <p style="margin-top:24px;font-size:12px;color:#9ca3af">
        If you didn't request this, you can safely ignore this email.<br>
        Link: ${resetUrl}
      </p>
    </div>
  `

  const resend = getClient()
  if (!resend) {
    // Dev fallback — log the reset URL
    console.log(`[email dev] Password reset for ${toEmail}: ${resetUrl}`)
    return { ok: true, id: 'dev-log' }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: toEmail,
      subject,
      html,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, id: data?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
