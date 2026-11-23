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
> The full pricing engine (catalogue, systems, quantity logic, seed values) is in **Appendix A — Pricing Engine**. It is the heart of the product: get it right before building quotes.
- **Cost price list** for materials and labour, with history.
- **Service → materials**: parametric "systems" per service (Appendix A), plus a **waste %** per material.
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

organizations · users/memberships (role + permission overrides) · clients · suppliers · subcontractors · services · service_stages · spec_templates · materials · material_prices (history) · service_material_recipes · requests · surveys · survey_items (rooms/areas) · quotes · quote_versions · quote_lines (price snapshot) · contracts · contract_services · addenda · payment_schedules · payments · projects · project_teams · schedule_entries · site_visits (gps, time) · progress_updates · stage_handover_confirmations · purchases · purchase_lines · purchase_attachments · inventory_items · inventory_movements · subcontractor_agreements · subcontractor_payments · petty_cash_accounts · petty_cash_entries · overhead_settings · warranties · maintenance_requests · client_notes · client_portal_links (token, expires_at, revoked) · approvals · notifications · notification_preferences · audit_log · qoyod_sync_jobs · document_sequences · employees · employee_documents · payroll_runs · payroll_lines · employee_cost_settings (GOSI, insurance, iqama, levy, visa, transfer…) · employee_advances · leave_records · brands · products (brand, category, pack, coverage, specs, datasheet) · product_prices (per supplier, history) · equivalence_groups · systems · system_variants · system_components (formula-driven) · consumption_rates · project_parameters · zones · consumption_actuals (calibration).
If the Phase 1 schema is already built, add these through a new migration (non-destructive).

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
2. **Catalogue & pricing engine (Appendix A)**: brands, products with coverage/pack/price per supplier, datasheet AI import, equivalence groups, systems & variants, consumption rates, labour, overheads, margin rules, seed data from Appendix A.6. Build the quantity engine as a pure, fully unit-tested TypeScript module (golden tests from A.7) before any UI. (Also: employees & government cost settings → fully loaded cost per worker-day, §3.20 — owner addition, kept.)
3. **Clients → survey → quote**: rooms with L×W×H, zones and overrides, quick-estimate mode, pricing engine UI, multi-option quotes, purchase list, readiness checks, quote versions, branded PDF, approvals for margin/discount.
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
- Server actions: validate with Zod (`.strict()`), check permission via `getSession()`/`can()`, then write with the user's Supabase client (RLS applies). The service-role client (`src/lib/supabase/admin.ts`) is only for rate limiting, the phone allow-list and the public client page (`portal_view` / `portal_accept`, which are granted to service_role only, called after per-IP rate limiting, plus a 10-minute signed URL for the logo).
- UI: page views are pure components taking props, so `/dev/preview` can render them with sample data. Text lives in `messages/ar.json` + `messages/en.json` (same keys; no dots inside keys). Numbers/money/dates go through `useFormatter()` / `getFormatter()` (respects ٠١٢ vs 012). Use logical CSS (`ms-`, `pe-`, `start-`) so RTL and LTR both work.
- **Pricing decisions confirmed by the owner** (complements Appendix A): ceilings have their own colour count/names (not necessarily white); wet and decorative walls get the normal putty + primer under their special finish; waste applies to boards, screws, tape, compound and paint — metal bars use cut optimisation instead; light troughs, shadow gaps and maintenance hatches are **optional features** added only when the client asks, and when present they are loaded into the ceiling price per m² (listed in the quote as included features); shared materials (putty, primer, screws, tape, compound) are split between work types by area for price per m². **Survey decisions (owner)**: total-area mode is a fully supported way to price (not only a draft) — the quote then uses unit price per m² settled on actual measurement; one survey holds the rooms (L×W×H) once and every service (interior paint, gypsum, …) reuses them — per room the supervisor ticks which services apply (e.g. gypsum ceiling only in some rooms) and can override the type for that room (fire / moisture board, moisture paint, decorative…).
- Pricing engine: `src/lib/engine` is pure TS (no I/O). Catalogue rows → engine config via `buildEngineConfig()` (`src/lib/engine/catalogue.ts`); missing products/prices/rates fall back to A.6 defaults **with a warning**. Loader `src/lib/data/engine.ts`. Seed: `public.seed_pricing_engine(org)` — `tests/unit/engine-catalogue.test.ts` parses the seed SQL and keeps it in sync with `defaultRates()` and the golden results. Old `materials` stay (copied into `products` by the seed); new work uses `products`.
- **Scope of work (owner)**: nothing is standard except the finish, labour and margin. `system_components.inclusion` = `always` | `on` (optional, included by default) | `off` (optional, excluded by default), with optional `variant_codes` (e.g. exterior putty only for roller/spray, not profile). `resolveScope()` (`src/lib/engine/scope.ts`) applies rules + the client's choices; compute functions take `scope`. Cement sealer (`sealer`) is optional-off. The client's quote lists **only what is included** — not-included items are never mentioned to the client (owner, Nov 2026); they stay visible internally on the pricing screen. **The owner controls every component** (finish coats and gypsum parts too) — never lock a component as always; defaults only. The owner also ticks which variants each component is used with (`variant_codes`, null = all) on the Systems page.
- **Product model (owner)**: a product line (`equivalence_groups`: category, unit, `coverage_per_unit` = m² per litre/kg per coat, or bar length / board area / pack contents) is defined ONCE; brands under it (`products`) only add pack sizes and prices; pack coverage = size × per-unit coverage; a brand may override `coverage_per_unit`. UI: `ProductLinesView`; engine input via `linesToCatalogue()` (`src/lib/catalogue/product-lines.ts`). The chosen exterior method's finish always applies to its own method (`resolveScope(..., methodRoles)`).
- **Pricing by steps (owner-agreed, replaces Systems & per-variant rules in the UI)**: three places only — Materials (product once → brands → packs/prices), Pricing (per client: every step's product, brand and coats as buttons incl. "none"; options as standard chips; labour = template rates | our team (crew daily cost × area ÷ productivity) | external contractor from `labour_rates`), and the per-service template (`pricing_templates`, saved from the Pricing screen; non-coat numbers on "أرقام القالب"). Core: `src/lib/pricing` (`STEPS`, `defaultSelection`, `priceSelection`) — every chosen step is priced as chosen or reported in `problems` (never dropped). Several product lines may serve one role (unique `(org, role, name)`), e.g. boards 12.5 / 15 mm. Labour does not depend on coats.
- **Phase 3 (clients → survey → quote)**: `src/lib/survey` turns rooms (L×W×H, openings, per-room gypsum/board type, wall zone, ceiling paint) or totals into `Quantities`; gypsum uses real room dimensions (`gypsumRooms`). Quotes: `src/app/(app)/quotations/actions.ts` **recomputes on the server** from the survey + selection (never trusts browser numbers), freezes a version (`quote_versions.client_view` for the client, `quote_version_costs` for costs.view only), and raises `approvals` (margin below `pricing_settings.min_margin_percent`, any discount). Discounts are a **percentage** (`client_view.discountPercent`); the risk reserve (contingency %) is chosen per quote next to the margin (`Selection.contingencyPercent`, default from template numbers). Achieved margin can exceed the target only because price per m² is rounded **up** to `commercial.roundingStep`. Issue = no open approvals for the current version + no unpriced items. Printable document at `/print/quotations/[number]` (iPad: Share → Print → PDF); server-side PDF later.
- **Phase 4 (contracts & client page)**: project type (`options.projectType`: full | labour → no materials | supply → no labour) is chosen in Pricing and frozen in the quote; contracts (`/contracts`, C- numbers) come only from an **issued** quote's current version, with start date, duration (suggested from productivity), warranty and a payment schedule (percentages must total 100 %, last payment absorbs rounding; **warn, don't block** when the first payment covers < 75 % of material cost). Client page `/p/<contract number>/<token>`: 32-byte random token shown once, only its SHA-256 stored, revoked on renewal, expires after warranty (`linkExpiry`). Only the client can accept (DB guard); acceptance stores name, time, IP, user agent and an optional PNG signature; accepted contracts can't change.
- `npm run test:e2e` runs against the last `npm run build` — rebuild first.
- Brand colours: `organizations.brand` → `BrandStyle` derives accessible light/dark tokens (`src/lib/brand/color.ts`). Neutral and "ink" tokens live in `src/app/globals.css`.

## Appendix A — Pricing Engine (the core of the product)

### A.0 Goal and principle
The owner priced in Excel with three workbooks (gypsum board, interior paint, exterior paint). They worked because inputs were few and everything else was automatic. The app must keep that simplicity and go further:
- **All complexity lives in the catalogue and settings, entered once.** On site, pricing is choosing, not calculating.
- **One system for the whole villa, then override only the parts that differ** (e.g. bathrooms moisture-resistant board, kitchen fire-resistant board).
- **Every quantity is traceable**: tap any line to see how it was calculated (formula + inputs), so the owner trusts the numbers.
- Every default below is editable per organization, and overridable per project (overridden values are visibly highlighted, as in the Excel).

### A.1 Product catalogue (by brand)
- **Brands**: Jotun, Al-Jazeera, National, Sipes, Asib, Knauf, Gyproc, etc. (editable list).
- **Product** fields: brand, product line/name, category (putty, primer, finish paint, profile/texture, spray paint, moisture-resistant paint, decorative, gypsum board, C-channel, omega, stud, track, hanger rod, angle, shadow profile, screws, tape, joint compound…), purchase unit, **pack sizes** (a product may have several: 18 L, 4 L…), **coverage per pack per coat** (m²) with optional surface factors, sheen, interior/exterior, colour-specific (yes/no), technical specs (board: type normal/moisture/fire, thickness 9.5/12.5/15 mm, size 120×240/120×300; metal: length 3/3.6/4 m, gauge/thickness 0.4/0.5/0.6 mm, width), waste %, show-on-quote flag, notes.
- **Prices per supplier**, with history; the engine uses the organization's preferred supplier or the cheapest, and stores the snapshot in the quote.
- **Datasheet import (AI)**: upload a product's technical datasheet PDF/photo → AI extracts coverage, pack sizes, recommended coats, drying time, specs → saved as a draft for review.
- **Equivalence groups**: products from different brands that do the same job (e.g. "interior matt emulsion, standard grade") are grouped, so switching brand swaps every component automatically and recalculates quantities with that brand's own coverage and pack sizes.

### A.2 Systems (assemblies) and variants
A **system** is a reusable recipe of components with formulas; a **variant** changes options without rebuilding it. Examples:
- **Interior paint — new, full system**: primer ×1, wall putty ×2, ceiling putty ×1, finish walls ×2, ceiling paint ×2, sanding per putty coat, floor protection, tape, consumables.
- **Interior paint — repaint**: spot putty and spot primer on X % of area (default 20 %), then full finish coats.
- **Exterior**: finish method variant = **roller paint | profile/texture | spray** (spray has higher waste, default 15 %, and its own labour rate), primer, exterior putty, acrylic or profile coats, scaffolding/equipment, protection items.
- **Gypsum ceiling**: board type + thickness, layers (1 or 2), suspension method (**threaded rod + washer** | **vertical C hanger**), hanging height, spacings, edge angle, light troughs, shadow gaps, maintenance hatches.
- **Gypsum partition**: stud spacing, height, board type per face, layers per face, optional rock-wool insulation.
Systems carry their **spec text** (coats, method, standards) that flows into quote and contract (§3.4).

### A.3 Survey input (kept minimal)
- Rooms entered as **L × W × H** (or totals). From that the engine derives: ceiling area = L×W, perimeter = 2(L+W), wall area = perimeter × H − openings. Openings deducted per measurement rule (default: deduct openings > 1 m²; configurable).
- Rooms grouped into **villas/units** (one contract per villa supported, as in the Excel) and **zones** (wet, kitchen, decorative, façade front/back/sides).
- **Zone overrides**: base system for the whole unit; a zone can override board type, paint product, coats or method. Areas of overridden zones are subtracted from the base automatically.
- Linear items: light troughs (m), shadow gaps (m), crack treatment (m); counted items: maintenance hatches by size.
- **Quick-estimate mode**: total areas only (status "estimated"); the quote states areas are settled on actual measurement; later replaced by measured rooms with a variance report.
- Survey by voice/photos (AI draft) remains as in §3.2.

### A.4 Quantity logic (must reproduce and improve the Excel)
Paint (per product, per colour):
- `qty_litres_or_packs = area × coats ÷ (coverage_per_pack × surface_factor) × (1 + waste)`.
- **Round up per colour**: each approved colour is a separate purchase (leftovers of one colour can't be used for another). Number of colours comes from the project.
- **Pack optimisation**: choose the cheapest combination of available pack sizes that covers the need (e.g. 2×18 L + 1×4 L instead of 3×18 L).
- Sandpaper per m² per putty coat; floor nylon ≈ ceiling area; tape per m² painted; consumables cost per m².
Gypsum ceilings (computed **per room** from real dimensions, not only from total area):
- Main C runs = ceil(W ÷ C spacing) + 1, each of length L; omega runs = ceil(L ÷ omega spacing) + 1, each of length W (+ extra omega per metre of light trough).
- Hangers = runs of C × (ceil(L ÷ hanger spacing) + 1) (+ extra per metre of light trough); rod length per hanger = hanging height + cutting allowance; one washer set and one anchor per hanger.
- **Cut optimisation**: lay required run lengths onto stock bar lengths (3 / 3.6 / 4 m) with offcut reuse (first-fit-decreasing), so bar counts are realistic, and show expected offcuts.
- Boards = area × layers ÷ board area × (1 + waste), rounded up, per board type; light trough board allowance per metre.
- Edge angle = perimeter (or estimated 0.7 m per m² when perimeter unknown); angle screws per metre.
- Clips at each C/omega crossing; screws per m² per layer; joint tape and joint compound per m² of finished surface.
Gypsum partitions:
- Studs = length ÷ stud spacing + 1, each of the partition height; tracks = 2 × length; boards = area × 2 faces × layers per face.
- Insulation (optional) = partition area.
Labour: per m² (ceilings, partitions, walls, ceilings paint, repaint, spray, decorative), per linear metre (light troughs, shadow, cracks), per extra layer, or lump sum. Execute-only projects exclude materials automatically.
Extras: transport, scaffolding/equipment, supervision visits, cleaning & waste removal, furniture/doors/sockets protection, project share of overheads.

### A.5 Price calculation
- `cost = materials + labour + extras + maintenance hatches`
- `cost_with_contingency = cost × (1 + contingency %)` (risk reserve, default 5 %)
- `price = cost_with_contingency ÷ (1 − margin %)` — margin is on **selling price**, not mark-up; show both margin and mark-up.
- Separate **price per m²** per work type (ceilings vs partitions; walls vs ceilings), **rounded up** to a configurable step (1 / 0.5 / 0.25 / 0.01 SAR).
- Pricing method: **unit price per measured m²** (settled on actual measurement) or **lump sum** for the defined scope.
- Discount → owner approval if below minimum margin; VAT 15 % when applicable.
- **Multi-option quotes**: show the client up to 3 options side by side (brands or methods, e.g. Jotun / Al-Jazeera / Asib, or roller vs profile); the client picks on the client page and the contract uses the chosen option.
- **Readiness check** before issuing: lists missing inputs and warnings ("ready to issue" / "needs review"), as in the Excel.
- **Purchase list** generated from the quote: per product, per colour, per supplier, packs to buy, expected leftovers → becomes purchase orders after the contract.

### A.6 Seed defaults (from the owner's Excel — editable, prices are placeholders to update)
Gypsum (spacings and rates):
| Parameter | Default |
|---|---|
| Main C spacing | 100 cm |
| Omega spacing | 40 cm |
| Hanger spacing on C | 100 cm |
| Stud spacing (partitions) | 60 cm |
| Partition height | 3 m |
| Hanging height | 40 cm |
| Screws per m² per layer | 15 |
| Joint tape per m² finished | 1.4 m |
| Joint compound per m² finished | 0.45 kg |
| Angle screws per m perimeter | 2.5 |
| Perimeter factor when unknown | 0.7 m per m² ceiling |
| Light trough: board per m | 0.6 m² |
| Light trough: extra omega per m | 2 m |
| Light trough: protection angle per m | 2 m |
| Light trough: extra hangers per m | 1 |
| Cutting allowance per hanger | 0.15 m |
| Team productivity | 40 m²/day |
| Waste (materials) | 5 % |
Gypsum catalogue placeholders: board normal 12.5 mm 120×240 (2.88 m²) 22 SAR; moisture 30; fire 34; C 3 m 11; omega 3 m 9; threaded rod 3 m 7; washers box 100 = 25; vertical C hanger 3 m 11; anchors box 100 = 30; clips box 100 = 25; edge angle 3 m 6; angle screws box 100 = 15; shadow profile 3 m 25; trough protection angle 3 m 7; stud 3 m 14; track 3 m 11; board screws box 1000 = 35; tape roll 90 m = 12; compound bag 20 kg = 28. Labour: ceilings 12/m² (includes spot and AC cut-outs), partitions 15/m², extra layer 5/m², light troughs 15/m, shadow 8/m. Maintenance hatches (supply + install): 30×30 = 60, 40×40 = 75, 50×50 = 90, 60×60 = 110, 60×120 = 180. Rock-wool insulation 18/m². Not offered: 60×60 T-grid tile ceilings.
Interior paint: coverage per pack per coat — putty 20 kg ≈ 25 m² (45 SAR); primer 18 L ≈ 140 m² (120); wall finish 18 L ≈ 120 m² (180); ceiling paint 18 L ≈ 130 m² (140); moisture-resistant 18 L ≈ 110 m² (230); decorative 5 L ≈ 15 m² full system (160); crack material 5 kg ≈ 20 m (25); sandpaper pack ≈ 150 m² per coat (40); floor nylon roll 50 m² (35); tape roll ≈ 60 m² (6); consumables 0.5 SAR/m². Default coats: wall putty 2, ceiling putty 1, primer 1, wall finish 2, ceiling paint 2; repaint spot putty 20 %. Labour: walls full 12/m², ceilings full 14/m², repaint 7/m², decorative +15/m², cracks 5/m. Productivity 120 m²/day.
Exterior paint: primer ≈ 200 m²/pack (135), exterior putty ≈ 25 m²/pack (90), acrylic ≈ 150 m²/pack ×2 coats (340), spray acrylic ≈ 140 m²/pack ×2 coats, waste 15 % (345), application labour 6/m², sanding & putty 4/m², spray labour 4.5/m², scaffolding/lift rental per day, protection (tape, floor plastic, windows/doors). Productivity 100 m²/day.
Commercial defaults: quote validity 7 days, target margin 28 %, contingency 5 %, minimum margin set by owner (e.g. 20 %), price rounding 1 SAR, warranty 6 months. Default payment stages (gypsum): on signing → after material supply → after board closing → after final handover; inspection notice 3 days; notices via WhatsApp and email stated in the contract. Contract wording follows the Saudi Civil Transactions Law (contracting chapter); measurement settlement on approved quantities.

### A.7 Golden tests (must pass)
Build test cases from the Excel sample project so results can be compared: one villa, ceilings 400 m² (of which fire 25 m², moisture 30 m²), partitions 40 m², light troughs 60 m, shadow 80 m, hatches 4×(40×40) + 2×(60×60), rod & washer, 1 layer, hanging 40 cm, spacings 100/40/100/60, partition height 3 m, margin 28 %, contingency 5 %. And interior paint: walls 600 m² (wet 40, decorative 30), ceilings 250 m², new full system, Jotun, 2 colours. Assert quantities, bars/boards/packs, cost, price per m² and totals; also assert that switching brand, switching method (roller → spray) and overriding one zone recalculate correctly.

### A.8 Calibration (learning from real projects)
- After each project, compare **estimated vs actual** consumption (from purchases and returns to stock) per material and system.
- When a consistent variance appears (e.g. joint compound +12 % across 3 projects), suggest updating the consumption rate; the owner approves the change. Never change rates automatically.
