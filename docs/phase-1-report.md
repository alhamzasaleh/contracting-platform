# Phase 1 — Foundation: report

## What was built

| Area | Delivered |
|---|---|
| Project | Next.js 16 + TypeScript strict, Tailwind v4, Radix-based component library, Motion animations |
| Auth | Phone OTP (Saudi mobiles, Arabic digits accepted), two-step login with SMS autofill, sign-out, first-owner onboarding, invitations accepted automatically on first login |
| Multi-tenant | `organizations` root; every table carries `organization_id`; RLS isolates organizations |
| Roles & permissions | Owner / Supervisor / Finance / Viewer presets, per-user grant/deny overrides, project scope + approval limit fields, temporary delegation |
| Audit log | Append-only, written by database triggers (who, what, when, before/after); viewer in Settings |
| Numbering | `Q-2026-001` style, per organization per type per year, transaction-safe, no gaps |
| i18n | Arabic (default, RTL) + English (LTR), per-user language, ٠١٢ / 012 numerals choice, Riyadh time zone |
| Design system | Brand-driven tokens, light/dark/auto, IBM Plex Sans Arabic + Inter, KPI cards, skeletons, command palette (⌘K), responsive shell (sidebar on desktop, drawer on iPad/phone) |
| Company settings | Company details (CR, VAT validated), logo upload with automatic colour extraction, accessible contrast adjustment, live quote + client-page preview |
| Team | Members list, invite by phone with role, change role, suspend/reactivate, per-user permission editor |
| Design preview | `/dev/preview` — every screen with sample data, no database (dev + Vercel previews only) |

## Tests

- **Unit (35)** — colour maths & logo extraction, formatting (both numeral systems), phone normalisation, open-redirect guard, company validation, SVG safety.
- **Database security (42)** — tenant isolation, anonymous denial, role permissions, overrides, privilege-escalation attempts, last-owner protection, suspension, delegation windows, invitations, OTP allow-list, profiles, append-only audit, storage folder isolation, rate limiting, numbering under concurrency and rollback, TS↔SQL permission sync. A mutation check (weakening one policy) was confirmed to make tests fail.
- **End-to-end (24 = 8 × desktop/iPad/phone)** — RTL/LTR, numerals, security headers, login validation and code step, invite dialog, setup redirect.

## Security checklist (spec §7)

| Item | Status |
|---|---|
| RLS on every table + tests proving isolation | ✅ 8 tables + storage, 42 tests |
| Secrets server-side only | ✅ only `NEXT_PUBLIC_SUPABASE_URL` / publishable key reach the browser; secret key used in `server-only` modules |
| Zod on every server action | ✅ all actions use `.strict()` schemas |
| Rate limiting on auth/OTP | ✅ per phone (4 / 10 min) and per IP (15 / 10 min) for sending, 8 / 10 min for verifying; Supabase's own limits on top |
| OTP only for known/invited numbers | ✅ `auth_phone_allowed()` — stops strangers creating accounts or burning SMS credit |
| Private storage + short-lived signed URLs | ✅ `org-assets` private, 1-hour signed URLs, per-organization folders enforced by RLS |
| Uploads | ✅ size limit, magic-byte type check, SVG sanitiser (no scripts/handlers/external refs) |
| Audit log | ✅ triggers on all Phase 1 tables; append-only for users |
| Security headers | ✅ nonce-based CSP (`strict-dynamic`), HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, no `X-Powered-By` |
| Open redirects | ✅ `next` parameter restricted to same-origin paths |
| Privilege escalation | ✅ DB trigger: non-owners can't create/modify owner or finance members or grant permissions they lack; last owner can't be removed |
| Dependency audit | ✅ `npm audit --omit=dev`: 0 vulnerabilities (also in CI) |
| No PII in logs | ✅ no logging of phone numbers or tokens |
| Daily backups / PITR | ⏳ enable in Supabase (Pro plan) before real data goes in |
| Hosting region (PDPL) | ⏳ choose the Supabase region nearest Saudi Arabia when creating the project |

### Findings / follow-ups
1. **SMS provider**: Supabase's built-in phone auth supports Twilio, MessageBird, Vonage and Textlocal. For a Saudi sender ID (e.g. Unifonic/Taqnyat) we will use Supabase's *Send SMS hook* in a later step. Until then, Supabase **test phone numbers** let the owner sign in with a fixed code.
2. `style-src 'unsafe-inline'` is allowed (animations set inline styles); scripts remain strictly nonce-based.
3. Login tells an unknown number it isn't registered (clear for staff); enumeration is limited by the rate limits above.
4. The end-to-end login against a real Supabase project can only be tested once the project exists — first thing to verify after connecting.
