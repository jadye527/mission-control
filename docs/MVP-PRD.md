# Mission Control — External MVP PRD

**Status:** Draft
**Owner:** Ralph
**Date:** 2026-03-18
**Goal:** First paying customer in ≤4 weeks

---

## 1. Problem

Solo founders and small teams building AI agent systems have no good way to monitor, task, and observe their agents. Mission Control solves this — but currently it's single-tenant and internal only.

## 2. MVP Scope

Fastest path to first paying customer. Ship exactly this, nothing more.

### In Scope
- Auth (sign up / log in / log out)
- Multi-tenant data isolation (each org sees only their data)
- 3 pricing tiers
- Landing page with signup CTA

### Out of Scope (post-MVP)
- SSO / OAuth providers
- Team member invites
- Billing automation (manual invoicing for first 10 customers is fine)
- Custom domains
- Agent SDK / API for external agents

---

## 3. Auth

### Requirements
- Email + password signup (no OAuth required for MVP)
- Session-based auth (JWT, 7-day expiry)
- Password reset via email (Resend or SendGrid)
- Email verification on signup (optional for MVP — can skip to ship faster)

### Implementation
- Add `users` table: `id, email, password_hash, org_id, role, created_at`
- Add `orgs` table: `id, name, plan, created_at`
- All existing tables add `org_id` foreign key
- Middleware: every API route checks session + injects `org_id` into query scope
- UI: `/login`, `/signup`, `/forgot-password` pages (minimal, no branding polish)

### Security
- Bcrypt password hashing
- Rate-limit login endpoint (5 attempts / 15 min)
- HTTPS only in production

---

## 4. Multi-Tenant Isolation

### Rule
**Every query must be scoped to the authenticated org's `org_id`. No exceptions.**

### Implementation
- All DB queries: `WHERE org_id = :org_id` (enforced at service layer, not just UI)
- Seed data: initial admin org created at deploy time
- Row-level enforcement: add DB-level constraint or ORM scope to prevent cross-org leaks
- Test: write one integration test per resource type confirming org isolation

### Resources that need isolation
- Tasks
- Agents
- Activity log
- Comms / messages
- Memory entries

---

## 5. Pricing Tiers

| Tier | Price | Limits | Target |
|------|-------|--------|--------|
| **Starter** | $29/mo | 3 agents, 100 tasks/mo | Solo devs, hobbyists |
| **Pro** | $69/mo | 10 agents, 1,000 tasks/mo | Small teams, startups |
| **Scale** | $99/mo | Unlimited agents, 10K tasks/mo | Agencies, power users |

**MVP billing:** Manual invoicing via Stripe payment links. No automated subscription management needed to ship. Add Stripe Billing after first 5 paying customers.

### Enforcement (MVP)
- Store `plan` on `orgs` table
- Soft-enforce limits with a banner warning (don't hard-block yet — reduces friction for early customers)
- Hard-block after 2x limit exceeded

---

## 6. Landing Page

### URL
`missioncontrol.obsidianlabs.ai` (or subdomain of existing domain)

### Sections (in order)
1. **Hero** — Headline + subheadline + "Start free trial" CTA
   - Headline: "AI agent observability for teams that ship"
   - Subheadline: "Monitor, task, and observe your AI agents from one dashboard"
2. **Demo** — Embedded screenshot or 60s screen recording
3. **Features** — 3 bullets: task board, agent health, activity timeline
4. **Pricing** — 3-tier table (from above)
5. **CTA** — "Get started free" → signup page

### Requirements
- Static HTML or Next.js page (reuse existing MC repo)
- Mobile responsive
- No animations needed for MVP
- Meta tags for SEO (title, description, og:image)

---

## 7. Implementation Plan

### Week 1 — Auth + DB schema
- [ ] Add `users` + `orgs` tables with migration
- [ ] Auth middleware (login/signup/session)
- [ ] Scope all existing API routes to `org_id`

### Week 2 — Multi-tenant validation + pricing
- [ ] Integration tests for org isolation
- [ ] Add `plan` field + limit enforcement (soft)
- [ ] Pricing page component

### Week 3 — Landing page + signup flow
- [ ] Landing page (hero, features, pricing, CTA)
- [ ] Signup → org creation → dashboard redirect flow
- [ ] Password reset email

### Week 4 — Polish + launch
- [ ] Manual Stripe payment links for each tier
- [ ] Smoke test full flow (signup → task → agent → billing)
- [ ] Deploy to production URL
- [ ] Announce to waitlist / social

---

## 8. Success Criteria

- [ ] 1 paying customer within 30 days of landing page going live
- [ ] Zero cross-tenant data leaks (verified by integration tests)
- [ ] Auth flow works end-to-end (signup → login → dashboard → logout)
- [ ] Landing page live at public URL

---

## 9. Kill Criteria

If no paying customer after 60 days of landing page live → re-evaluate pricing and positioning before continuing investment.
