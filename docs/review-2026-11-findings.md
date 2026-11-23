# Full-system review — findings to fix (Nov 2026)

Produced by four read-only reviews (`bug-hunter` ×2, `integration-reviewer` ×2) on `main` at commit 9977d74.
Items marked **proven** were reproduced against a throwaway Postgres with all migrations applied.
Fix in three batches, each test-first (CLAUDE.md §0.1), then re-run both agents on the batch.

Owner decisions still needed (ask him in Arabic before touching these):
- **#23** may staff close a maintenance request, or only the client (current spec)?
- **#8** in-house labour actual cost = schedule days of the team on the contract × cost per worker-day (spec §3.20) — confirm.

---

## Batch 1 — money & security (critical)

**1. Addendum payments (three paths, one fix)**
- `src/app/(app)/contracts/actions.ts:251-258` `markAddendumPaid` sets only `payment_status:'paid'`, no `paid_amount/paid_at` → no RV receipt (`supabase/migrations/20261218000001_receipts.sql:78-86` fires on `paid_amount`), no Qoyod `invoice_payment` (`20261217000001_qoyod.sql:154-162`), invoice stays unpaid (`src/lib/data/invoices.ts:25`), and the row drops out of collections (`src/lib/data/finance.ts:82-83`). Button: `src/components/contracts/addenda-section.tsx:108`.
- `src/app/(app)/reports/actions.ts:41-48` `recordPayment` for `ad:` ids overwrites `paid_amount` (not cumulative), always sets `paid` even for a partial amount, drops method/reference, no `after(runBackground)`.
- **Proven:** `guard_addendum` (`20261211000001_addenda_subcontractors_petty_cash.sql:77-117`) never protects `paid_amount/paid_at`, and `addenda_update` RLS (~l.280-287) allows `quotes.manage` → a supervisor set `paid_amount = 999` on a **draft** addendum and the DB issued RV-2026-001 (client page, WhatsApp message, Qoyod job).
- Fix: definer `public.record_addendum_payment(addendum, amount, date, method, reference)` mirroring `record_client_payment` (finance.manage, accepted addenda only, cumulative, `paid` only when total reached, upper bound). Invoker guard blocks direct `payment_status`/`paid_*` writes. Route both UI paths through it; remove `markAddendumPaid`. Add to the allow-list in `tests/db/invariants.test.ts`. Also add `payment_received` notify trigger and late reminders for addenda (`run_daily_reminders` only loops `contract_payments`: `20261224000001_project_alerts_push.sql:201-212`; notify only on contract payments: `20261216000001_notifications.sql:188`). Store method/reference on addenda for the receipt (`receipts.sql:79`).

**2. Signing / material_supply / custom payments never become `requested` (proven)**
- Only `portal_confirm_stage` (`20261210000001_execution.sql:392-395`) flips to requested, by `payment_event` of stages (`board_closing`, `primer_done`, `handover`). `portal_accept` (`20261225000001_quote_options.sql:119-176`) requests nothing; staff can't change status since `20261220000001_security_hardening.sql:67-70`.
- Effect: no INV invoice, no Qoyod invoice, 0 in receivables/ageing (`finance.ts:128,186`), no late reminder, WhatsApp reminder hidden (`reports-view.tsx` ~89).
- Fix: on acceptance set `due_event='signing'` payments to requested (in `portal_accept` and/or `on_contract_accepted`); add a staff definer `request_contract_payment()` (finance.manage or quotes.manage, accepted contracts, `material_supply`/`custom` only).

**3. Owner approval for margin/discount can be bypassed**
- `quotes_update` RLS (`20261203000001_clients_surveys_quotes.sql:320-322`) lets `quotes.manage` write `quotes.status`; no guard. `guard_contract` (`20261223000001_contract_terms.sql:33-39`) leaves `total/quote_version/quote_id` free on draft/sent. A supervisor can `update quotes set status='issued'` with a pending `quote_margin` approval, then create a contract (`contracts/actions.ts:86` only checks status).
- Fix: invoker guard on quotes — `issued`/`accepted` only via a definer `issue_quote()` that checks open approvals + unpriced items (or service role). Contract insert/update takes `total` from `quote_versions` and requires an issued quote with no open approvals for the version.

**4. Stale quote approvals**
- `quotations/actions.ts:120` supersedes old approvals with the user client; RLS `approvals_update` needs `approvals.decide` → 0 rows, silently. `setQuoteOptions(null)` (`:240-250`) doesn't cancel dropped versions' approvals. `decideApproval` (`:180-184`) sets quote to `draft` whenever nothing is open, whatever the status → deciding a stale approval turns an **accepted** quote back to draft.
- Fix: supersede via definer/trigger; only move to draft from `pending_approval`; `issueQuote`/`saveQuoteVersion` refuse accepted quotes.

**5. Payroll advances settled wrongly (proven)**
- `20261215000001_payroll.sql:197-199` `approve_payroll_run` marks every undeducted advance of the employee as settled whenever the line has `advances > 0`. Proven: 500 advance, line edited to deduct 200 (`payroll-actions.ts:41`) → 500 settled (300 lost); an advance given after run creation also settled.
- Fix: store advance ids/amounts on the line (or settle only advances created before the run and only when fully deducted; carry remainder).

**6. Per-project access leaks**
- **Proven** `move_stock` (`20261209000001_purchases_inventory.sql:326-361`) checks `purchases.manage` only → restricted user moved stock out of a hidden project. Same check needed in `submit_purchase`, `submit_addendum`: require `private.can_access_contract` for every non-null contract.
- **Proven** `purchase_lines`, and also `subcontractor_work`, `subcontractor_payments` lack restrictive `_project_scope` policies (no `contract_id`; `20261226000001_project_access.sql:95-97`) → add restrictive policies via the parent row.
- `contract_warranties` (`20261219000001_warranty_maintenance.sql:320-331`) checks `projects.view` only → add `can_access_contract`.
- Notifications `payment_received`, `payment_late`, `project_losing` link to `/reports` (`notifications.sql:190`, `project_alerts_push.sql:210,293`) so `link_contract()` (`project_access.sql:130-154`) finds no contract and skips scope. Fix: pass the contract id to `private.notify` explicitly (don't parse links) and link to `/contracts/<n>`.
- `approval`/`approval_reminder` link to `/` (`notifications.sql:99`, `project_alerts_push.sql:231/239`) — no scope; link to the entity page.

**7. Qoyod payments on draft invoices fail permanently**
- `src/lib/qoyod/sync.ts:208-220` `invoice_payment` has no Draft deferral (bill_payment `:235` and payroll `:250` do). Message `qoyod.waiting_approved` already says payments aren't posted on drafts. Fix: `if (s.invoice_status !== "Approved") throw new Deferred("waiting:approved")`.

**8. In-house labour missing from actual cost → profit overstated**
- Actuals = materials + expenses + petty cash (+ subcontractors) only: `src/lib/data/purchases.ts:132-185`, `finance.ts:149`, `private.project_actuals()` (`project_alerts_push.sql:160-177`). Expected includes labour (`finance.ts:138-142`). `perDay` only used by pricing (`src/lib/data/pricing.ts:46`, `src/lib/pricing/index.ts:397`).
- Fix (pending owner confirmation): in-house labour actual = Σ schedule `work` days of in-house teams on the contract × Σ members' `employeeCost().perDay`, in both `loadProjectCosts` and `project_actuals`; own column, totals only (no salaries without hr.view).

---

## Batch 2 — connections & consistent numbers

**9. Client-page link** — `contract-views.tsx:398` hides "create link" once accepted and link inactive (`sendContract` allows it, `contracts/actions.ts:128-129`). Renewal uses `linkExpiry(start,duration,warranty)` (`src/lib/contracts/index.ts:47`) ignoring actual handover (`private.warranty_end`) and addenda days. Fix: always allow reissue unless cancelled; expiry = `greatest(linkExpiry, warranty_end + 1 day)`.

**10. Dead ends between pages**
- Contract page (`contract-views.tsx:284-460`): no link to `/projects/<n>`, no invoices list (`src/lib/data/contracts.ts:135-156` loads none), no warranty/maintenance.
- Invoice page (`src/app/(app)/invoices/[number]/page.tsx`) and list (`invoices-view.tsx:69`): contract as plain text, no link to receipts.
- Purchase detail (`purchase-views.tsx:450`) and maintenance card (`maintenance-view.tsx:129`): contract/project as plain text.
- Client page (`src/lib/data/clients.ts:49-55`, `clients-view.tsx:245-302`): no contracts/projects/balance/invoices/maintenance.
- Project page (`src/lib/data/projects.ts:52-96`, `project-views.tsx`): no start/delivery date (incl. addenda days), warranty end, addenda payments (`:244-258` lists contract payments without amounts), costs, maintenance; no links to `/purchases/new?project=<n>` (supported, unlinked), `/schedule?contract=<n>`, `/maintenance?r=`.

**11. Notification targets** — `project_delay`, `missed_visit` → `/projects/<n>` (now `/contracts/`, `project_alerts_push.sql:249,261`); `project_over_budget` → `/purchases/costs` or project costs (`:280`); `project_losing` goes to costs.view holders but links to `/reports` (finance.view). Approvals card renders only with finance.view (`src/app/(app)/page.tsx:18`, `dashboard-view.tsx:104`) → show for `approvals.decide`. Addendum approvals have `link: null` (`finance.ts:191-194`); store contract number in details (`addenda...sql:144`).

**12. Addenda** — no estimated cost column → false over-budget alerts (estimate only from quote: `purchases.ts:155-162`, SQL `:266-272`, revenue adds addenda `finance.ts:146`, SQL `:286`). Auto subcontractor agreement quantity not updated on addendum acceptance (`20261230000001_auto_subcontractor_agreement.sql:38-40,73-75`) — flag for review or add area.

**13. Numbers that disagree**
- Dashboard `collectedMonth` (`finance.ts:179`) skips paid addenda; assistant uses receipts → derive from `client_receipts`.
- Qoyod VAT from `quote_versions.vat_percent`/`addenda.vat_percent` (`sync.ts:163,171,187`) vs app invoice 0 % without VAT number (`20261222000001_invoices.sql:84-91`) → read from the linked `invoices` row.
- `payloads.ts:65` `unit_price = round(gross/1.15,2)` → ~6 % of amounts total 0.01 lower in Qoyod; adjust net so `round(net*1.15,2) == gross` (or tax-inclusive if supported).

**14. Permissions mismatched** — `reports.view` gates nothing (`/reports` + nav use `finance.view`: `reports/page.tsx:9`, `nav.ts:51-52`); `/purchases/costs` requires `quotes.view` (`purchases/costs/page.tsx:6`); `invoices`/`client_receipts` RLS allow `quotes.view` but pages need `finance.view`; receipt print needs `quotes.view` only. Align nav/page/action/RLS.

**15. Excluded gypsum parts shown as included to the client** — `src/lib/quotes/index.ts:66-70` `included` ignores `sel.excluded`, while `priceSelection` (`pricing/index.ts:263-265`) doesn't price them → quote/contract promise e.g. joint compound not priced.

**16. Labour silently falls back to template rates** — `pricing/index.ts:380,396-397` returns only `labourNote` (crew loaded only with `hr.view`, `src/lib/data/pricing.ts:27-30`; deactivated external rate). Make it a blocking readiness issue.

**17. Missing costs in finance** — `maintenance_requests.cost` (uncovered) not in actuals/profit (only assistant, `assistant/actions.ts:36`); payroll forecast uses gross salary only (`finance.ts:98-101`), not run net / statutory items from `employee_cost_items`. Assistant `SAFE_LINK` (`src/lib/assistant/context.ts:73`) drops `/invoices/`, `/clients/`, `/quotations/`.

---

## Batch 3 — minor

18. `record_client_payment` (`20261214000001_finance.sql:78-90`) no upper bound → reject `paid + amount > amount + 0.005`.
19. Editing a sent contract deletes then inserts payments (`contracts/actions.ts:81-114`) — not atomic; Zod tolerance (<0.01) vs DB cap (≤100.001) can fail mid-way leaving no schedule. Do it in one DB function.
20. `price_subcontractor_work` (`addenda...sql:352-375`) no cumulative cap → lump sum >100 %, per-m² beyond quantity, work on closed agreements.
21. Push on shared iPad: `push_subscriptions.endpoint` globally unique (`project_alerts_push.sql:34`), `savePushSubscription` deletes only own rows (`notifications/actions.ts:64`), sign-out (`src/app/auth/signout/route.ts`) doesn't remove the device → delete on sign-out, definer upsert by endpoint.
22. `check_phase7_refs` (`execution.sql:96-127`) doesn't require `project_stages.contract_id = new.contract_id` for progress updates.
23. Staff can set maintenance `closed` (`maintenance/actions.ts:15`, guard allows) — spec says only the client closes. **Owner decision.**
