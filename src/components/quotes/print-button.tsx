"use client";
import { Download, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Print (browser) and, when `pdfHref` is given, a server-made PDF download. */
export function PrintButton({ pdfHref }: { pdfHref?: string }) {
  const t = useTranslations("quotes");
  const [busy, setBusy] = React.useState(false);

  const download = async () => {
    if (!pdfHref) return;
    setBusy(true);
    try {
      const res = await fetch(pdfHref, { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "document.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      toast.error(t("pdfFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {pdfHref && (
        <Button onClick={download} loading={busy}>
          <Download /> {t("downloadPdf")}
        </Button>
      )}
      <Button variant={pdfHref ? "secondary" : "primary"} onClick={() => window.print()}>
        <Printer /> {pdfHref ? t("printOnly") : t("printOrPdf")}
      </Button>
    </div>
  );
}
