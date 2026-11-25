"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DocNo } from "@/components/doc-no";
import { useFormatter } from "@/components/formatter-provider";
import type { ContractCommission } from "@/lib/data/marketers";

/**
 * «مكافأة شريك النجاح — فلان ٥٪»: internal line on the project cost card and the contract page.
 * The partner opens /partners (marketers.manage or finance.view), the voucher its print page (finance.view).
 */
export function RewardLine({ reward, base = "", noLinks = false }: { reward: NonNullable<ContractCommission>; base?: string; /** inside a card that is itself a link (no nested links) */ noLinks?: boolean }) {
  const t = useTranslations("marketers");
  const { fmt } = useFormatter();
  const label = t("rewardLine", { name: reward.marketer, percent: fmt.number(reward.percent) });
  return (
    <span className="flex flex-wrap justify-between gap-2" data-testid="reward-line">
      {reward.canOpenPartners && !noLinks ? (
        <Link href={`${base}/partners${reward.id ? `?k=${reward.id}` : ""}`} className="text-muted-foreground hover:text-primary hover:underline">
          {label}
        </Link>
      ) : (
        <span className="text-muted-foreground">{label}</span>
      )}
      <span className="font-latin font-bold tabular-nums">
        {fmt.money(reward.amount)} · {t(`status_${reward.status}`)}
        {reward.voucher && (
          <>
            {" · "}
            {reward.canOpenVoucher && !noLinks ? (
              <Link href={`${base}/print/payment-vouchers/${reward.voucher}`} className="hover:underline">
                <DocNo>{reward.voucher}</DocNo>
              </Link>
            ) : (
              <DocNo>{reward.voucher}</DocNo>
            )}
          </>
        )}
      </span>
    </span>
  );
}
