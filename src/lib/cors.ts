// CORS for the public widget endpoints (storefront origins only).
// One desk serves multiple brands, so every brand's storefront origin must be
// listed. CHAT_ALLOWED_ORIGINS (comma-separated) overrides this default when set;
// keep that env var in sync with the brands below when adding one.
const DEFAULT_ALLOWED_ORIGINS =
  "https://livingwellwithdrmichelle.com,https://www.livingwellwithdrmichelle.com," +
  "https://longertogetherpet.com,https://www.longertogetherpet.com";
const ALLOWED_ORIGINS = new Set(
  (process.env.CHAT_ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS).split(",").map((s) => s.trim())
);

export function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
