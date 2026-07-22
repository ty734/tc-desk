"use client";

import { useEffect, useRef, useState } from "react";

// KB Trainer widget — the write counterpart to the Ask copilot. A floating
// emerald "Train" button sits bottom-right, stacked ABOVE the violet Ask button
// (Ask owns bottom-right, the Softphone owns bottom-left). Only mounted for
// users on the KB_TRAINER_EMAILS allow-list (gated in layout.tsx). Clicking it
// opens a slide-over chat that talks to /api/kb-trainer, which can search and
// CORRECT the knowledge base the social bot drafts from.
//
// Other components (e.g. the "Train this" button on a suggested reply in
// TicketModal) can open it pre-loaded by dispatching:
//   window.dispatchEvent(new CustomEvent("kb-trainer:open", { detail: { seed } }))

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What does the bot currently say about hydroxyapatite percentage?",
  "Show me the corrections we've taught so far.",
  "The reply about shipping times is wrong — it's actually ",
  "Add a fact: our tooth powder is fluoride-free and ",
];

export default function TrainerPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Auto-grow the composer so a multi-line pre-seed (e.g. the "Train this"
  // context, which is several lines) is fully visible instead of a 1-line
  // sliver. Runs on every input change and whenever the panel opens/seeds.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [input, open]);

  // Open pre-loaded from elsewhere (e.g. TicketModal's "Train this" button).
  useEffect(() => {
    function onOpen(e: Event) {
      const seed = (e as CustomEvent<{ seed?: string }>).detail?.seed;
      setOpen(true);
      if (seed) {
        setInput(seed);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
    window.addEventListener("kb-trainer:open", onOpen);
    return () => window.removeEventListener("kb-trainer:open", onOpen);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...messages, { role: "user" as const, content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/kb-trainer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json().catch(() => ({}));
      const reply =
        typeof data?.reply === "string"
          ? data.reply
          : data?.error ?? "Something went wrong. Try again.";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Network error reaching the trainer. Try again." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Floating launcher — stacked above the Ask button (bottom-6 right-6). */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Train the social bot"
          className="fixed bottom-24 right-6 z-40 flex items-center gap-2 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white shadow-lg hover:shadow-xl transition-all px-5 py-3 font-semibold"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            {/* mortarboard / graduation cap = "train" */}
            <path d="M12 4 2 8l10 4 8-3.2V14" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 11v3.5c0 1.1 2.7 2.5 6 2.5s6-1.4 6-2.5V11" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Train
        </button>
      )}

      {/* Slide-over */}
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpen(false)} aria-hidden />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-emerald-50">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-emerald-700 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M12 4 2 8l10 4 8-3.2V14" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M6 11v3.5c0 1.1 2.7 2.5 6 2.5s6-1.4 6-2.5V11" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <div className="font-bold text-emerald-900 leading-tight">KB Trainer</div>
                  <div className="text-xs text-emerald-700/70 leading-tight">
                    Correct what the social bot knows
                  </div>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1"
                title="Close (Esc)"
              >
                ×
              </button>
            </div>

            {/* Transcript */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="text-sm text-gray-500">
                  <p className="mb-3">
                    Tell me how the bot answered wrong and what the right answer is — I&apos;ll
                    correct the knowledge base it drafts from. Changes apply to the next comment
                    immediately. Drafts are still reviewed by a human before anything posts.
                  </p>
                  <div className="space-y-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setInput(s);
                          inputRef.current?.focus();
                        }}
                        className="block w-full text-left text-[13px] text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg px-3 py-2 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-700 text-white px-4 py-2.5 text-sm whitespace-pre-wrap"
                        : "max-w-[92%] rounded-2xl rounded-bl-sm bg-gray-100 text-gray-800 px-4 py-2.5 text-sm whitespace-pre-wrap"
                    }
                  >
                    {m.content}
                  </div>
                </div>
              ))}

              {busy && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-3">
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="border-t border-gray-200 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={3}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder="Describe the correction, or ask what the bot knows…"
                  className="flex-1 resize-y min-h-[72px] border border-gray-300 rounded-xl px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  onClick={() => send(input)}
                  disabled={busy || !input.trim()}
                  className="shrink-0 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white rounded-xl px-4 py-2 text-sm font-semibold"
                >
                  Send
                </button>
              </div>
              {messages.length > 0 && (
                <button
                  onClick={() => setMessages([])}
                  className="mt-2 text-xs text-gray-400 hover:text-gray-600"
                >
                  Clear conversation
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
