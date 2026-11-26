"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand-logo";
import { DocNo } from "@/components/doc-no";
import { useListSep, useUnitText } from "@/components/forms/form-kit";
import type { FramingDoc } from "@/lib/data/framing";
import { cutPlan, framingRuns, hangerCut, linePositions, roomHangerPositions, roomLabel, type FramingRoom, type GypsumFraming } from "@/lib/engine";
import { useFormatter } from "@/components/formatter-provider";
import { useQtyNumber } from "./buy-text";
import { PrintButton } from "./print-button";
import type { DocOrg } from "./quote-document";

const cm = (m: number) => Math.round(m * 100);

/**
 * رسمة الهيكل الحديدي — for the technician (owner, Nov 2026): per room a top view (C channels, omegas,
 * hangers, edge angle, spacings), then the cut plan of every bar (which pieces, for which room, the
 * offcut) and the hanger pieces. From the version's frozen framing, so the counts are exactly the
 * bill of quantities'. No prices.
 */
export function FramingDocument({ org, doc }: { org: DocOrg; doc: FramingDoc }) {
  const t = useTranslations("framing");
  const td = useTranslations("doc");
  const sep = useListSep();
  const qn = useQtyNumber();
  const { fmt } = useFormatter();
  const f = doc.framing;

  return (
    <article className="relative mx-auto grid min-w-0 max-w-[1000px] gap-6 overflow-hidden rounded-3xl border border-border bg-white p-5 text-[14px] text-basalt sm:p-10 print:max-w-none print:rounded-none print:border-0 print:px-0 print:pb-0 print:pt-8">
      <span aria-hidden className="absolute end-0 top-0 size-10 bg-clay [clip-path:polygon(0_0,100%_0,100%_100%)] rtl:[clip-path:polygon(0_0,100%_0,0_100%)] print:size-8" />
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-primary pb-4">
        <div className="flex flex-wrap items-center gap-3">
          {org.logoUrl && <BrandLogo src={org.logoUrl} label={org.name} className="text-basalt" fit="h-auto w-[min(140px,40vw)] max-h-16" />}
          <div className="text-[12px] leading-6 text-doc-muted">
            <p className="text-[16px] font-extrabold text-basalt">{org.legal_name ?? org.name}</p>
            <p>{[org.cr_number && td("cr", { n: org.cr_number }), org.vat_number && td("vat", { n: org.vat_number })].filter(Boolean).join(" · ")}</p>
            {(org.phone || org.city) && <p>{[org.city, org.phone].filter(Boolean).join(sep)}</p>}
          </div>
        </div>
        <div className="text-end">
          <p className="text-[22px] font-extrabold text-primary">{t("title")}</p>
          <p className="text-[12px] text-doc-muted">{t("subtitle")}</p>
          <p className="text-[13px]"><DocNo>{doc.number}</DocNo></p>
          {doc.option && <p className="text-[12px] font-bold">{t("option", { label: doc.option })}</p>}
        </div>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr_auto_1fr]">
        <dt className="text-doc-muted">{t("client")}</dt>
        <dd className="font-semibold">{[doc.client.name, doc.client.city].filter(Boolean).join(sep)}</dd>
        <dt className="text-doc-muted">{t("quote")}</dt>
        <dd>
          <DocNo>{doc.quoteNumber}</DocNo> · {t("version", { n: doc.version })} · {fmt.date(doc.date)}
        </dd>
      </dl>

      {!f ? (
        <p className="rounded-2xl bg-surface-sunken p-4 text-[14px]">{doc.service !== "gypsum" ? t("notGypsum") : doc.missing === "total" ? t("noneTotal") : doc.kind === "project" ? t("noneProject") : t("none")}</p>
      ) : (
        <>
          <Summary f={f} />
          <section className="grid gap-3">
            <h2 className="text-[16px] font-extrabold">{t("rooms")}</h2>
            <p className="text-[12px] text-doc-muted">{t("legend")}</p>
            <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
              {f.rooms.map((r) => (
                <RoomCard key={r.id} r={r} f={f} />
              ))}
            </div>
          </section>
          <CutSection f={f} />
          <p className="text-[12px] text-doc-muted">{t(f.hangerRule === "inside" ? "footnote" : "footnoteOld", { grid: qn(cm(f.grid)) })}</p>
          {Object.values(f.listed).some((x) => !x) && <p className="text-[12px] font-semibold">{t("notListedNote")}</p>}
        </>
      )}
    </article>
  );
}

function Summary({ f }: { f: GypsumFraming }) {
  const t = useTranslations("framing");
  const qn = useQtyNumber();
  const runs = framingRuns(f, t("trough"));
  const h = hangerCut(f);
  const off = (listed: boolean, v: string) => (listed ? v : `${v} · ${t("notListed")}`);
  const items = [
    [t("sumGrid"), t("cmValue", { n: qn(cm(f.grid)) })],
    [t("sumHangerSpacing"), t("cmValue", { n: qn(cm(f.hangerSpacing)) })],
    [t("sumSuspension"), t(`susp_${f.suspension}`)],
    [t("sumHanging"), t("cmValue", { n: qn(cm(f.hangingHeight)) })],
    [t("sumC"), off(f.listed.c, t("bars", { n: qn(cutPlan(runs.c, f.bars.c).bars), len: qn(f.bars.c) }))],
    [t("sumOmega"), off(f.listed.omega, t("bars", { n: qn(cutPlan(runs.omega, f.bars.omega).bars), len: qn(f.bars.omega) }))],
    [t("sumAngle"), off(f.listed.angle, t("bars", { n: qn(cutPlan(runs.angle, f.bars.angle).bars), len: qn(f.bars.angle) }))],
    [t("sumHangers"), off(f.listed.hanger, t("hangers", { n: qn(h.total) }))],
  ];
  return (
    <section className="grid gap-2">
      <h2 className="text-[16px] font-extrabold">{t("summary")}</h2>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4">
        {items.map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-border p-3">
            <dt className="text-[12px] text-doc-muted">{k}</dt>
            <dd className="text-[15px] font-bold">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RoomCard({ r, f }: { r: FramingRoom; f: GypsumFraming }) {
  const t = useTranslations("framing");
  const qn = useQtyNumber();
  const unit = useUnitText();
  return (
    <figure className="grid min-w-0 gap-2 rounded-2xl border border-border p-3 break-inside-avoid">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[15px] font-bold">{roomLabel(r)}</span>
        <span className="text-[12px] text-doc-muted" dir="ltr">
          {qn(r.L)} × {qn(r.W)} {unit("m")}
        </span>
      </figcaption>
      <RoomDrawing r={r} f={f} />
      <ul className="grid gap-0.5 text-[12px]">
        <li>{t("roomC", { n: qn(r.channels), len: qn(r.channelLength), dir: t(`dir_${r.cAlong}`) })}</li>
        <li>{t("roomOmega", { n: qn(r.omegas), len: qn(r.omegaLength) })}</li>
        <li>{t("roomHangers", { n: qn(r.hangers), per: qn(r.channels ? r.hangers / r.channels : 0) })}</li>
      </ul>
    </figure>
  );
}

/** Top view, the room's length left to right. C = clay (thick), omega = basalt (thin), hangers = dots, edge angle = frame. */
export function RoomDrawing({ r, f }: { r: FramingRoom; f: GypsumFraming }) {
  const t = useTranslations("framing");
  const qn = useQtyNumber();
  const L = cm(r.L);
  const W = cm(r.W);
  const s = Math.max(L, W);
  const pad = s * 0.09;
  const font = s * 0.04;
  const along = r.cAlong === "length";
  // C lines: across the other side; omegas: across the C
  const cPos = linePositions(along ? r.W : r.L, f.grid).map(cm);
  const oPos = linePositions(along ? r.L : r.W, f.grid).map(cm);
  const hPos = roomHangerPositions(r, f).map(cm);
  const first = cPos[0];
  return (
    <svg viewBox={`${-pad} ${-pad} ${L + 2 * pad} ${W + 2 * pad}`} className="h-auto w-full" role="img" aria-label={t("drawingLabel", { name: roomLabel(r) })}>
      <rect x={0} y={0} width={L} height={W} style={{ fill: "var(--gypsum)" }} />
      {/* omegas */}
      {oPos.map((p) => (along ? <line key={`o${p}`} x1={p} y1={0} x2={p} y2={W} style={{ stroke: "var(--basalt)" }} strokeWidth={s * 0.003} /> : <line key={`o${p}`} x1={0} y1={p} x2={L} y2={p} style={{ stroke: "var(--basalt)" }} strokeWidth={s * 0.003} />))}
      {/* C channels + hangers */}
      {cPos.map((p) => (
        <g key={`c${p}`}>
          {along ? <line x1={0} y1={p} x2={L} y2={p} style={{ stroke: "var(--clay)" }} strokeWidth={s * 0.009} /> : <line x1={p} y1={0} x2={p} y2={W} style={{ stroke: "var(--clay)" }} strokeWidth={s * 0.009} />}
          {hPos.map((h) => (along ? <circle key={h} cx={h} cy={p} r={s * 0.008} style={{ fill: "var(--basalt)" }} /> : <circle key={h} cx={p} cy={h} r={s * 0.008} style={{ fill: "var(--basalt)" }} />))}
        </g>
      ))}
      {/* edge angle */}
      <rect x={0} y={0} width={L} height={W} fill="none" style={{ stroke: "var(--basalt)" }} strokeOpacity={0.55} strokeWidth={s * 0.012} />
      {/* dimensions */}
      <g fontSize={font} style={{ fill: "var(--basalt)" }} fontFamily="Inter, Almarai, sans-serif" direction="ltr">
        <text x={L / 2} y={W + pad * 0.7} textAnchor="middle">{qn(r.L)}</text>
        <text x={-pad * 0.35} y={W / 2} textAnchor="middle" transform={`rotate(-90 ${-pad * 0.35} ${W / 2})`}>{qn(r.W)}</text>
        {first != null && (
          <text x={along ? L + pad * 0.1 : first} y={along ? first + font * 0.35 : -pad * 0.25} textAnchor={along ? "start" : "middle"}>{qn(first)}</text>
        )}
      </g>
    </svg>
  );
}

function CutSection({ f }: { f: GypsumFraming }) {
  const t = useTranslations("framing");
  const qn = useQtyNumber();
  const runs = framingRuns(f, t("trough"));
  const h = hangerCut(f);
  const block = (title: string, runs: Parameters<typeof cutPlan>[0], len: number, listed: boolean) => ({ title, len, listed, ...cutPlan(runs, len) });
  const blocks = [block(t("cutC"), runs.c, f.bars.c, f.listed.c), block(t("cutOmega"), runs.omega, f.bars.omega, f.listed.omega), block(t("cutAngle"), runs.angle, f.bars.angle, f.listed.angle)];
  return (
    <section className="grid gap-4">
      <h2 className="text-[16px] font-extrabold">{t("cutPlan")}</h2>
      <p className="text-[12px] text-doc-muted">{t("cutHint")}</p>
      {blocks.map(({ title, patterns, bars, len, listed }) => (
        <div key={title} className="grid gap-2 break-inside-avoid">
          <h3 className="text-[14px] font-bold">
            <bdi>{title}</bdi> — <bdi>{t("bars", { n: qn(bars), len: qn(len) })}</bdi>
            {!listed && <span className="ms-2 text-[12px] font-normal text-doc-muted">{t("notListed")}</span>}
          </h3>
          <ul className="grid gap-1 text-[13px]">
            {patterns.map((p, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border/60 pb-1">
                <span className="min-w-12 font-bold" dir="ltr">× {qn(p.count)}</span>
                <span className="min-w-0 flex-1">
                  {p.full
                    ? t("fullBar", { room: p.pieces[0].label })
                    : p.pieces.map((x, k) => (
                        <span key={k}>
                          {k > 0 && " + "}
                          {t("piece", { len: qn(cm(x.length)), room: x.label })}
                        </span>
                      ))}
                </span>
                {!p.full && <span className="text-[12px] text-doc-muted">{p.offcut > 0.005 ? t("offcut", { len: qn(cm(p.offcut)) }) : t("noOffcut")}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="grid gap-1 break-inside-avoid">
        <h3 className="text-[14px] font-bold">
          <bdi>{t(`cutHangers_${f.suspension}`)}</bdi> — <bdi>{t("bars", { n: qn(h.bars), len: qn(f.bars.hanger) })}</bdi>
        </h3>
        <p className="text-[13px]">
          {h.longer ? t("hangerLonger", { total: qn(h.total), piece: qn(cm(h.piece)), bar: qn(cm(f.bars.hanger)) }) : t("hangerCut", { total: qn(h.total), piece: qn(cm(h.piece)), per: qn(h.perBar), offcut: qn(cm(h.offcut)) })}
          {!f.listed.hanger && <span className="ms-2 text-[12px] text-doc-muted">{t("notListed")}</span>}
        </p>
      </div>
    </section>
  );
}

/** Toolbar + document (print page and preview). */
export function FramingScreen({ org, doc, path, base = "" }: { org: DocOrg; doc: FramingDoc; path: string; base?: string }) {
  const t = useTranslations("framing");
  return (
    <>
      <div className="mx-auto mb-4 flex max-w-[1000px] flex-wrap items-center justify-between gap-3 px-4 print:hidden">
        <Link href={`${base}${path.replace(/\/framing$/, "/materials")}`} className="text-[13px] font-medium text-primary underline-offset-4 hover:underline">
          {t("toMaterials")}
        </Link>
        <PrintButton pdfHref={`/api/pdf/${path.split("/").slice(2).join("/")}`} />
      </div>
      <div className="px-4 print:px-0">
        <FramingDocument org={org} doc={doc} />
      </div>
    </>
  );
}
