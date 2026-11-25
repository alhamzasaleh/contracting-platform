"use client";
import { useTranslations } from "next-intl";
import { useFormatter } from "@/components/formatter-provider";
import type { ContractCommission } from "@/lib/data/marketers";

/** «مكافأة شريك النجاح — فلان ٥٪»: internal line on the project cost card and the contract page. */
export function RewardLine({ reward }: { reward: NonNullable<ContractCommission> }) {
  const t = useTranslations("marketers");
  const { fmt } = useFormatter();
  return (
    <span className="flex flex-wrap justify-between gap-2" data-testid="reward-line">
      <span className="text-muted-foreground">{t("rewardLine", { name: reward.marketer, percent: fmt.number(reward.percent) })}</span>
      <span className="font-latin font-bold tabular-nums">
        {fmt.money(reward.amount)} · {t(`status_${reward.status}`)}
      </span>
    </span>
  );
}
