"use client";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { waHref } from "@/lib/whatsapp-link";

/** Opens the owner's WhatsApp with the message ready (nothing is sent until they tap Send). Hidden without a phone. */
export function WhatsAppButton({ phone, text, label, size = "sm", variant = "secondary" }: { phone: string | null | undefined; text: string; label: string; size?: "sm" | "md"; variant?: "secondary" | "primary" | "ghost" }) {
  const href = waHref(phone, text);
  if (!href) return null;
  return (
    <Button asChild size={size} variant={variant}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <MessageCircle /> {label}
      </a>
    </Button>
  );
}
