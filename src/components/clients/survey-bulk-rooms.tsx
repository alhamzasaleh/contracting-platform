"use client";
import { ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useActionRunner } from "@/components/forms/form-kit";
import type { ActionResult } from "@/lib/actions";
import { bulkTargets, type BulkScope } from "@/lib/survey/schema";
import { roomSize } from "@/lib/survey/plan";
import { cn } from "@/lib/utils";
import { Pills } from "./pills";

type Room = { id: string; name: string; unit_label: string | null };
type Tri = "keep" | "yes" | "no";
type Board = "keep" | "normal" | "moisture" | "fire";
type Zone = "keep" | "normal" | "wet" | "decorative";
const NO_FLOOR = "\u0000"; // the group of rooms without a floor name

/**
 * «تطبيق على عدة غرف» (owner, Nov 2026): pick all rooms, one floor or ticked rooms, set only the
 * services to change («بدون تغيير» leaves the rest of each room as it is), then fix the exceptions
 * room by room.
 */
export function SurveyBulkRooms({ surveyId, rooms, bulk }: { surveyId: string; rooms: Room[]; bulk?: (input: Record<string, unknown>) => Promise<ActionResult<{ n: number }>> }) {
  const t = useTranslations("survey");
  const { run, pending } = useActionRunner();
  const [open, setOpen] = React.useState(false);
  const [scope, setScope] = React.useState<"all" | "floor" | "pick">("all");
  const [floor, setFloor] = React.useState<string>(NO_FLOOR);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [gypsum, setGypsum] = React.useState<Tri>("keep");
  const [board, setBoard] = React.useState<Board>("keep");
  const [walls, setWalls] = React.useState<Tri>("keep");
  const [zone, setZone] = React.useState<Zone>("keep");
  const [ceiling, setCeiling] = React.useState<Tri>("keep");
  const [height, setHeight] = React.useState("");

  const floors = [...new Set(rooms.map((r) => r.unit_label ?? NO_FLOOR))];
  const target: BulkScope = scope === "all" ? { kind: "all" } : scope === "floor" ? { kind: "floor", floor: floor === NO_FLOOR ? null : floor } : { kind: "pick", ids: [...picked] };
  const ids = bulkTargets(rooms, target);
  const h = height.trim() ? roomSize(height, 30) : undefined;
  const patch = {
    ...(gypsum !== "keep" && { gypsum_ceiling: gypsum === "yes" }),
    ...(board !== "keep" && { ceiling_board: board }),
    ...(walls !== "keep" && { paint_walls: walls === "yes" }),
    ...(zone !== "keep" && { wall_zone: zone }),
    ...(ceiling !== "keep" && { paint_ceiling: ceiling === "yes" }),
    ...(h != null && { height_m: String(h) }),
  };
  const changes = Object.keys(patch).length;

  const reset = () => {
    setGypsum("keep");
    setBoard("keep");
    setWalls("keep");
    setZone("keep");
    setCeiling("keep");
    setHeight("");
    setPicked(new Set());
  };
  const start = () => {
    setFloor(floors[0] ?? NO_FLOOR);
    setOpen(true);
  };

  const apply = () =>
    run(bulk && (() => bulk({ survey_id: surveyId, ids, patch })), {
      onSuccess: () => {
        toast.success(t("bulkDone", { n: ids.length }));
        setOpen(false);
        reset();
      },
    });

  const tri = (label: string, value: Tri, set: (v: Tri) => void) => (
    <div className="grid gap-1.5">
      <p className="text-[13px] font-semibold">{label}</p>
      <Pills label={label} value={value} options={["keep", "yes", "no"] as const} render={(v) => t(`bulk_${v}`)} onChange={set} />
    </div>
  );

  if (rooms.length === 0) return null;
  return (
    <>
      <Button size="sm" variant="secondary" onClick={start}>
        <ListChecks /> {t("bulkButton")}
      </Button>
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : pending ? undefined : (setOpen(false), reset()))}>
        <DialogContent className="max-w-2xl" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("bulkTitle")}</DialogTitle>
            <DialogDescription>{t("bulkHint")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            <div className="grid gap-2">
              <p className="text-[13px] font-bold">{t("bulkWhich")}</p>
              <Pills label={t("bulkWhich")} value={scope} options={["all", "floor", "pick"] as const} render={(v) => t(`bulkScope_${v}`)} onChange={setScope} />
              {scope === "floor" && (
                <Pills label={t("bulkScope_floor")} value={floor} options={floors} render={(f) => (f === NO_FLOOR ? t("bulkNoFloor") : f)} onChange={setFloor} />
              )}
              {scope === "pick" && (
                <ul className="grid max-h-60 gap-1 overflow-y-auto rounded-2xl border border-border p-2 sm:grid-cols-2">
                  {rooms.map((r) => (
                    <li key={r.id}>
                      <label className={cn("flex items-center gap-2 rounded-xl px-2 py-1.5 text-[14px]", picked.has(r.id) && "bg-primary/5")}>
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--primary)]"
                          checked={picked.has(r.id)}
                          onChange={() => setPicked((s) => (s.has(r.id) ? new Set([...s].filter((x) => x !== r.id)) : new Set([...s, r.id])))}
                        />
                        <span className="min-w-0 truncate">{r.name}</span>
                        {r.unit_label && <span className="shrink-0 text-[12px] text-muted-foreground">{r.unit_label}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[12px] text-muted-foreground">{t("bulkCount", { n: ids.length })}</p>
            </div>

            <div className="grid gap-4 rounded-2xl bg-surface-sunken/70 p-4">
              {tri(t("gypsumCeiling"), gypsum, setGypsum)}
              {gypsum !== "no" && (
                <div className="grid gap-1.5">
                  <p className="text-[13px] font-semibold">{t("boardType")}</p>
                  <Pills label={t("boardType")} value={board} options={["keep", "normal", "moisture", "fire"] as const} render={(b) => (b === "keep" ? t("bulk_keep") : t(`board_${b}`))} onChange={setBoard} />
                </div>
              )}
              {tri(t("paintWalls"), walls, setWalls)}
              {walls !== "no" && (
                <div className="grid gap-1.5">
                  <p className="text-[13px] font-semibold">{t("wallZone")}</p>
                  <Pills label={t("wallZone")} value={zone} options={["keep", "normal", "wet", "decorative"] as const} render={(z) => (z === "keep" ? t("bulk_keep") : t(`zone_${z}`))} onChange={setZone} />
                </div>
              )}
              {tri(t("paintCeiling"), ceiling, setCeiling)}
              <label className="grid max-w-48 gap-1.5 text-[13px] font-semibold">
                {t("bulkHeight")}
                <Input inputMode="decimal" dir="ltr" className={cn("font-latin", height.trim() && h == null && "border-warning")} placeholder={t("bulk_keep")} value={height} onChange={(e) => setHeight(e.target.value)} />
              </label>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button onClick={apply} loading={pending} disabled={ids.length === 0 || changes === 0 || (height.trim() !== "" && h == null)}>
              {t("bulkApply", { n: ids.length })}
            </Button>
            <Button variant="ghost" onClick={() => (setOpen(false), reset())} disabled={pending}>
              {t("aiBack")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
