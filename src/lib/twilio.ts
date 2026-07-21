import twilio from "twilio";

// Twilio voice-channel helpers (Phase 1: inbound voicemail).
//
// One Twilio account serves BOTH brands; per-brand routing is by the dialed
// number (Inbox.twilioNumber). Secrets live in env, never the DB:
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN
//
// Every Twilio callback is authenticated with the X-Twilio-Signature header
// (HMAC of the exact URL + POST params, keyed by the auth token) — the same
// raw-request-first pattern as the Meta webhook (src/app/api/webhooks/meta).

export function twilioAuthToken(): string | undefined {
  return process.env.TWILIO_AUTH_TOKEN || undefined;
}

export function twilioAccountSid(): string | undefined {
  return process.env.TWILIO_ACCOUNT_SID || undefined;
}

/**
 * True once the softphone env is in place (API Key + TwiML App). Until then the
 * inbound webhook must NOT ring agents (no browser can register), so it falls
 * back to Phase-1 voicemail. Lets Phase 2 deploy safely before the env is set.
 */
export function softphoneConfigured(): boolean {
  return !!(
    process.env.TWILIO_API_KEY_SID &&
    process.env.TWILIO_API_KEY_SECRET &&
    process.env.TWILIO_TWIML_APP_SID
  );
}

/**
 * Mint a Twilio Voice access token for a browser softphone (Phase 2). Identity
 * is the agent's user id, so the inbound webhook can <Dial><Client>{id}</Client>
 * to reach them. Needs an API Key (not the Auth Token) to sign, plus the TwiML
 * App SID that governs outbound calls (Phase 3). Throws if unconfigured.
 */
export function mintVoiceToken(identity: string, ttlSeconds = 3600): string {
  const accountSid = twilioAccountSid();
  const apiKeySid = process.env.TWILIO_API_KEY_SID || undefined;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET || undefined;
  const appSid = process.env.TWILIO_TWIML_APP_SID || undefined;
  if (!accountSid || !apiKeySid || !apiKeySecret) {
    throw new Error("Twilio voice token env not configured (need ACCOUNT_SID, API_KEY_SID, API_KEY_SECRET)");
  }
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, { identity, ttl: ttlSeconds });
  token.addGrant(
    new VoiceGrant({
      // outgoingApplicationSid enables outbound (Phase 3); harmless if unset now.
      outgoingApplicationSid: appSid,
      incomingAllow: true, // let the inbound <Dial><Client> reach this identity
    }),
  );
  return token.toJwt();
}

/**
 * The exact public URL Twilio called, rebuilt from the proxy headers. Twilio's
 * signature covers that URL verbatim, so we must reflect what the edge received
 * (Vercel and ngrok both front the app) rather than trust req.url's host.
 */
export function twilioRequestUrl(req: Request): string {
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(/:$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  return `${proto}://${host}${u.pathname}${u.search}`;
}

/**
 * Validate the X-Twilio-Signature. Fails CLOSED in production. In dev without a
 * token configured yet it warns and allows — Twilio can't reach localhost
 * without a tunnel anyway, and once a tunnel is up the real token is present.
 */
export function validateTwilioSignature(
  req: Request,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  const token = twilioAuthToken();
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      console.error("[twilio] TWILIO_AUTH_TOKEN not set in this environment — rejecting webhook");
      return false;
    }
    console.warn("[twilio] TWILIO_AUTH_TOKEN unset — skipping signature check (dev only)");
    return true;
  }
  if (!signature) return false;
  return twilio.validateRequest(token, signature, twilioRequestUrl(req), params);
}

/** Parse a Twilio form-encoded callback body into the plain params object
 *  that both our handlers and validateRequest expect. */
export async function readTwilioParams(req: Request): Promise<Record<string, string>> {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";
  return params;
}

/** Download a call recording's audio (auth-protected on Twilio) as a buffer so
 *  we can re-host it on Vercel Blob like any other attachment. */
export async function downloadTwilioRecording(
  recordingUrl: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const sid = twilioAccountSid();
  const token = twilioAuthToken();
  if (!sid || !token) throw new Error("Twilio credentials not configured");
  const url = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
    },
  });
  if (!res.ok) throw new Error(`recording download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType: res.headers.get("content-type") || "audio/mpeg" };
}

/** Human-friendly caller label for board cards: +18015551234 → (801) 555-1234. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
