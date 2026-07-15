// Social reply drafting — evaluateAndDraft() (src/lib/autoresponder.ts)
// adapted for Facebook/Instagram comments and DMs (spec §3, §6, §7).
//
// Differences from the email acknowledgment flow:
// - The draft ANSWERS (KB-grounded) instead of only acknowledging, because a
//   human approves/edits before anything posts (autoSendMode defaults "off").
// - Returns { respond, confidence, intent, reply, flagReason } — confidence +
//   intent feed the moderation dial (spec §6); flagReason marks drafts the
//   compliance layer must keep away from auto-send (spec §7).
// - KB retrieval + the model call are injectable so the mock harness runs the
//   full pipeline with zero DB access and zero network.

import type { KbHit } from "@/lib/kb";

const MODEL = "claude-sonnet-5";

export const SOCIAL_INTENTS = [
  "order_status",
  "product_question",
  "ingredient_question",
  "usage_question",
  "shipping_question",
  "subscription_question",
  "price_promo",
  "complaint",
  "praise",
  "health_sensitive",
  "spam",
  "other",
] as const;
export type SocialIntent = (typeof SOCIAL_INTENTS)[number];

export type SocialDraftInput = {
  platform: "facebook" | "instagram";
  kind: "comment" | "dm";
  fromName: string | null;
  text: string;
  inbox: { id: string; name: string };
};

export type SocialDraftDecision = {
  respond: boolean;
  confidence: number; // 0..1
  intent: SocialIntent;
  reply?: string;
  flagReason?: string; // set → never auto-send eligible; shown to the human
  reason: string;
};

export type SocialDraftDeps = {
  /** KB retrieval (src/lib/kb.ts searchKb in production; stubbed in the harness). */
  searchKb: (inboxId: string, query: string, limit?: number) => Promise<KbHit[]>;
  /** Model call: (system, user) → assistant text. Defaults to the Anthropic API. */
  complete?: (system: string, user: string) => Promise<string>;
};

// Cheap deterministic pre-filter — mirrors isLikelyNoise() for the social
// surface: empty/emoji-only comments and obvious spam get no draft.
export function isSocialNoise(text: string): string | null {
  const t = (text ?? "").trim();
  if (!t) return "empty message";
  // Emoji/punctuation-only (no letters or digits in any script).
  if (!/[\p{L}\p{N}]/u.test(t)) return "no text content (emoji/punctuation only)";
  if (/\b(check my (bio|profile)|dm me for (promo|followers)|earn \$\d+|crypto signals)\b/i.test(t))
    return "spam pattern";
  return null;
}

function systemPrompt(input: SocialDraftInput, kbContext: string): string {
  const surface =
    input.kind === "comment"
      ? `a PUBLIC ${input.platform === "facebook" ? "Facebook" : "Instagram"} comment — the whole internet can read your reply, so keep it short (1-3 sentences), friendly, and take anything personal (order details, health topics) to a private channel by inviting them to DM or email support`
      : `a private ${input.platform === "facebook" ? "Facebook Messenger" : "Instagram"} direct message — you may go slightly longer (2-5 sentences) and be more personal, but never share account or order specifics you were not given`;

  return `You are the social-engagement assistant for ${input.inbox.name} (Living Well with Dr. Michelle), a family-run company founded by Dr. Michelle Jorgensen, a dentist. The store sells dentist-formulated, fluoride-free oral care (hydroxyapatite tooth powders, toothpaste, mouthwash, remineralization supplements) and wellness products.

You are drafting a reply to ${surface}. A human teammate reviews every draft before it is sent, but write as if it will post verbatim.

VOICE: warm, clear, encouraging, never condescending. Plain language. No em dashes. No shame or fear framing. No hashtags. At most one emoji, and only when it fits naturally.

GROUNDING RULES (mandatory):
- Answer ONLY from the KNOWLEDGE BASE CONTEXT below. If it does not clearly answer the question, do NOT guess: draft a friendly reply that offers to help through support@livingwellwithdrmichelle.com or a DM, and lower your confidence.
- Quote prices and policy numbers only when they appear in the context.

COMPLIANCE RULES (mandatory — this is a health-products company and comment replies are public):
- NEVER diagnose any condition, and never tell anyone what their symptoms mean.
- NEVER use drug claims: treat, cure, prevent, heal, fights, kills, eliminates, reverses (for bacteria, disease, infection, or any condition). Use cosmetic/structure-function language only: supports, helps maintain, promotes, designed to.
- If the message involves a medical condition, symptoms, medication interactions, pregnancy, or a child's health issue: express care, do NOT advise, suggest they talk with their dentist or doctor, set intent to "health_sensitive", set a flag explaining why, and keep confidence at or below 0.3.
- Never promise refunds, replacements, discounts, or exceptions — that is a human decision. Offer to connect them with the team instead.

KNOWLEDGE BASE CONTEXT:
${kbContext || "(no knowledge base results found for this message)"}

DECIDE first whether to draft at all:
- respond=false for: spam, bot comments, trolling with nothing to answer, pure emoji reactions, and anything where silence is the right move.
- respond=true for: real questions, purchase intent, complaints (draft a de-escalating, no-promises reply), praise (draft a short warm thank-you), and sincere anything.

Return ONLY valid JSON, no prose, in this exact shape:
{"respond": true, "confidence": 0.0, "intent": "<one of: ${SOCIAL_INTENTS.join(" | ")}>", "reply": "<the reply text>", "flag": "<empty string, or a short reason this draft needs extra human care>"}
or
{"respond": false, "confidence": 0.0, "intent": "<intent>", "reply": "", "flag": ""}

confidence is YOUR 0-to-1 estimate that the reply is correct, fully KB-grounded, compliant, and safe to post without edits.`;
}

async function anthropicComplete(system: string, user: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("no API key");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`model error ${res.status}`);
  const data = await res.json();
  return (data.content ?? [])
    .filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text)
    .join("")
    .trim();
}

// Belt-and-braces server-side check on top of the prompt: a draft containing a
// drug-claim word is flagged no matter what the model reported (spec §7).
const DRUG_CLAIM_RE =
  /\b(treats?|cure[sd]?|prevents?|heals?|fights?|kills?|eliminates?|reverses?)\b/i;

export async function draftSocialReply(
  input: SocialDraftInput,
  deps: SocialDraftDeps
): Promise<SocialDraftDecision> {
  const noise = isSocialNoise(input.text);
  if (noise) {
    return { respond: false, confidence: 0, intent: "spam", reason: `pre-filter: ${noise}` };
  }

  let kbContext = "";
  try {
    const hits = await deps.searchKb(input.inbox.id, input.text.slice(0, 300));
    kbContext = hits
      .map((h) => `[${h.title ?? h.source}]\n${h.content}`)
      .join("\n\n---\n\n")
      .slice(0, 8000);
  } catch (err) {
    console.error("[social-draft] KB search failed", err);
  }

  const userContent = `New ${input.platform} ${input.kind === "dm" ? "direct message" : "comment"}:
From: ${input.fromName ?? "(unknown)"}

${input.text.slice(0, 3000)}`;

  let text: string;
  try {
    text = await (deps.complete ?? anthropicComplete)(systemPrompt(input, kbContext), userContent);
  } catch (err) {
    return { respond: false, confidence: 0, intent: "other", reason: `model error: ${String(err)}` };
  }

  try {
    const json = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
    if (json && typeof json.respond === "boolean") {
      const intent = SOCIAL_INTENTS.includes(json.intent) ? (json.intent as SocialIntent) : "other";
      const reply = typeof json.reply === "string" ? json.reply.trim() : "";
      let flagReason =
        typeof json.flag === "string" && json.flag.trim() ? json.flag.trim() : undefined;
      if (reply && DRUG_CLAIM_RE.test(reply)) {
        flagReason = `drafted reply contains a drug-claim word${flagReason ? `; ${flagReason}` : ""}`;
      }
      if (intent === "health_sensitive" && !flagReason) flagReason = "health-sensitive topic";
      const confidence = Math.max(0, Math.min(1, Number(json.confidence) || 0));
      return {
        respond: json.respond,
        confidence: flagReason ? Math.min(confidence, 0.3) : confidence,
        intent,
        reply: reply || undefined,
        flagReason,
        reason: json.respond ? "drafted" : "model declined",
      };
    }
  } catch {
    console.error("[social-draft] could not parse decision:", text.slice(0, 200));
  }
  return { respond: false, confidence: 0, intent: "other", reason: "unparseable decision" };
}
