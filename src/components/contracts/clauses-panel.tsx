"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { ActionResult } from "@/lib/actions";
import type { ContractTermsConfig } from "@/lib/contracts/terms";
import { ClausesEditor } from "./clauses-editor";

/** Settings → contract clauses (company template), or one contract's clauses before acceptance. */
export function ClausesPanel({
  initial, save, template, mode,
}: {
  initial: ContractTermsConfig;
  save?: (terms: ContractTermsConfig) => Promise<ActionResult>;
  /** company template, offered as a starting point on a contract */
  template?: ContractTermsConfig | null;
  mode: "template" | "contract";
}) {
  const t = useTranslations("clauses");
  const tc = useTranslations("common");
  const router = useRouter();
  const [terms, setTerms] = React.useState<ContractTermsConfig>(initial);
  const [pending, start] = React.useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "template" ? t("pageTitle") : t("contractTitle")}</CardTitle>
        <CardDescription>{mode === "template" ? t("pageHint") : t("contractHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ClausesEditor value={terms} onChange={setTerms} />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          loading={pending}
          onClick={() =>
            start(async () => {
              if (!save) return void toast(t("saved"));
              const r = await save(terms);
              if (r.ok) {
                toast.success(t("saved"));
                router.refresh();
              } else toast.error(tc("error"));
            })
          }
        >
          {t("save")}
        </Button>
        {template && mode === "contract" && (
          <Button variant="secondary" onClick={() => setTerms(template)}>
            {t("fromTemplate")}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
