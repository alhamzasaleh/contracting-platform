"use client";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OfflineRetry({ label }: { label: string }) {
  return (
    <Button className="justify-self-center" onClick={() => window.location.reload()}>
      <RefreshCw /> {label}
    </Button>
  );
}
