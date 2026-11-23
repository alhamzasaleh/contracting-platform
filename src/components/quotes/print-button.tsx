"use client";
import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  const t = useTranslations("quotes");
  return (
    <Button onClick={() => window.print()}>
      <Printer /> {t("printOrPdf")}
    </Button>
  );
}
