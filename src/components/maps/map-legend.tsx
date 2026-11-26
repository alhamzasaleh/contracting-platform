import { PIN_TONE, type PinTone } from "./map-tones";

/** The map's colour key (same colours as the pins). */
export function MapLegend({ items }: { items: [PinTone, string][] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
      {items.map(([tone, label]) => (
        <li key={tone} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-3 rounded-full border-2 border-white shadow" style={{ background: PIN_TONE[tone] }} />
          {label}
        </li>
      ))}
    </ul>
  );
}
