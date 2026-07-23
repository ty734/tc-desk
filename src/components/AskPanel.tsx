"use client";

import { useEffect, useRef, useState } from "react";

// Global internal copilot. A floating "Ask" button (sage) sits bottom-right on
// every logged-in screen; clicking it opens a slide-over chat that talks to
// /api/agent-assist. Read-only research assistant over the same KB + live
// Shopify/Recharge lookups the customer widget uses.

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What's our return policy on opened tooth powder?",
  "Look up orders for ",
  "How do you use the remineralizing powder?",
  "Is this subscription active? ",
];

export default function AskPanel() {
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

  // Cmd/Ctrl+K toggles the panel from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-grow the composer so longer questions are fully visible instead of a
  // 1-line sliver. Runs on every input change and whenever the panel opens.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [input, open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...messages, { role: "user" as const, content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent-assist", {
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
        { role: "assistant", content: "Network error reaching the copilot. Try again." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Ask the copilot (Ctrl/Cmd+K)"
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-violet-700 hover:bg-violet-800 text-white shadow-lg hover:shadow-xl transition-all px-5 py-3 font-semibold"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3c-4.97 0-9 3.58-9 8 0 1.63.56 3.13 1.5 4.39L3 20l4.06-1.09c1.24.44 2.55.6 3.94.6 4.97 0 9-3.58 9-8s-4.03-8-9-8z"
              fill="#fff"
              opacity="0.18"
            />
            <path
              d="M8.5 9.5c.2-1 1.1-1.8 2.3-1.8 1.3 0 2.3.9 2.3 2.1 0 1.5-1.7 1.7-2 3M11 15.2h.01"
              stroke="#fff"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Ask
        </button>
      )}

      {/* Slide-over */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-violet-50">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-violet-700 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M8.5 9.5c.2-1 1.1-1.8 2.3-1.8 1.3 0 2.3.9 2.3 2.1 0 1.5-1.7 1.7-2 3M11 15.2h.01"
                      stroke="#fff"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div>
                  <div className="font-bold text-violet-900 leading-tight">Support Copilot</div>
                  <div className="text-xs text-violet-700/70 leading-tight">
                    KB + live order &amp; subscription lookup
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
                    Ask about Living Well policies and products, or look up a customer&apos;s live
                    orders and subscriptions by email. Read-only — it never changes anything.
                  </p>
                  <div className="space-y-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setInput(s);
                          inputRef.current?.focus();
                        }}
                        className="block w-full text-left text-[13px] text-violet-800 bg-violet-50 hover:bg-violet-100 rounded-lg px-3 py-2 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-sm bg-violet-700 text-white px-4 py-2.5 text-sm whitespace-pre-wrap"
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
                  placeholder="Ask a question or look up a customer..."
                  className="flex-1 resize-y min-h-[72px] border border-gray-300 rounded-xl px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <button
                  onClick={() => send(input)}
                  disabled={busy || !input.trim()}
                  className="shrink-0 bg-violet-700 hover:bg-violet-800 disabled:opacity-40 text-white rounded-xl px-4 py-2 text-sm font-semibold"
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
