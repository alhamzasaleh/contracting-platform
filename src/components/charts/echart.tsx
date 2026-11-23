"use client";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import * as React from "react";

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, CanvasRenderer]);

export type EChartOption = echarts.EChartsCoreOption;

/** Reads the identity colours from CSS variables so charts follow light/dark mode. */
export function chartColours() {
  if (typeof window === "undefined") return { clay: "#B5653E", basalt: "#22262A", sand: "#D9CBB5", text: "#22262A", muted: "#5C5850", border: "#E0D8CA", danger: "#A23B3B", success: "#2F6B4F", surface: "#F7F5F0" };
  const s = getComputedStyle(document.documentElement);
  const v = (n: string, f: string) => s.getPropertyValue(n).trim() || f;
  return {
    clay: v("--clay", "#B5653E"),
    basalt: v("--basalt", "#22262A"),
    sand: v("--sand", "#D9CBB5"),
    text: v("--foreground", "#22262A"),
    muted: v("--muted-foreground", "#5C5850"),
    border: v("--border", "#E0D8CA"),
    danger: v("--danger", "#A23B3B"),
    success: v("--success", "#2F6B4F"),
    surface: v("--surface", "#F7F5F0"),
  };
}

/**
 * Interactive, animated chart (Apache ECharts, tree-shaken). `onPick` gets the
 * clicked data index — used to drill down to the details behind a number.
 */
export function EChart({ option, height = 280, onPick, label }: { option: EChartOption; height?: number; onPick?: (index: number) => void; label: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const chart = React.useRef<echarts.ECharts | null>(null);
  const pick = React.useRef(onPick);
  React.useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  React.useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.current = c;
    c.on("click", (e) => {
      if (typeof e.dataIndex === "number") pick.current?.(e.dataIndex);
    });
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  React.useEffect(() => {
    chart.current?.setOption({ textStyle: { fontFamily: "inherit" }, animationDuration: 700, ...option }, true);
  }, [option]);

  return <div ref={ref} role="img" aria-label={label} style={{ height }} className="w-full" />;
}
