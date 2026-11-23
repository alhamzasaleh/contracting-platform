/**
 * Preview only: a neutral placeholder (single colour, transparent background)
 * standing in for the company's uploaded logo, to show how BrandLogo colours
 * it. The real logo comes from Settings → Branding; it is never redrawn here.
 */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 110"><rect x="2" y="2" width="236" height="106" rx="10" fill="none" stroke="#000" stroke-width="3" stroke-dasharray="10 8"/><text x="120" y="56" text-anchor="middle" font-family="sans-serif" font-size="34" font-weight="700" fill="#000">شعار المنشأة</text><text x="120" y="90" text-anchor="middle" font-family="sans-serif" font-size="20" letter-spacing="6" fill="#000">LOGO</text></svg>`;
export const SAMPLE_LOGO = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
