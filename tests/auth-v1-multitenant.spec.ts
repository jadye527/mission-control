import { test, expect } from '@playwright/test'

function readSessionCookie(setCookieHeader: string | string[] | undefined): string {
  const value = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader || ''
  const match = value.match(/(?:__Host-)?mc-session=([^;]+)/)
  return match?.[0] || ''
}

test.describe('V1 multi-tenant auth', () => {
  const suffix = `${Date.now()}`
  const adminUser = `tenant-admin-${suffix}`
  const memberUser = `tenant-member-${suffix}`
  const password = 'tenant-pass-1234!'
  const adminEmail = `${adminUser}@example.com`
  const memberEmail = `${memberUser}@example.com`

  test('registers tenant admin, switches workspace, manages API key, and accepts invite', async ({ request }) => {
    const registerRes = await request.post('/api/v1/auth/register', {
      data: {
        username: adminUser,
        password,
        display_name: 'Tenant Admin',
        email: adminEmail,
        tenant_name: `Tenant ${suffix}`,
        workspace_name: 'Primary',
      },
    })
    expect(registerRes.status()).toBe(201)
    const registerBody = await registerRes.json()
    expect(registerBody.user?.tenant_id).toBeTruthy()
    expect(registerBody.user?.memberships?.length).toBeGreaterThan(0)

    const sessionCookie = readSessionCookie(registerRes.headers()['set-cookie'])
    expect(sessionCookie).toContain('mc-session=')

    const createWorkspaceRes = await request.post('/api/workspaces', {
      headers: {
        cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      data: { name: 'Ops', slug: `ops-${suffix}` },
    })
    expect(createWorkspaceRes.status()).toBe(201)
    const workspaceBody = await createWorkspaceRes.json()

    const switchRes = await request.patch('/api/v1/auth/me', {
      headers: {
        cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      data: { workspace_id: workspaceBody.workspace.id },
    })
    expect(switchRes.status()).toBe(200)
    const switchBody = await switchRes.json()
    expect(switchBody.user.workspace_id).toBe(workspaceBody.workspace.id)

    const apiKeyRes = await request.post('/api/v1/auth/api-keys', {
      headers: {
        cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      data: { label: 'ci-script' },
    })
    expect(apiKeyRes.status()).toBe(201)
    const apiKeyBody = await apiKeyRes.json()
    expect(String(apiKeyBody.api_key)).toMatch(/^mcu_/)

    const apiKeyAuthRes = await request.get('/api/v1/auth/me', {
      headers: {
        'x-api-key': apiKeyBody.api_key,
      },
    })
    expect(apiKeyAuthRes.status()).toBe(200)
    const apiKeyAuthBody = await apiKeyAuthRes.json()
    expect(apiKeyAuthBody.user.username).toBe(adminUser)
    expect(apiKeyAuthBody.user.workspace_id).toBe(workspaceBody.workspace.id)

    const inviteRes = await request.post('/api/v1/auth/invite', {
      headers: {
        cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      data: { email: memberEmail, role: 'operator' },
    })
    expect(inviteRes.status()).toBe(201)
    const inviteBody = await inviteRes.json()
    expect(String(inviteBody.token)).toMatch(/^mci_/)

    const memberRegisterRes = await request.post('/api/v1/auth/register', {
      data: {
        username: memberUser,
        password,
        display_name: 'Tenant Member',
        email: memberEmail,
        invite_token: inviteBody.token,
      },
    })
    expect(memberRegisterRes.status()).toBe(201)
    const memberBody = await memberRegisterRes.json()
    expect(memberBody.user.tenant_id).toBe(registerBody.user.tenant_id)
    expect(memberBody.user.memberships.some((membership: any) => membership.workspace_id === workspaceBody.workspace.id)).toBe(true)
  })
})
