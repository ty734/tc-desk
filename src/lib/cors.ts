// CORS for the public widget endpoints (storefront origins only).
const ALLOWED_ORIGINS = new Set(
  (process.env.CHAT_ALLOWED_ORIGINS ?? "https://livingwellwithdrmichelle.com,https://www.livingwellwithdrmichelle.com")
    .split(",")
    .map((s) => s.trim())
);

export function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
