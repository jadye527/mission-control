import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { collectOwnerCockpitData } from '@/lib/owner-cockpit'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = await collectOwnerCockpitData()
    return NextResponse.json(data)
  } catch (error) {
    logger.error({ err: error }, 'GET /api/owner-cockpit error')
    return NextResponse.json({ error: 'Failed to load owner cockpit metrics' }, { status: 500 })
  }
}
