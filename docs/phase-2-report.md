# Phase 2 — Catalogue & costing: report

## Delivered
| Area | What |
|---|---|
| Services | Catalogue with Arabic/English names, unit, waste %, active flag; one-tap starter set (gypsum, interior & exterior paint, plaster, tiling) with stages and spec wording — no invented prices or quantities |
| Stages | Ordered stages (prep / work / handover), productivity m²/team/day, fixed days (drying); reorder, edit, delete |
| Duration | Calculator: area × stages ÷ productivity ÷ teams + fixed days, in half-day steps |
| Spec templates | Per service, one default, used by quotes in Phase 3 |
| Materials | Units, categories, general vs project-specific, price history (append-only), current price, price trend, history view |
| Recipes | Quantity per m² per material, waste override, live material cost per m², missing-price warning |
| Labour & extras | External labour per m² or lump sum (per service or general); extra cost items (scaffolding, transport…) |
| Pricing settings | Overheads %, min/default margin, VAT %, default waste, warranty, purchase approval limit, working days, first-payment cover % |
| VAT rule | VAT = 0% until the company has a valid VAT number; settings page and company form explain it |
| Employees | Records (Saudi / non-Saudi, job, ID/iqama, passport & insurance expiry, salary components, IBAN, status), expiry warnings, Saudization %, fully loaded monthly cost and **cost per worker-day** |
| Government costs | Configurable lines (GOSI for Saudi & non-Saudi, medical insurance for all, EOS and leave accruals, iqama, levy, exit/re-entry, leave ticket, recruitment and sponsorship transfer amortised, housing, transport) — seeded at 0, owner enters current values, review date tracked |

## Security
- RLS on all 11 new tables; 14 new database tests (56 total, run with and without Supabase default grants).
- Prices, labour rates and settings need `costs.view`; a deny override hides them even from supervisors.
- Employees and salaries need the new `hr.view` / `hr.manage` permissions (finance: view; supervisors: none).
- Price history is append-only; children can't reference another organization's service/material (trigger).
- All changes audited; all actions Zod-validated (Arabic digits accepted).

## Next
- Phase 3 uses all of this in the pricing engine (in-house labour = productivity × cost per worker-day).
- Pending from Phase 1: WhatsApp OTP, passkeys (Face ID), Supabase "before user created" hook.
