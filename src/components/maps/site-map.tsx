"use client";
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import * as React from "react";
import type { LatLng } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { PIN_TONE, type PinTone } from "./map-tones";

/**
 * Map (owner, Nov 2026): OpenStreetMap tiles drawn with Leaflet — no account, no key. Pins are
 * coloured dots (no image files); labels and links are set as text (never HTML), so a client's or
 * project's name can't inject anything. `pick` turns it into a picker: tap the map or drag the pin.
 */
export type MapPin = LatLng & { id: string; tone: PinTone; label?: string; href?: string };
const TONE = PIN_TONE;
const RIYADH: LatLng = { lat: 24.7136, lng: 46.6753 };

export function SiteMap({
  pins,
  circle,
  pick,
  className,
  label,
  openLabel,
}: {
  pins: MapPin[];
  circle?: LatLng & { radius: number };
  /** picker: the chosen point (draggable) and what to do when it moves */
  pick?: { value: LatLng | null; onChange: (p: LatLng) => void };
  className?: string;
  /** accessible name of the map */
  label: string;
  /** text of a pin's link («فتح المشروع») */
  openLabel?: string;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const map = React.useRef<Leaflet.Map | null>(null);
  const layer = React.useRef<Leaflet.LayerGroup | null>(null);
  const lib = React.useRef<typeof Leaflet | null>(null);
  const onPick = React.useRef(pick?.onChange);
  // the latest picker callback, for Leaflet's events (set after render)
  React.useEffect(() => {
    onPick.current = pick?.onChange;
  });
  const [ready, setReady] = React.useState(false);

  // create the map once (Leaflet touches window: loaded in the browser only)
  React.useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((mod) => {
      const L = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as unknown as typeof Leaflet);
      if (cancelled || !box.current || map.current) return;
      lib.current = L;
      const m = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([RIYADH.lat, RIYADH.lng], 11);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
      m.attributionControl.setPrefix(false);
      m.on("click", (e: Leaflet.LeafletMouseEvent) => onPick.current?.({ lat: round6(e.latlng.lat), lng: round6(e.latlng.lng) }));
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  // draw pins / circle / picker, and fit the view
  const key = JSON.stringify([pins, circle, pick?.value ?? null]);
  React.useEffect(() => {
    const L = lib.current;
    const m = map.current;
    const g = layer.current;
    if (!ready || !L || !m || !g) return;
    g.clearLayers();
    const points: Leaflet.LatLngExpression[] = [];
    let ring: Leaflet.Circle | null = null;
    if (circle) {
      ring = L.circle([circle.lat, circle.lng], { radius: circle.radius, color: "#C62828", weight: 1.5, dashArray: "6 6", fillOpacity: 0.06 });
      g.addLayer(ring);
    }
    for (const p of pins) {
      const dot = L.circleMarker([p.lat, p.lng], { radius: p.tone === "site" ? 9 : 7, color: "#FFFFFF", weight: 2, fillColor: TONE[p.tone], fillOpacity: 1 });
      if (p.label || p.href) dot.bindPopup(popup(p, openLabel));
      if (p.label) dot.bindTooltip(text(p.label));
      g.addLayer(dot);
      points.push([p.lat, p.lng]);
    }
    if (pick) {
      if (pick.value) {
        const marker = L.marker([pick.value.lat, pick.value.lng], {
          draggable: true,
          icon: L.divIcon({ className: "", html: `<span style="display:block;width:22px;height:22px;border-radius:9999px;background:${TONE.site};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
          keyboard: true,
        });
        marker.on("dragend", () => {
          const ll = marker.getLatLng();
          onPick.current?.({ lat: round6(ll.lat), lng: round6(ll.lng) });
        });
        g.addLayer(marker);
        points.push([pick.value.lat, pick.value.lng]);
      }
    }
    // the whole ring stays in view (the 300 m around the site), else all the pins
    if (ring) m.fitBounds(ring.getBounds().extend(L.latLngBounds(points.length ? points : [ring.getLatLng()])), { padding: [20, 20], maxZoom: 17 });
    else if (points.length === 1) m.setView(points[0], Math.max(m.getZoom(), 16));
    else if (points.length > 1) m.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` holds every input
  }, [ready, key, openLabel]);

  return (
    <div dir="ltr" className={cn("relative isolate z-0 overflow-hidden rounded-2xl border border-border bg-surface-sunken", className ?? "h-72")}>
      <div ref={box} role="region" aria-label={label} className="size-full" />
    </div>
  );
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** A text node (never HTML). */
function text(s: string): HTMLElement {
  const el = document.createElement("span");
  el.textContent = s;
  return el;
}

/** The pin's popup: its label and, for in-app links only, a link. */
function popup(p: MapPin, openLabel?: string): HTMLElement {
  const el = document.createElement("div");
  el.style.direction = "rtl";
  if (p.label) {
    const b = document.createElement("strong");
    b.textContent = p.label;
    el.appendChild(b);
  }
  if (p.href && p.href.startsWith("/")) {
    const a = document.createElement("a");
    a.href = p.href;
    a.textContent = openLabel ?? p.href;
    a.style.display = "block";
    el.appendChild(a);
  }
  return el;
}
