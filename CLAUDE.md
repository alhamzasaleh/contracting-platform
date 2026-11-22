# Build Spec — Contracting & Finishing Operations Platform

> Paste this whole file into Claude Code as the project brief, and save it in the repo root as `CLAUDE.md`.
> Owner: Saleh. Saudi finishing contractor (gypsum board, interior/exterior paint, plaster, tiling…).
> Goal: one complete, production-grade system that replaces Excel and runs the whole business from client request to warranty end.

---

## 0. How to work on this project

- Build **phase by phase** (section 9). Finish, test and deploy each phase before starting the next.
- At the start of each phase: show a short plan, then build. At the end: run tests, run the security checklist (section 7), deploy a preview, and summarise what changed.
- The owner is not a developer and works from an iPad. Explain decisions in plain language, keep setup steps minimal, and do all terminal work yourself.
- Never weaken security, RLS or validation to make something "work quickly".
- Ask before any destructive database migration.

---

## 1. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript (strict) |
| UI | Tailwind CSS + shadcn/ui + Radix, Framer Motion for motion |
| Charts | Apache ECharts (interactive, animated); Recharts acceptable for simple charts |
| Database / Auth / Files | Supabase (Postgres, Row Level Security, Auth with phone OTP, Storage) |
| Hosting | Vercel |
| AI | Anthropic Claude API (invoice reading, site-survey parsing, reports, finance Q&A) — server-side only |
| Accounting | Qoyod REST API (https://apidoc.qoyod.com) |
| Messaging | WhatsApp Business Cloud API + SMS provider for OTP |
| PDF | Server-side HTML → PDF (headless Chromium) so Arabic RTL and brand styling render perfectly |
| App | Installable PWA (iPad + phones), camera, geolocation, push notifications, offline drafts |
| Validation | Zod on every input, client and server |
| Testing | Vitest (unit), Playwright (end-to-end) |

---

## 2. Product principles

- **Arabic first, RTL by default**, full English support (i18n, switchable per user).
- **Multi-tenant from day one** (SaaS-ready): every business table has `organization_id`; RLS isolates organizations. Today there is one organization. Subscriptions/billing are designed for but **not built** now.
- **One contract can hold one or many services** (today: one contract per service; later: comprehensive finishing contracts) — no redesign needed later.
- **Price snapshots**: quotes, contracts and purchases store the prices used at that moment. Changing a cost price affects only new quotes.
- **Warn, don't block**, unless stated otherwise. Owner overrides go through approvals.
- Every create/update/approve is written to an **audit log** (who, what, when, before/after).

---

## 3. Modules & business rules

### 3.1 Clients & requests
- Client record (name, phone, city, location pin, notes) and request with the services needed.
- Service catalogue: gypsum ceilings & partitions, interior paint, exterior paint, plaster, tiling, extensible.

### 3.2 Site survey & measurements
- Two modes per service: **room by room** (system sums) or **total area** directly.
- Attach site photos. AI: supervisor can dictate a voice note or upload photos → structured measurements draft for review.

### 3.3 Costing & pricing
- **Cost price list** for materials and labour, with history.
- **Service → materials recipe (BOM)**: each service has its consumption per m² (e.g. gypsum: board type, joint tape, screws, omega, washers…), plus a **waste %**.
- **Labour**: in-house or external. External priced **per m²** or **lump sum per project**.
- **Extra costs**: transport, equipment rental (scaffolding etc.).
- **Overheads** (labour housing, transport, fixed company costs): fixed % of project cost, set in settings.
- **VAT 15%** handled correctly on all customer documents — **only once the company has a VAT number** (organizations.vat_number). Without it VAT is 0% and documents must not be titled "tax invoice". Use `effectiveVatPercent()` (src/lib/costing).
- **Profit margin**: owner sets a minimum (e.g. 20%). Supervisor picks any margin above it. Below minimum, or any client discount → **approval request to owner** (not a hard block).

### 3.4 Work stages, specs & duration
- Each service has ordered **stages** with productivity (m²/day per team), including preparation, during-work and handover tasks:
  - Gypsum: site prep → framing → boards → joint compound → cleaning.
  - Paint: masking tape, floor plastic, surface repair, primer, coats, drying time, removal, cleaning.
- **Spec templates** per service, selected with one click while pricing and inserted into quote and contract (e.g. joint compound 2 coats, 3rd if needed; paint 2 coats, final coat after doors/windows/lighting are installed).
- System suggests duration from area × stages × productivity; editable. Duration appears in quote and contract.

### 3.5 Project types
- Labour + materials · Labour only (client supplies materials; delays in client materials don't count against us) · Materials supply only.
- Type changes cost calculation and the clauses in quote/contract.

### 3.6 Quotes → contracts
- Quote generated as branded PDF and shared via the client page. Every revision is kept as a version.
- Client accepts electronically (click + optional e-signature); timestamp, IP and device stored.
- Accepted quote converts to a **contract** with the agreed **start date**.

### 3.7 Payment schedule & collection
- Defined per project: advance, stage payments, final payment.
- **Warning** if the first payment covers < 75% of material cost (owner can proceed).
- Stage completion triggers a payment-request reminder.
- Collection view: due, received, outstanding per client; automatic reminders for late clients.

### 3.8 Additional works (change orders)
- Created as an **addendum quote** linked to the contract.
- Work **cannot start** (no progress, no purchases) until the client accepts it.
- On acceptance: extends delivery date, has its **own separate payment**. Requires owner approval.

### 3.9 Scheduling
- **Calendar** of all projects + **team schedule** (who works where, when).
- For a new project, suggest the **earliest available start date** and warn on overlaps.

### 3.10 Purchases & inventory
- Record a purchase by uploading the invoice photo → **AI extracts** supplier, date, VAT number, line items, quantities, totals, VAT → user reviews, picks the project, saves.
- Estimated vs actual cost per project, with overrun alerts.
- Inventory: **project-specific materials** (client-chosen paint colours, stone, tiles) stay on the project; **general materials** (gypsum boards, screws, tape) return to stock and transfer between projects at cost.
- Purchases above an owner-defined limit need approval.

### 3.11 Subcontractors & petty cash
- Each subcontractor: **pricing basis** (lump sum | per m²) + **payment schedule** (weekly | by progress). Track earned, paid, remaining. No retention.
- **Petty cash** per supervisor: spending logged by invoice photo (AI-read) and charged to projects; balance and top-ups tracked.

### 3.12 Execution follow-up
- Supervisor **check-in** with GPS + time (proof of visit).
- Progress % and photos per stage. AI drafts the stage report for the client from the photos.
- Each completed stage is sent to the client page → client confirms receipt of the stage. Final stage = **final handover certificate**, e-signed.

### 3.13 Warranty
- Default **6 months** for all services, editable per project, stated in quote/contract.
- Client opens maintenance requests from the client page during warranty; routed to supervisor; cost tracked.

### 3.14 Client page (portal)
- **One permanent, beautifully branded page per project**, valid until warranty ends, then auto-closes. Owner can revoke and reissue the link instantly.
- Updates as the project moves: quote → contract awaiting acceptance → stages & payments → addenda → handover → warranty.
- Every WhatsApp message opens this same page at the new step.
- **Client notes**: client can post notes with photos during the work → notification to owner and supervisor, saved against the stage.

### 3.15 Finance & Qoyod
- The app = **operational finance** (project costs, payments, purchases, subcontractors, petty cash, profit per project).
- Qoyod = **official accounting** (entries, VAT returns, ZATCA e-invoicing, statements).
- Record once in the app → sync to Qoyod via API (customers, vendors, invoices, invoice payments, bills, bill payments, receipts). Qoyod issues the official e-invoice and returns the PDF; the app sends it to the client by WhatsApp/email.
- Build the Qoyod integration behind an adapter with a queue and retries; test in Qoyod sandbox first. Confirm the PDF-return endpoint during sandbox testing.

### 3.16 Dashboard (owner home)
- **Obligations due** with dates vs **incoming money** → weekly cash-flow forecast with shortfall warnings.
- **Expected vs actual profit** side by side: per project, per period, per service.
- Receivables, delayed projects, projects over budget.
- **Pending approvals card**: approve/reject in one tap, or open details.
- Every number is clickable to its details. AI assistant: ask by voice or text ("how much did I make this month?").

### 3.17 Roles, permissions & approvals
- Preset roles: Owner, Supervisor, Finance, Viewer. Owner can do everything (today the owner is the only user).
- Fully customisable per-user permissions: per-project access, hide costs/margins, per-user approval limits, temporary delegation.
- Client and subcontractor access limited to their own items.
- Approvals needed for: margin below minimum, client discount, large purchases, additional works. Reminders if pending.
- Login by phone OTP, delivered by **WhatsApp** (authentication template via the WhatsApp Business account), with SMS as fallback.
- **Face ID / Touch ID / fingerprint** via passkeys (WebAuthn): after the first OTP login, a user can enable biometric sign-in on each device; OTP remains the recovery path.
- Only known, invited or bootstrap phone numbers may sign in — enforced in the app **and** in Supabase Auth (a "before user created" hook), so the Auth API can't be used to bypass it. Email sign-up stays disabled.

### 3.18 Notifications
- In-app push + WhatsApp. Each user chooses what they receive and on which channel.
- Types: approvals, finance (payment received/late, obligation due), projects (delay, over budget, missed visit), client actions (opened quote, accepted, confirmed stage, added note).
- Approve directly from the notification.

### 3.19 Company settings
- Single company, single identity: name, CR number, VAT number, logo.
- **Brand colours extracted automatically from the uploaded logo** and applied to quote, contract, invoice and client page templates (editable).
- Price lists, minimum margin, overhead %, service stages/specs/productivity, warranty default, approval limits, Qoyod key, WhatsApp settings.


### 3.20 Employees, payroll & true labour cost (added by owner)
- **Employee record**: name, nationality (Saudi / non-Saudi), job (painter, gypsum installer, supervisor, driver…), ID/iqama number and expiry, passport expiry, phone, start date, salary components (basic, housing, transport, other allowances), bank/IBAN for WPS, assigned supervisor/team, status (active, on leave, final exit). Documents (iqama, passport, contract, insurance card) as private files.
- **Monthly payroll**: salaries + overtime + deductions/advances → payslip per employee; obligations feed the cash-flow forecast (§3.16). Export for the bank / Wage Protection System (Mudad) when needed. Sync salary entries to Qoyod (§3.15).
- **Government & statutory costs** — each is a configurable line in Settings (amounts change by regulation; never hard-code them, show the "last updated" date and remind the owner to review). Costs apply to **every** employee unless marked non-Saudi only:
  - **GOSI** (social insurance) employer share — **all employees**; separate rates for Saudi (pension + occupational hazards + SANED) and non-Saudi (occupational hazards), applied to the contributory wage (basic + housing).
  - **Medical insurance** — **all employees, Saudi and non-Saudi** (and dependants where the policy covers them) — annual premium per employee/class, with expiry reminders.
  - Non-Saudi only:
    - **Iqama** issuance/renewal fee and **work permit / expat levy (المقابل المالي)** — per non-Saudi employee per year.
    - **Recruitment**: work visa fee, recruitment office fee, air ticket, medical check.
    - **Sponsorship transfer (نقل الكفالة / نقل خدمات)** fee when hiring locally.
    - **Exit/re-entry visas** and annual leave ticket.
  - All employees: end-of-service benefit (مكافأة نهاية الخدمة) accrual per Saudi Labour Law, annual leave accrual.
  - Labour housing and transport (also part of overheads §3.3).
- **Fully loaded cost per worker**: (monthly salary + allowances + monthly share of all the above) ÷ working days → **cost per worker-day**. This feeds in-house labour pricing (§3.3) and actual project cost (team days on site × cost per worker-day).
- **Reminders** (§3.18): iqama, passport, insurance and work-permit expiry (e.g. 60/30/7 days before), probation end, contract renewal.
- Saudization (Nitaqat) indicator: count of Saudi vs non-Saudi employees, shown on the HR page.
- Permissions: salaries and personal documents visible only with a dedicated permission (`hr.view` / `hr.manage`); supervisors see their team's schedule but not salaries. Personal data per PDPL (minimal, purpose-bound, deletable).

---

## 4. Data model (core tables, all with `organization_id`, `created_at`, `created_by`)

organizations · users/memberships (role + permission overrides) · clients · suppliers · subcontractors · services · service_stages · spec_templates · materials · material_prices (history) · service_material_recipes · requests · surveys · survey_items (rooms/areas) · quotes · quote_versions · quote_lines (price snapshot) · contracts · contract_services · addenda · payment_schedules · payments · projects · project_teams · schedule_entries · site_visits (gps, time) · progress_updates · stage_handover_confirmations · purchases · purchase_lines · purchase_attachments · inventory_items · inventory_movements · subcontractor_agreements · subcontractor_payments · petty_cash_accounts · petty_cash_entries · overhead_settings · warranties · maintenance_requests · client_notes · client_portal_links (token, expires_at, revoked) · approvals · notifications · notification_preferences · audit_log · qoyod_sync_jobs · document_sequences · employees · employee_documents · payroll_runs · payroll_lines · employee_cost_settings (GOSI, insurance, iqama, levy, visa, transfer…) · employee_advances · leave_records.

---

## 5. URLs & numbering

- Readable routes, no random IDs in the app UI:
  `/clients`, `/clients/[number]`, `/quotations/Q-2026-001`, `/contracts/C-2026-001`, `/projects/P-2026-001`, `/purchases/PO-2026-001`, `/invoices/INV-2026-001`.
- Sequential numbering per organization per year via `document_sequences` (transaction-safe, no gaps on concurrent creation).
- **Client page link** = document number **plus** an unguessable token: `/p/P-2026-001/<token>`. Never expose a page by number alone. Token expires at warranty end and can be revoked.

---

## 6. Design direction (must feel premium)

- Level: world-class SaaS (think Linear / Stripe / Vercel dashboards), adapted for Arabic.
- **Approved direction: "Atelier"** (owner-approved Nov 2026; mock-ups in the design canvas): warm sand neutrals, charcoal "ink" sidebar and emphasis panels, deep petrol-green primary with sage accent, the **arch** motif (logo mark, photo frames, client page hero), pill buttons, large rounded cards. **No orange** in the identity. Brand colours will later be replaced by the logo's colours.
- Arabic typography: **Almarai** (UI and documents); Inter for English. **Numbers are Western digits (123) in both languages** by default.
- Theme built from brand colours (from logo), light + dark mode, refined neutrals, generous spacing, soft depth (subtle shadows/glass where it adds clarity, never decoration for its own sake).
- Dashboard: animated KPI cards, interactive ECharts (cash-flow forecast, expected vs actual profit, service profitability, receivables ageing), drill-down on click, skeleton loaders, smooth page transitions.
- Mobile/iPad first for supervisors: big touch targets, camera-first flows, one-hand use on site, offline drafts that sync later.
- Documents (quote, contract, invoice, handover certificate): print-grade, branded, bilingual-ready, RTL-perfect, with QR where relevant.
- Client page: elegant timeline of the project, clear call-to-action at each step (accept, confirm stage, add note).
- Accessibility: WCAG AA contrast, keyboard navigation, readable at arm's length on site.

---

## 7. Security (non-negotiable)

- RLS on **every** table; tests proving a user can't read another organization's or unauthorised project's data.
- All secrets (Supabase service key, Anthropic key, Qoyod key, WhatsApp token) server-side only, in environment variables — never in the browser or repo.
- Zod validation on every server action/API route; rate limiting on auth, OTP and public client-page endpoints.
- Storage buckets private; files served via short-lived signed URLs.
- Client-page tokens: long, random, hashed in DB, expiring, revocable.
- Audit log for all sensitive actions; approvals recorded with actor and time.
- Security headers (CSP, HSTS, etc.), dependency audit, no PII in logs.
- Daily backups (Supabase PITR when available).
- Personal data handled in line with Saudi PDPL principles (minimal data, purpose-bound, deletable on request). Note: hosting region to be reviewed before selling to other companies.
- Before each production release: run a full security review of the phase and report findings.

---

## 8. AI features (server-side, via Claude API)

1. Survey: voice note / photos → measurements draft.
2. Pricing: suggest materials, quantities, margin and duration from past projects.
3. Purchases & petty cash: invoice photo → structured data (with confidence flags for review).
4. Progress: photos → stage report draft for the client.
5. Finance assistant: natural-language questions over the owner's own data; alerts when a project starts losing money.
Always show AI output as a **draft for human review**; never auto-post financial data without confirmation.

---

## 9. Build phases

1. **Foundation**: repo, Next.js, Supabase, auth (phone OTP), organizations, roles/permissions, RLS, audit log, i18n + RTL, design system & app shell, company settings with logo-colour extraction, document numbering. Deploy.
2. **Catalogue & costing**: services, stages, spec templates, materials, price history, recipes, waste, labour, overheads, margin rules, **employees & government cost settings → fully loaded cost per worker-day** (§3.20).
3. **Clients → survey → quote**: requests, measurements (room/total), pricing engine, quote versions, branded PDF, approvals for margin/discount.
4. **Client page & contracts**: portal link, e-acceptance, contract with start date, project types, payment schedule with 75% warning.
5. **Scheduling**: calendar, team schedule, earliest-start suggestion, overlap warnings.
6. **Purchases & inventory**: AI invoice reading, estimated vs actual, stock transfers, purchase approvals.
7. **Execution**: site check-in with GPS, progress & photos, stage handover confirmations, client notes, final handover certificate.
8. **Additional works, subcontractors, petty cash.**
9. **Finance dashboard & notifications**: cash-flow forecast, profits, receivables, approvals card, WhatsApp + push, **monthly payroll, payslips and document-expiry reminders** (§3.20).
10. **Qoyod integration** (sandbox → production) and invoice PDF delivery.
11. **Warranty & maintenance requests.**
12. **AI assistant, polish, performance, full security review, PWA install & offline.**
Later (not now): subscriptions/billing, App Store & Google Play wrappers.

---

## 10. Accounts the owner will need

GitHub · Vercel · Supabase · Anthropic API key · SMS/OTP provider · WhatsApp Business (Meta) · Qoyod API key (Settings → General Settings).
Guide the owner through each one step by step when it's first needed.

---

## 11. Engineering notes (kept up to date by Claude)

**Stack versions**: Next.js 16 (App Router, Turbopack, `src/proxy.ts` replaces middleware), React 19, Tailwind v4, Zod 4, next-intl 4, Supabase SSR. Next 16 differs from older docs — read `node_modules/next/dist/docs/` before using an unfamiliar API. `cacheComponents` is **off** on purpose (every app page is per-user and dynamic; CSP nonces need dynamic rendering).

**Commands**
- `npm run dev` — local app. Without Supabase keys, `/` redirects to `/setup`; `/dev/preview` shows every screen with sample data.
- `npm run check` — lint + types + unit + database tests.
- `npm run test:db` — applies `supabase/tests/shim/supabase-shim.sql` + all migrations to a throwaway Postgres (`TEST_DATABASE_ADMIN_URL`, default `postgres://postgres@127.0.0.1:54329/postgres`) and proves RLS/permissions.
- `npm run test:e2e` — Playwright on desktop, iPad and phone against a production build.

**Conventions**
- Database is the source of truth for security: every table has RLS; helper functions live in schema `private` (SECURITY DEFINER, `search_path = ''`). New tables: add `organization_id`, `created_at`, `created_by`, RLS policies using `private.is_member()` / `private.has_permission()`, `select private.enable_audit('public.<table>')`, and RLS tests in `tests/db/`.
- Document numbers: `before insert` trigger `private.assign_document_number('<type>')` on a `number` column.
- Permissions: keys in `private.all_permissions()` and `src/lib/auth/permissions.ts` (a test keeps them in sync).
- Server actions: validate with Zod (`.strict()`), check permission via `getSession()`/`can()`, then write with the user's Supabase client (RLS applies). The service-role client (`src/lib/supabase/admin.ts`) is only for rate limiting and the phone allow-list.
- UI: page views are pure components taking props, so `/dev/preview` can render them with sample data. Text lives in `messages/ar.json` + `messages/en.json` (same keys; no dots inside keys). Numbers/money/dates go through `useFormatter()` / `getFormatter()` (respects ٠١٢ vs 012). Use logical CSS (`ms-`, `pe-`, `start-`) so RTL and LTR both work.
- Brand colours: `organizations.brand` → `BrandStyle` derives accessible light/dark tokens (`src/lib/brand/color.ts`). Neutral and "ink" tokens live in `src/app/globals.css`.
