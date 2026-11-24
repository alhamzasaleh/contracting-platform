import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading frames shown the moment a link is tapped (each section's `loading.tsx`), shaped like
 * the page that is coming so nothing jumps when it arrives. Pure markup: no data, no text.
 */

function Header({ actions = false, description = true }: { actions?: boolean; description?: boolean }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid min-w-0 gap-3">
        <Skeleton className="h-9 w-48 rounded-xl sm:h-11 sm:w-64" />
        {description && <Skeleton className="h-4 w-[min(22rem,80vw)] rounded-lg" />}
      </div>
      {actions && <Skeleton className="h-11 w-36 shrink-0 rounded-full" />}
    </div>
  );
}

function Rows({ count = 6 }: { count?: number }) {
  return (
    <ul className="grid gap-2">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
          <div className="grid min-w-0 gap-2">
            <Skeleton className="h-4 w-40 max-w-full rounded-lg" />
            <Skeleton className="h-3 w-56 max-w-full rounded-lg" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

function Kpis({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-24 rounded-3xl" />
      ))}
    </div>
  );
}

function Card({ className = "h-40" }: { className?: string }) {
  return (
    <section className="grid gap-3 rounded-3xl border border-border bg-surface p-5" aria-hidden>
      <Skeleton className="h-5 w-40 rounded-lg" />
      <Skeleton className={`${className} rounded-2xl`} />
    </section>
  );
}

/** A list page with its own header: clients, quotations, contracts, projects, invoices, maintenance. */
export function ListPageSkeleton({ kpis = 0, actions = true }: { kpis?: number; actions?: boolean }) {
  return (
    <div aria-busy="true">
      <Header actions={actions} />
      <div className="grid gap-4">
        {kpis > 0 && <Kpis count={kpis} />}
        <Skeleton className="h-11 w-full max-w-md rounded-full" />
        <Rows />
      </div>
    </div>
  );
}

/** Content under a section's own header and tabs (catalogue, purchases, team): a toolbar and a list. */
export function SectionContentSkeleton({ kpis = 0 }: { kpis?: number }) {
  return (
    <div className="grid gap-4" aria-busy="true">
      {kpis > 0 && <Kpis count={kpis} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-11 w-full max-w-sm rounded-full" />
        <Skeleton className="h-11 w-32 rounded-full" />
      </div>
      <Rows />
    </div>
  );
}

/** A document page (contract, quote, project, client, invoice, purchase): main column + side panel. */
export function DetailPageSkeleton() {
  return (
    <div aria-busy="true">
      <Header actions description={false} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-5">
          <section className="grid gap-4 rounded-3xl border border-border bg-surface p-5">
            <Skeleton className="h-6 w-56 max-w-full rounded-lg" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="grid gap-2">
                  <Skeleton className="h-3 w-16 rounded-lg" />
                  <Skeleton className="h-4 w-24 rounded-lg" />
                </div>
              ))}
            </div>
          </section>
          <Card className="h-48" />
          <Card className="h-32" />
        </div>
        <aside className="grid content-start gap-3 rounded-3xl border border-border bg-surface p-5">
          <Skeleton className="h-5 w-32 rounded-lg" />
          <Skeleton className="h-10 w-full rounded-full" />
          <Skeleton className="h-10 w-full rounded-full" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </aside>
      </div>
    </div>
  );
}

/** Reports: KPIs, a chart and tables. */
export function ReportsSkeleton() {
  return (
    <div aria-busy="true">
      <Header />
      <div className="grid gap-4">
        <Kpis />
        <Card className="h-64" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="h-48" />
          <Card className="h-48" />
        </div>
      </div>
    </div>
  );
}

/** The schedule: toolbar, teams down the side, days across. */
export function ScheduleSkeleton() {
  return (
    <div className="min-w-0" aria-busy="true">
      <Header />
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-10 w-28 rounded-full" />
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="ms-auto h-10 w-32 rounded-full" />
        </div>
        <section className="grid gap-2 rounded-3xl border border-border bg-surface p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="grid grid-cols-[96px_1fr] items-center gap-3 sm:grid-cols-[160px_1fr]">
              <Skeleton className="h-4 w-full rounded-lg" />
              <Skeleton className="h-9 w-full rounded-xl" />
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

/** The assistant: a conversation and the question box. */
export function AssistantSkeleton() {
  return (
    <div aria-busy="true">
      <Header />
      <section className="grid gap-4 rounded-3xl border border-border bg-surface p-5">
        <Skeleton className="h-16 w-3/4 rounded-2xl" />
        <Skeleton className="ms-auto h-10 w-1/2 rounded-2xl" />
        <Skeleton className="h-24 w-4/5 rounded-2xl" />
        <Skeleton className="h-12 w-full rounded-full" />
      </section>
    </div>
  );
}

/** Settings pages (inside the settings frame): form cards. */
export function SettingsSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <section className="grid gap-4 rounded-3xl border border-border bg-surface p-5">
        <Skeleton className="h-5 w-40 rounded-lg" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="grid gap-2">
              <Skeleton className="h-3 w-20 rounded-lg" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ))}
        </div>
        <Skeleton className="h-11 w-32 rounded-full" />
      </section>
    </div>
  );
}
