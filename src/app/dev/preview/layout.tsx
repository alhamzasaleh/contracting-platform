import { notFound } from "next/navigation";
import { isDesignPreviewEnabled } from "@/env";

export const metadata = { robots: { index: false, follow: false } };

export default function PreviewRootLayout({ children }: { children: React.ReactNode }) {
  if (!isDesignPreviewEnabled()) notFound();
  return children;
}
