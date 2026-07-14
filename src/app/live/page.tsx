"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui";

type SessionRow = {
  id: string;
  status: string;
  inbox: string;
  visitorName: string | null;
  visitorEmail: string | null;
  agent: { id: string; name: string } | null;
  waitingSince: string | null;
  updatedAt: string;
  preview: string;
  messageCount: number;
};
type ChatEntry = { role: string; content: string; name?: string; at?: string };

function ding() {
  try {
    const ctx = new AudioContext();
    const play = (freq: number, start: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.5);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + 0.55);
    };
    play(880, 0);
    play(1174, 0.18);
  } catch {
    // no audio permission — the visual highlight still shows
  }
}

export default function LiveChatPage() {
  const router = useRouter();
  const [checkedIn, setCheckedIn] = useState(false);
  const [onlineAgents, setOnlineAgents] = useState<{ id: string; name: string }[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openChat, setOpenChat] = useState<{ status: string; visitorName: string | null; visitorEmail: string | null; messages: ChatEntry[]; agent: { id: string; name: string } | null } | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const knownWaiting = useRef<Set<string>>(new Set());
  const checkedInRef = useRef(false);
  const msgsRef = useRef<HTMLDivElement>(null);

  const refreshSessions = useCallback(async () => {
    const res = await fetch("/api/live/sessions");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    setCheckedIn(data.checkedIn);
    checkedInRef.current = data.checkedIn;
    setOnlineAgents(data.onlineAgents);
    setSessions(data.sessions);
    // Ding on brand-new waiting chats (only when this agent is checked in).
    const waitingNow = new Set<string>(
      data.sessions.filter((s: SessionRow) => s.status === "waiting").map((s: SessionRow) => s.id)
    );
    for (const id of waitingNow) {
      if (!knownWaiting.current.has(id) && checkedInRef.current) {
        ding();
        break;
      }
    }
    knownWaiting.current = waitingNow;
  }, [router]);

  const refreshOpenChat = useCallback(async () => {
    if (!openId) return;
    const res = await fetch(`/api/live/sessions/${openId}`);
    if (!res.ok) return;
    const data = await res.json();
    setOpenChat(data);
  }, [openId]);

  useEffect(() => {
    refreshSessions();
    const t = setInterval(refreshSessions, 3500);
    return () => clearInterval(t);
  }, [refreshSessions]);

  useEffect(() => {
    // Closing a chat clears openId; also clear the panel content so it doesn't
    // linger in the right pane (the view renders on openChat, not openId).
    if (!openId) {
      setOpenChat(null);
      return;
    }
    refreshOpenChat();
    const t = setInterval(refreshOpenChat, 2500);
    return () => clearInterval(t);
  }, [openId, refreshOpenChat]);

  useEffect(() => {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight });
  }, [openChat?.messages.length]);

  async function toggleCheckin() {
    const res = await fetch("/api/live/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: !checkedIn }),
    });
    if (res.ok) {
      setCheckedIn(!checkedIn);
      checkedInRef.current = !checkedIn;
      refreshSessions();
    }
  }

  async function accept(id: string) {
    const res = await fetch(`/api/live/sessions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    });
    if (res.ok) {
      setOpenId(id);
      refreshSessions();
    } else {
      const { error } = await res.json().catch(() => ({ error: "Could not accept." }));
      alert(error);
      refreshSessions();
    }
  }

  async function sendMsg(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !openId || sending) return;
    setSending(true);
    const content = draft.trim();
    setDraft("");
    const res = await fetch(`/api/live/sessions/${openId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "message", content }),
    });
    setSending(false);
    if (res.ok) refreshOpenChat();
  }

  async function endChat() {
    if (!openId || !confirm("End this live chat?")) return;
    await fetch(`/api/live/sessions/${openId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end" }),
    });
    refreshOpenChat();
    refreshSessions();
  }

  // Dismiss an ended chat from the panel (transcript kept in the DB).
  async function archiveChat(id: string) {
    if (openId === id) setOpenId(null);
    setSessions((s) => s.filter((x) => x.id !== id)); // optimistic
    await fetch(`/api/live/sessions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    });
    refreshSessions();
  }

  async function clearEnded() {
    if (!confirm("Clear all ended chats from this list? Transcripts are kept.")) return;
    setSessions((s) => s.filter((x) => x.status !== "ended")); // optimistic
    setOpenId(null);
    await fetch(`/api/live/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear-ended" }),
    });
    refreshSessions();
  }

  const waiting = sessions.filter((s) => s.status === "waiting");
  const live = sessions.filter((s) => s.status === "live");
  const ended = sessions.filter((s) => s.status === "ended");

  return (
    <div className="flex flex-col h-screen">
      <header className="bg-white border-b border-gray-200 px-5 py-3.5 flex items-center gap-4 shrink-0">
        <Link href="/" className="text-gray-400 hover:text-gray-700 font-medium text-sm">
          ← Desk
        </Link>
        <h1 className="text-xl font-bold">Live Chat</h1>
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          {onlineAgents.map((a) => (
            <Avatar key={a.id} name={a.name} size={24} />
          ))}
          {onlineAgents.length > 0 && (
            <span className="text-xs">{onlineAgents.length} online</span>
          )}
        </div>
        <div className="flex-1" />
        <button
          onClick={toggleCheckin}
          className={`flex items-center gap-2 text-sm font-semibold rounded-lg px-4 py-1.5 border transition-colors ${
            checkedIn
              ? "bg-violet-700 text-white border-violet-700"
              : "bg-white text-gray-600 border-gray-300 hover:border-violet-400"
          }`}
        >
          <span className={`w-2.5 h-2.5 rounded-full ${checkedIn ? "bg-green-300" : "bg-gray-300"}`} />
          {checkedIn ? "Checked in — available" : "Check in for chats"}
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Session list */}
        <aside className="w-80 shrink-0 border-r border-gray-200 bg-white overflow-y-auto p-3 space-y-2">
          {!checkedIn && (
            <p className="text-xs text-gray-400 bg-violet-50 border border-violet-100 rounded-lg p-3">
              Check in (top right) to get pinged when a visitor asks for a person. The widget only
              offers live chat while someone is checked in.
            </p>
          )}
          {waiting.length === 0 && live.length === 0 && ended.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-10">No active chats.</p>
          )}
          {waiting.map((s) => (
            <div key={s.id} className="border-2 border-amber-300 bg-amber-50 rounded-xl p-3 animate-pulse">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-amber-700">Waiting</span>
                <span className="flex-1" />
                <span className="text-[11px] text-gray-400">{s.inbox}</span>
              </div>
              <p className="text-sm font-medium text-gray-800 mt-1">
                {s.visitorName || s.visitorEmail || "Store visitor"}
              </p>
              <p className="text-xs text-gray-500 truncate mt-0.5">{s.preview}</p>
              <button
                onClick={() => accept(s.id)}
                className="mt-2 w-full bg-violet-700 hover:bg-violet-800 text-white text-sm font-semibold rounded-lg py-1.5"
              >
                Accept chat
              </button>
            </div>
          ))}
          {live.map((s) => (
            <button
              key={s.id}
              onClick={() => setOpenId(s.id)}
              className={`w-full text-left border rounded-xl p-3 transition-colors ${
                openId === s.id ? "border-violet-500 bg-violet-50" : "border-gray-200 bg-white hover:border-violet-300"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs font-semibold text-gray-500">
                  {s.agent ? `with ${s.agent.name}` : "live"}
                </span>
                <span className="flex-1" />
                <span className="text-[11px] text-gray-400">{s.inbox}</span>
              </div>
              <p className="text-sm font-medium text-gray-800 mt-1">
                {s.visitorName || s.visitorEmail || "Store visitor"}
              </p>
              <p className="text-xs text-gray-500 truncate mt-0.5">{s.preview}</p>
            </button>
          ))}

          {ended.length > 0 && (
            <div className="pt-3">
              <div className="flex items-center px-1 mb-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Recently ended
                </p>
                <span className="flex-1" />
                <button
                  onClick={clearEnded}
                  className="text-[11px] font-medium text-gray-400 hover:text-violet-700"
                >
                  Clear all
                </button>
              </div>
              {ended.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setOpenId(s.id)}
                  className={`relative group w-full text-left border rounded-xl p-3 mb-2 transition-colors cursor-pointer ${
                    openId === s.id ? "border-violet-400 bg-violet-50" : "border-gray-100 bg-gray-50 hover:border-gray-300"
                  }`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      archiveChat(s.id);
                    }}
                    title="Dismiss"
                    className="absolute top-2 right-2 text-gray-300 hover:text-gray-600 opacity-0 group-hover:opacity-100 text-base leading-none"
                  >
                    ×
                  </button>
                  <div className="flex items-center gap-2 pr-5">
                    <span className="w-2 h-2 rounded-full bg-gray-300" />
                    <span className="text-xs font-semibold text-gray-400">
                      ended{s.agent ? ` · ${s.agent.name}` : ""}
                    </span>
                    <span className="flex-1" />
                    <span className="text-[11px] text-gray-400">{s.inbox}</span>
                  </div>
                  <p className="text-sm font-medium text-gray-600 mt-1">
                    {s.visitorName || s.visitorEmail || "Store visitor"}
                  </p>
                  <p className="text-xs text-gray-400 truncate mt-0.5">{s.preview}</p>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Open conversation. Gated on openId (not just openChat) so an
            in-flight poll that resolves after a close can't repopulate the
            panel — no selection always means the placeholder. */}
        <main className="flex-1 flex flex-col min-w-0 bg-violet-50/40">
          {!openId || !openChat ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              {waiting.length > 0 ? "Accept a waiting chat to start talking." : "Select a chat."}
            </div>
          ) : (
            <>
              <div className="bg-white border-b border-gray-200 px-5 py-3 flex items-center gap-3">
                <span className="font-semibold text-gray-800">
                  {openChat.visitorName || openChat.visitorEmail || "Store visitor"}
                </span>
                {openChat.visitorEmail && (
                  <span className="text-xs text-gray-400">{openChat.visitorEmail}</span>
                )}
                <span className="flex-1" />
                {openChat.status === "live" && (
                  <button
                    onClick={endChat}
                    className="text-sm text-red-600 border border-red-200 hover:bg-red-50 rounded-lg px-3 py-1"
                  >
                    End chat
                  </button>
                )}
                {openChat.status === "ended" && (
                  <span className="text-xs font-semibold uppercase text-gray-400">Ended</span>
                )}
                <button
                  onClick={() => setOpenId(null)}
                  className="text-gray-400 hover:text-gray-700 text-xl px-1 leading-none"
                  title="Close"
                >
                  ×
                </button>
              </div>
              <div ref={msgsRef} className="flex-1 overflow-y-auto p-5 space-y-2 flex flex-col">
                {openChat.messages.map((m, i) =>
                  m.role === "system" ? (
                    <p key={i} className="self-center text-xs text-gray-400">{m.content}</p>
                  ) : (
                    <div
                      key={i}
                      className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
                        m.role === "user"
                          ? "self-start bg-white border border-gray-200 text-gray-800"
                          : m.role === "agent"
                            ? "self-end bg-violet-700 text-white"
                            : "self-end bg-violet-100 text-violet-950"
                      }`}
                    >
                      {m.role !== "user" && (
                        <span className="block text-[10px] font-bold uppercase tracking-wide opacity-70 mb-0.5">
                          {m.role === "agent" ? m.name ?? "Agent" : "Bot"}
                        </span>
                      )}
                      {m.content}
                    </div>
                  )
                )}
              </div>
              {openChat.status === "live" && (
                <form onSubmit={sendMsg} className="bg-white border-t border-gray-200 p-3 flex gap-2">
                  <input
                    autoFocus
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                    placeholder="Message the customer…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button
                    disabled={!draft.trim() || sending}
                    className="bg-violet-700 hover:bg-violet-800 disabled:opacity-40 text-white text-sm font-semibold rounded-lg px-5"
                  >
                    Send
                  </button>
                </form>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
