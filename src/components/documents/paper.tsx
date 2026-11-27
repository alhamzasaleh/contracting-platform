"use client";

import * as React from "react";
import { PAPER_WIDTH, paperScale } from "@/lib/paper";

const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * A document's sheet: laid out at its own width and scaled as a whole to fit the screen
 * (CSS zoom, so the page height follows), so a phone shows the same paper as a desktop —
 * pinch to read closer. Before the script runs, globals.css scales it from the screen width
 * (`.paper-sheet[data-w]`), so the first paint never overflows. Print: natural size.
 */
export function Paper({ width = PAPER_WIDTH, children }: { width?: number; children: React.ReactNode }) {
  const outer = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState<number | null>(null);

  useIsoLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => setScale(paperScale(el.clientWidth, width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={outer} className="paper-fit min-w-0">
      <div className="paper-sheet" data-w={width} style={{ width, ...(scale === null ? {} : { zoom: scale }) }}>
        {children}
      </div>
    </div>
  );
}
