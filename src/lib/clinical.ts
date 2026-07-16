/**
 * Clinical-content classifier for the KB.
 *
 * Living Well's support KB is a merge of e-commerce support AND Dr. Michelle's
 * dental-practice FAQ (root canals, implants, cavitations, ozone, cone beam CT,
 * surgery, airway...). The storefront bot must never speak that material, so we
 * tag it at ingest and filter it at retrieval. Belt (this) and braces (the
 * CLINICAL SCOPE block in the chat system prompt).
 *
 * PRECISION OVER RECALL, deliberately. Over-tagging silently blinds the bot to
 * content it SHOULD answer, which is worse than a prompt-level refusal, because
 * nobody sees it happen. When unsure, leave it public and let the prompt catch it.
 */

/** Unambiguously clinical: a procedure, diagnosis, or treatment decision. */
const CLINICAL_TERMS = [
  "root canal",
  "cavitation",
  "ozone",
  "oral surgery",
  "extraction",
  "cone beam",
  "ct scan",
  "x-ray",
  "xray",
  "amalgam",
  "abscess",
  "periodontitis",
  "gingivitis",
  "bone graft",
  "bone loss",
  "airway",
  "sleep apnea",
  "tmj",
  "myobrace",
  "frenectomy",
  "tongue tie",
  "oil pulling",
  "implant",
  "anesthetic",
  "novocaine",
  "sedation",
  "wisdom teeth",
  "orthodontic",
  "braces",
  "retainer",
  "night guard",
  "dry socket",
  "gum graft",
  "deep cleaning",
  "scaling and root planing",
];

/**
 * NOT clinical even though they contain a clinical word — these are ours to answer.
 * "Is your powder safe with crowns?" is product compatibility, a high-volume,
 * legitimate storefront question. Tagging it clinical would blind the bot to it.
 */
const PRODUCT_CONTEXT = [
  /\b(safe|use|using|compatible|okay|ok|fine)\b[^.?]{0,50}\b(with|for|on|around)\b[^.?]{0,50}\b(crown|veneer|implant|brace|filling|bridge|restoration|retainer)/i,
  /\b(crown|veneer|implant|brace|filling|bridge|restoration)s?\b[^.?]{0,40}\b(safe|damage|harm|stain|scratch)/i,
];

/** Anything about the dental PRACTICE rather than the store. */
const PRACTICE_CONTEXT = [
  /\btotal care dental\b/i,
  /\b(appointment|insurance|copay|office hours|new patient|book(ing)? a visit)\b/i,
];

export type KbScope = "public" | "clinical";

export function classifyScope(title: string | null, content: string): KbScope {
  const hay = `${title ?? ""} ${content}`.toLowerCase();

  // Product-compatibility questions stay public even if they name a restoration.
  if (PRODUCT_CONTEXT.some((re) => re.test(hay))) return "public";

  if (CLINICAL_TERMS.some((t) => hay.includes(t))) return "clinical";
  if (PRACTICE_CONTEXT.some((re) => re.test(hay))) return "clinical";

  // Symptom-driven "what should I do about my X" is clinical even without a
  // procedure word: that is a diagnosis request, which is exactly what we refuse.
  if (
    /\b(my|i have|i've had|been having)\b[^.?]{0,60}\b(tooth|teeth|gum|jaw|mouth)\b[^.?]{0,60}\b(ach|hurt|pain|bleed|swollen|sore|sensitive|infected|loose|broke|chipped|cracked)/i.test(
      hay,
    )
  ) {
    return "clinical";
  }

  return "public";
}
