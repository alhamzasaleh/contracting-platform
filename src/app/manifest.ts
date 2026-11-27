import type { MetadataRoute } from "next";
import ar from "../../messages/ar.json";

/** Installable app (PWA) — "Add to Home Screen" on iPad / iPhone, "Install" on Android. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: ar.app.name,
    short_name: ar.app.name,
    description: ar.app.tagline,
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // Android's splash = this colour + the icon (a basalt square): the same basalt, so no box shows
    background_color: "#22262A",
    theme_color: "#22262A",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
