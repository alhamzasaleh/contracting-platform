import type { ProductItem } from "@/components/catalogue/products-view";
import type { RateItem } from "@/components/catalogue/rates-view";
import type { SystemItem } from "@/components/catalogue/systems-view";
import { defaultRates, GYPSUM_CATALOGUE, PAINT_PRODUCTS, type CatalogueData } from "@/lib/engine";
import type { ProductCategory, PurchaseUnit } from "@/lib/supabase/database.types";

/** Illustrative pricing-engine catalogue for the design preview (Appendix A.6 values). */

const GROUP_NAME: Record<string, string> = {
  putty: "معجون جدران داخلي",
  primer: "أساس داخلي",
  wall_finish: "دهان جدران داخلي مطفي — درجة قياسية",
  ceiling_paint: "دهان أسقف",
  moisture: "دهان مقاوم للرطوبة",
  decorative: "دهان ديكوري (نظام كامل)",
  ext_primer: "أساس خارجي",
  ext_putty: "معجون خارجي",
  acrylic: "أكريليك خارجي",
  spray_acrylic: "أكريليك رش",
};
const PAINT_CAT: Record<string, ProductCategory> = {
  putty: "putty", primer: "primer", wall_finish: "finish_paint", ceiling_paint: "ceiling_paint", moisture: "moisture_paint",
  decorative: "decorative", ext_primer: "exterior_primer", ext_putty: "exterior_putty", acrylic: "exterior_paint", spray_acrylic: "spray_paint",
};

const base = (o: Partial<ProductItem> & Pick<ProductItem, "id" | "name" | "category" | "purchase_unit">): ProductItem => ({
  brand_id: null, brand: null, group_id: null, group_name: null, role: null, ref_pack_size: null, coverage_per_pack: null, surface_factor: 1,
  length_m: null, contents_per_pack: null, area_m2: null, colour_specific: false, application: "interior", waste_percent: null, notes: null,
  is_active: true, packs: [], ...o,
});
const pack = (id: string, size: number, label: string, price: number | null, supplier: string | null = null) => ({
  id, size, label, best: price, prices: price == null ? [] : [{ supplier_id: supplier ? "sp1" : null, supplier_name: supplier, unit_price: price, since: "2026-11-20" }],
});

const paint: ProductItem[] = PAINT_PRODUCTS.map((p) =>
  base({
    id: p.id, name: p.name.replace("Wall emulsion", "دهان جدران").replace("Ceiling paint", "دهان أسقف"), category: PAINT_CAT[p.role], purchase_unit: p.unit as PurchaseUnit,
    group_id: `g-${p.role}`, group_name: GROUP_NAME[p.role], role: p.role, ref_pack_size: p.refPackSize, coverage_per_pack: p.coveragePerPack,
    colour_specific: p.colourSpecific, waste_percent: p.wastePercent ?? null, application: p.role.startsWith("ext") || p.role.includes("acrylic") ? "exterior" : "interior",
    packs: p.packs.map((k, i) => pack(`${p.id}-${i}`, k.size, `${k.size} ${p.unit === "kg" ? "كجم" : "لتر"}`, k.price)),
  }),
);
paint.splice(
  3,
  0,
  base({
    id: "jotun-fenomastic", name: "فينوماستيك مطفي", brand_id: "b-jotun", brand: "جوتن Jotun", category: "finish_paint", purchase_unit: "L",
    group_id: "g-wall_finish", group_name: GROUP_NAME.wall_finish, role: "wall_finish", ref_pack_size: 18, coverage_per_pack: 120, colour_specific: true,
    packs: [pack("jf-18", 18, "18 لتر", 180, "مؤسسة الدهانات الحديثة"), pack("jf-4", 4, "4 لتر", 45, "مؤسسة الدهانات الحديثة")],
  }),
  base({
    id: "jazeera-finish", name: "دهان جدران مطفي", brand_id: "b-jazeera", brand: "الجزيرة Al-Jazeera", category: "finish_paint", purchase_unit: "L",
    group_id: "g-wall_finish", group_name: GROUP_NAME.wall_finish, role: "wall_finish", ref_pack_size: 18, coverage_per_pack: 110, colour_specific: true,
    packs: [pack("jz-18", 18, "18 لتر", 165), pack("jz-3", 3.6, "جالون 3.6 لتر", null)],
  }),
);

const G = GYPSUM_CATALOGUE;
const gypsum: ProductItem[] = [
  base({ id: "board_normal", name: "لوح جبس عادي 12.5مم 120×240", brand_id: "b-mada", brand: "مدى Mada", category: "gypsum_board", purchase_unit: "sheet", group_id: "g-bn", group_name: "لوح جبس عادي 12.5 مم", role: "board_normal", area_m2: 2.88, packs: [pack("bn", 2.88, "لوح", G.boards.normal.price, "مستودع مواد البناء")] }),
  base({ id: "board_moisture", name: "لوح مقاوم للرطوبة 12.5مم", category: "gypsum_board", purchase_unit: "sheet", group_id: "g-bm", group_name: "لوح جبس مقاوم للرطوبة", role: "board_moisture", area_m2: 2.88, packs: [pack("bm", 2.88, "لوح", G.boards.moisture.price)] }),
  base({ id: "board_fire", name: "لوح مقاوم للحريق 12.5مم", category: "gypsum_board", purchase_unit: "sheet", group_id: "g-bf", group_name: "لوح جبس مقاوم للحريق", role: "board_fire", area_m2: 2.88, packs: [pack("bf", 2.88, "لوح", G.boards.fire.price)] }),
  base({ id: "c_channel", name: "قطاع C 3م", category: "c_channel", purchase_unit: "bar", group_id: "g-c", group_name: "قطاع C رئيسي", role: "c_channel", length_m: 3, packs: [pack("c", 3, "عود 3م", G.cChannel.price)] }),
  base({ id: "omega", name: "أوميغا 3م", category: "omega", purchase_unit: "bar", group_id: "g-o", group_name: "قطاع أوميغا", role: "omega", length_m: 3, packs: [pack("o", 3, "عود 3م", G.omega.price)] }),
  base({ id: "rod", name: "سيخ مسنن 3م", category: "hanger_rod", purchase_unit: "bar", group_id: "g-r", group_name: "سيخ تعليق مسنن", role: "rod", length_m: 3, packs: [pack("r", 3, "عود 3م", G.rod.price)] }),
  base({ id: "edge_angle", name: "زاوية محيط 3م", category: "angle", purchase_unit: "bar", group_id: "g-ea", group_name: "زاوية محيط", role: "edge_angle", length_m: 3, packs: [pack("ea", 3, "عود 3م", G.edgeAngle.price)] }),
  base({ id: "board_screws", name: "مسامير ألواح (علبة 1000)", category: "screws", purchase_unit: "box", group_id: "g-bs", group_name: "مسامير ألواح", role: "board_screws", contents_per_pack: 1000, packs: [pack("bs", 1000, "علبة 1000", G.boardScrews.price)] }),
  base({ id: "joint_tape", name: "شريط فواصل 90م", category: "tape", purchase_unit: "roll", group_id: "g-jt", group_name: "شريط فواصل", role: "joint_tape", contents_per_pack: 90, packs: [pack("jt", 90, "لفة 90م", G.tape.price)] }),
  base({ id: "joint_compound", name: "معجون فواصل 20 كجم", category: "joint_compound", purchase_unit: "bag", group_id: "g-jc", group_name: "معجون فواصل", role: "joint_compound", contents_per_pack: 20, packs: [pack("jc", 20, "كيس 20 كجم", G.compound.price)] }),
];

export const SAMPLE_PRODUCTS: ProductItem[] = [...paint, ...gypsum];
export const SAMPLE_BRANDS: { id: string; name: string; families: ("paint" | "gypsum" | "other")[] }[] = [
  { id: "b-jotun", name: "جوتن Jotun", families: ["paint"] },
  { id: "b-jazeera", name: "الجزيرة Al-Jazeera", families: ["paint"] },
  { id: "b-mada", name: "مدى Mada", families: ["gypsum"] },
  { id: "b-knauf", name: "كناوف Knauf", families: ["gypsum"] },
];
export const SAMPLE_GROUPS = [...new Map(SAMPLE_PRODUCTS.filter((p) => p.group_id).map((p) => [p.group_id!, { id: p.group_id!, role: p.role!, name: p.group_name! }])).values()];

const LABELS: Record<string, [RateItem["section"], string]> = {
  "gypsum.cSpacing": ["gypsum", "تباعد القطاع الرئيسي C"],
  "gypsum.omegaSpacing": ["gypsum", "تباعد الأوميغا"],
  "gypsum.hangerSpacing": ["gypsum", "تباعد العلاقات على C"],
  "gypsum.hangingHeight": ["gypsum", "ارتفاع التعليق"],
  "gypsum.screwsPerM2PerLayer": ["gypsum", "مسامير لكل م² لكل طبقة"],
  "gypsum.compoundPerM2": ["gypsum", "معجون فواصل لكل م² منتهي"],
  "gypsum.wastePercent": ["gypsum", "نسبة الهدر (مواد الجبس)"],
  "interior.coats.wallPutty": ["interior", "أوجه معجون الجدران"],
  "interior.coats.wallFinish": ["interior", "أوجه دهان الجدران"],
  "interior.coats.ceilingPaint": ["interior", "أوجه دهان الأسقف"],
  "interior.wastePercent": ["interior", "نسبة هدر الدهان"],
  "exterior.sprayWastePercent": ["exterior", "نسبة الهدر (رش)"],
  "labour.gypsum.ceilings": ["labour", "مصنعية أسقف جبس"],
  "labour.interior.wallsFull": ["labour", "مصنعية دهان جدران (نظام كامل)"],
  "commercial.targetMarginPercent": ["commercial", "الهامش المستهدف"],
  "commercial.contingencyPercent": ["commercial", "احتياطي المخاطر"],
};
const UNITS: Record<string, string> = { Spacing: "m", Height: "m", PerLayer: "pcs", PerM2: "kg", Percent: "%", coats: "coats", ceilings: "SAR/m2", wallsFull: "SAR/m2" };
const rates = defaultRates();
export const SAMPLE_RATES: RateItem[] = Object.entries(LABELS).map(([key, [section, label]], i) => ({
  id: `r${i}`,
  key,
  value: rates[key],
  unit: Object.entries(UNITS).find(([k]) => key.includes(k))?.[1] ?? null,
  label,
  section,
  sort_order: i,
  last_reviewed_at: i === 0 ? "2026-11-20" : null,
}));

export const SAMPLE_SYSTEMS: SystemItem[] = [
  {
    id: "sy1", code: "gypsum-ceiling", kind: "gypsum_ceiling", name: "أسقف جبس بورد", is_active: true,
    spec_text: "ألواح جبس 12.5 مم على هيكل معدني (قطاع C وأوميغا) معلّق بالأسياخ والوردات، معالجة الفواصل بالشريط والمعجون وجهين ووجه ثالث عند الحاجة.",
    variants: [
      { id: "v1", code: "rod", name: "تعليق بالأسياخ والوردات", spec_text: null, is_default: true },
      { id: "v2", code: "vertical_c", name: "تعليق بعلاقات C رأسية", spec_text: null, is_default: false },
      { id: "v3", code: "double", name: "طبقتين ألواح", spec_text: null, is_default: false },
    ],
    components: ["لوح عادي", "لوح رطوبة", "لوح حريق", "قطاع C", "أوميغا", "أسياخ", "وردات", "فيشر", "كلبسات", "زاوية محيط", "مسامير", "شريط", "معجون فواصل"].map((g, i) => ({ id: `c${i}`, role: g, group: g, inclusion: "always" as const, variants: null })),
  },
  {
    id: "sy2", code: "interior-paint", kind: "interior_paint", name: "دهانات داخلية", is_active: true,
    spec_text: "معجون وجهين للجدران ووجه للأسقف مع الصنفرة، أساس وجه واحد، دهان وجهين. الوجه النهائي بعد تركيب الأبواب والنوافذ والإنارة.",
    variants: [
      { id: "v4", code: "new", name: "نظام كامل (جديد)", spec_text: null, is_default: true },
      { id: "v5", code: "repaint", name: "إعادة دهان", spec_text: null, is_default: false },
    ],
    components: (
      [
        ["عازل إسمنتي", "off"], ["معجون", "on"], ["أساس", "on"], ["دهان جدران", "always"], ["دهان أسقف", "always"],
        ["مقاوم رطوبة", "always"], ["ديكوري", "always"], ["صنفرة", "on"], ["نايلون", "on"], ["شريط", "on"],
      ] as const
    ).map(([g, inclusion], i) => ({ id: `d${i}`, role: g, group: g, inclusion, variants: null })),
  },
  {
    id: "sy3", code: "exterior-paint", kind: "exterior_paint", name: "دهانات خارجية", is_active: true,
    spec_text: "معالجة الشروخ، أساس خارجي، معجون خارجي، دهان أكريليك وجهين أو بروفايل أو رش حسب الاختيار.",
    variants: [
      { id: "v6", code: "roller", name: "دهان بالرولة", spec_text: null, is_default: true },
      { id: "v7", code: "profile", name: "بروفايل / تكسير", spec_text: null, is_default: false },
      { id: "v8", code: "spray", name: "رش", spec_text: null, is_default: false },
    ],
    components: [
      { id: "e1", role: "sealer", group: "عازل إسمنتي", inclusion: "off", variants: null },
      { id: "e2", role: "ext_primer", group: "أساس خارجي", inclusion: "on", variants: null },
      { id: "e3", role: "ext_putty", group: "معجون خارجي", inclusion: "on", variants: ["roller", "spray"] },
      { id: "e4", role: "acrylic", group: "أكريليك خارجي", inclusion: "always", variants: ["roller"] },
      { id: "e5", role: "profile", group: "بروفايل", inclusion: "always", variants: ["profile"] },
      { id: "e6", role: "spray_acrylic", group: "أكريليك رش", inclusion: "always", variants: ["spray"] },
    ],
  },
];

export const SAMPLE_ENGINE_DATA: CatalogueData = {
  products: SAMPLE_PRODUCTS.map((p) => ({
    id: p.id, role: p.role, brand: p.brand, name: p.name, unit: p.purchase_unit, refPackSize: p.ref_pack_size, coveragePerPack: p.coverage_per_pack,
    surfaceFactor: p.surface_factor, lengthM: p.length_m, contentsPerPack: p.contents_per_pack, areaM2: p.area_m2, colourSpecific: p.colour_specific,
    wastePercent: p.waste_percent, packs: p.packs.map((k) => ({ size: k.size, price: k.best })),
  })),
  rates,
};
