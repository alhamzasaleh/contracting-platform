import { Skeleton } from "@/components/ui/skeleton";

/** Shown instantly while a page's data loads (route transitions feel immediate on site). */
export default function Loading() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <Skeleton className="h-9 w-56 rounded-xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-3xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-3xl" />
      <Skeleton className="h-40 rounded-3xl" />
    </div>
  );
}
