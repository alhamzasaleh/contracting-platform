import type { MaterialsDoc } from "@/lib/data/materials";
import { defaultSelection, priceSelection } from "@/lib/pricing";
import { buildSnapshot } from "@/lib/quotes";
import { materialRows, needsFromLines } from "@/lib/quotes/materials";
import { surveyQuantities } from "@/lib/survey";
import { SAMPLE_SURVEY } from "./sample-clients";
import { SAMPLE_PRICING_CTX, SAMPLE_QUOTE } from "./sample-quotes";

/** Bill of quantities samples: the sample interior quote, and a gypsum project with some bought. */
const quoteSrc = (prices: boolean) => ({ items: SAMPLE_QUOTE.internal!.purchaseList, needs: needsFromLines(SAMPLE_QUOTE.internal!.lines, { prices }) });

export function sampleQuoteMaterials(prices: boolean): MaterialsDoc {
  return {
    kind: "quote", number: SAMPLE_QUOTE.quote.number, quoteNumber: SAMPLE_QUOTE.quote.number, version: SAMPLE_QUOTE.quote.version, date: SAMPLE_QUOTE.current!.created_at,
    option: null, client: SAMPLE_QUOTE.client, service: "interior", rows: materialRows(quoteSrc(prices), { prices }), prices, bought: false, canPrices: true, canPurchase: false,
  };
}

const gq = surveyQuantities("gypsum", "rooms", SAMPLE_SURVEY.rooms, SAMPLE_SURVEY.survey.totals);
const gsel = defaultSelection("gypsum", SAMPLE_PRICING_CTX.catalogue);
const gsnap = buildSnapshot(gsel, gq, priceSelection(gsel, gq, SAMPLE_PRICING_CTX), { discountPercent: 0, method: "unit", estimated: false, vatPercent: 0, catalogue: SAMPLE_PRICING_CTX.catalogue });
const projectSrc = (prices: boolean) => ({ items: gsnap.purchaseList, needs: needsFromLines(gsnap.lines, { prices }) });
// the first two items partly bought (stock items named as the purchase form names them)
const stock = gsnap.purchaseList.slice(0, 2).map((p, i) => ({ id: `s${i}`, name: `${p.brand ? `${p.label} — ${p.brand}` : p.label}${p.packs.length ? ` (${p.packs[0].size})` : ""}`, unit: p.packs.length ? "pack" : p.unit, product_id: p.productId ?? null }));
const boughtRows = gsnap.purchaseList.slice(0, 2).map((p, i) => ({ item_id: `s${i}`, product_id: p.productId ?? null, colour: p.colour ?? "", unit: stock[i].unit, quantity: Math.max(1, Math.floor((p.packs[0]?.count ?? p.qty) / (i + 1))) }));

export function sampleProjectMaterials(prices: boolean, number = "C-2026-003"): MaterialsDoc {
  // C-2026-003 = the accepted sample project (bought columns); any other number = a contract not accepted yet
  const accepted = number === "C-2026-003";
  return {
    kind: "project", number, quoteNumber: "Q-2026-007", version: 2, option: accepted ? null : "جوتن", date: "2026-11-18T09:00:00Z",
    client: { name: "شركة البناء المتقن", phone: "966551234567", city: "الرياض" }, service: "gypsum",
    rows: materialRows(projectSrc(prices), { prices, bought: accepted ? { stock, rows: boughtRows } : undefined }), prices, bought: accepted, canPrices: true, canPurchase: accepted,
  };
}
