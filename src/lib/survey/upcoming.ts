import { siteOf, type LatLng } from "@/lib/geo";

/** A booked survey for the home card «معاينات قادمة». */
export type UpcomingSurvey = { number: string; date: string; time: string | null; client: { number: string; name: string }; site: LatLng | null };

type Row = {
  number: string;
  visit_date: string | null;
  visit_time: string | null;
  latitude: number | null;
  longitude: number | null;
  client: { number: string; name: string; latitude: number | null; longitude: number | null } | null;
};

/**
 * Booked visits from today (Riyadh day) within `days`, soonest first (on the same day a set time
 * comes before none); where to go = the survey's own site, else the client's.
 */
export function upcomingSurveys(rows: Row[], today: string, days = 14): UpcomingSurvey[] {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  const last = end.toISOString().slice(0, 10);
  return rows
    .filter((r): r is Row & { visit_date: string; client: NonNullable<Row["client"]> } => !!r.visit_date && !!r.client && r.visit_date >= today && r.visit_date <= last)
    .map((r) => ({
      number: r.number,
      date: r.visit_date,
      time: r.visit_time ? r.visit_time.slice(0, 5) : null,
      client: { number: r.client.number, name: r.client.name },
      site: siteOf({ latitude: r.latitude, longitude: r.longitude }) ?? siteOf({ latitude: r.client.latitude, longitude: r.client.longitude }),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99").localeCompare(b.time ?? "99"));
}
