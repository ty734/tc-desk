// Shared TwiML builders for the voice channel. Kept tiny and dependency-free;
// every voice route returns text/xml via twiml().

const ESCAPE: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  "'": "&apos;",
  '"': "&quot;",
};

export function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ESCAPE[c]);
}

/** Wrap inner TwiML verbs in a <Response> and return it as a text/xml Response. */
export function twiml(inner: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/** Greet the caller and record a voicemail (recording handled by /api/voice/recording). */
export function voicemailPrompt(inboxName: string): string {
  const greeting =
    `Thank you for calling ${inboxName}. No one is available to take your call right now. ` +
    `Please leave a message after the tone, and we'll get back to you as soon as possible.`;
  return (
    `<Say voice="alice">${xmlEscape(greeting)}</Say>` +
    `<Record maxLength="120" playBeep="true" trim="trim-silence" ` +
    `recordingStatusCallback="/api/voice/recording" recordingStatusCallbackEvent="completed" />` +
    `<Say voice="alice">Thank you. Goodbye.</Say><Hangup/>`
  );
}

/**
 * Ring every online agent's browser softphone at once (first to answer wins).
 * When the dial finishes, Twilio POSTs the outcome to /api/voice/dial-status,
 * which drops to voicemail if nobody picked up. answerOnBridge keeps the caller
 * hearing ringback (not dead air) until an agent connects.
 */
export function dialAgents(userIds: string[]): string {
  const clients = userIds.map((id) => `<Client>${xmlEscape(id)}</Client>`).join("");
  return (
    `<Dial timeout="25" answerOnBridge="true" ` +
    `action="/api/voice/dial-status" method="POST">${clients}</Dial>`
  );
}
