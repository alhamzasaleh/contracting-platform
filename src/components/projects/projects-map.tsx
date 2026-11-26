"use client";
import { List, MapPin } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DocNo } from "@/components/doc-no";
import { MapLegend } from "@/components/maps/map-legend";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProjectListItem } from "@/lib/data/projects";
import { activePins } from "@/lib/geo";

const SiteMap = dynamic(() => import("@/components/maps/site-map").then((m) => m.SiteMap), { ssr: false, loading: () => <div className="h-[60vh] animate-pulse rounded-3xl bg-surface-sunken" /> });

/**
 * «خريطة المشاريع» (owner, Nov 2026): every project still running (accepted, not handed over) on one
 * map — late ones in red — to plan teams and visits; projects without a site pin are listed apart,
 * linked to their client to set it.
 */
export function ProjectsMapView({ projects, base = "", canSetSite }: { projects: ProjectListItem[]; base?: string; canSetSite: boolean }) {
  const t = useTranslations("maps");
  const running = projects.filter((p) => !p.done);
  const { pins, missing } = activePins(running.map((p) => ({ ...p, site: p.site ?? null })));
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MapLegend items={[["project", t("running")], ["late", t("late")]]} />
        <Button asChild variant="secondary" size="sm">
          <Link href={`${base}/projects`}>
            <List /> {t("asList")}
          </Link>
        </Button>
      </div>
      {running.length === 0 ? (
        <EmptyState icon={<MapPin />} title={t("noRunning")} description={t("noRunningBody")} />
      ) : (
        <SiteMap
          className="h-[60vh] min-h-80"
          label={t("projectsMapLabel")}
          openLabel={t("openProject")}
          pins={pins.map((p) => ({ id: p.id, lat: p.site.lat, lng: p.site.lng, tone: p.late ? ("late" as const) : ("project" as const), label: `${p.client} · ${p.number} · ${p.progress}%`, href: `${base}/projects/${p.number}` }))}
        />
      )}
      {missing.length > 0 && (
        <section className="grid gap-2 rounded-3xl border border-border bg-surface p-5">
          <p className="text-[15px] font-bold">{t("withoutSite", { n: missing.length })}</p>
          <p className="text-[12px] text-muted-foreground">{t("withoutSiteHint")}</p>
          <ul className="grid gap-1.5 text-[14px]">
            {missing.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-1.5 last:border-0">
                <Link href={`${base}/projects/${p.number}`} className="hover:text-primary hover:underline">
                  {p.client} · <DocNo>{p.number}</DocNo>
                </Link>
                {canSetSite && p.clientNumber && (
                  <Link href={`${base}/clients/${p.clientNumber}`} className="text-[13px] font-semibold text-primary hover:underline">
                    {t("setSite")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
