import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Static security headers. The Content-Security-Policy is per-request (it
 * carries a nonce), so it is set in src/proxy.ts instead.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: false,
  // headless Chromium for server-side PDFs: kept out of the bundle, its binary shipped with the PDF routes
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/pdf/[...doc]": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/p/[number]/[token]/pdf/[doc]": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: { bodySizeLimit: "6mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // «شركاء النجاح» lived at /marketers before it was renamed (owner, Nov 2026)
  async redirects() {
    return [{ source: "/marketers", destination: "/partners", permanent: true }];
  },
};

export default withNextIntl(nextConfig);
