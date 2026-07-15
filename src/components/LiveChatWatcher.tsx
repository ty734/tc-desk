"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

// Global live-chat watcher, mounted for logged-in agents on every desk page.
// Two jobs:
//  1) Presence — polling /api/live/sessions heartbeats this agent's presence,
//     so a CHECKED-IN agent stays "available" anywhere in the desk (not just on
//     the Live Chat screen). Fixes "no agents available even though I'm checked
//     in." Presence lapses ~30s after the last tab closes.
//  2) Alerts — when a new chat starts waiting, pop an on-screen banner + a
//     desktop notification + a sound, from any page, so nobody misses it.

function ding() {
  try {
    const Ctx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
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
    /* no audio — banner + notification still show */
  }
}

type Waiting = { id: string; visitorName: string | null; visitorEmail: string | null; preview: string };

export default function LiveChatWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const knownWaiting = useRef<Set<string>>(new Set());
  const titleTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseTitle = useRef<string>("");
  const [toast, setToast] = useState<Waiting | null>(null);

  // Ask for desktop-notification permission once.
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    baseTitle.current = document.title;
  }, []);

  function flashTitle(name: string) {
    if (titleTimer.current) return; // already flashing
    let on = false;
    titleTimer.current = setInterval(() => {
      document.title = on ? baseTitle.current : `💬 ${name} wants to chat`;
      on = !on;
    }, 1000);
  }
  function stopFlash() {
    if (titleTimer.current) {
      clearInterval(titleTimer.current);
      titleTimer.current = null;
    }
    document.title = baseTitle.current;
  }

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/live/sessions");
        if (!res.ok || cancelled) return; // 401 when logged out — just stop
        const data = await res.json();
        const waiting: Waiting[] = (data.sessions ?? []).filter(
          (s: { status: string }) => s.status === "waiting"
        );
        const now = new Set(waiting.map((s) => s.id));

        // Alert on brand-new waiting chats — but only when checked in, and not
        // while the agent is already on the Live Chat screen (it alerts there).
        if (data.checkedIn && pathname !== "/live") {
          const fresh = waiting.find((s) => !knownWaiting.current.has(s.id));
          if (fresh) {
            ding();
            setToast(fresh);
            const who = fresh.visitorName || fresh.visitorEmail || "A visitor";
            flashTitle(who);
            if ("Notification" in window && Notification.permission === "granted") {
              const n = new Notification("New live chat waiting", {
                body: `${who} — click to answer`,
                tag: "lw-live-chat",
                requireInteraction: true,
              });
              n.onclick = () => {
                window.focus();
                router.push("/live");
                n.close();
              };
            }
          }
        }
        // If nothing is waiting anymore, clear the alert state.
        if (waiting.length === 0) {
          setToast(null);
          stopFlash();
        }
        knownWaiting.current = now;
      } catch {
        /* transient — retry next tick */
      }
    }
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [pathname, router]);

  // Clear the flashing title once the agent comes back to the tab.
  useEffect(() => {
    function onVisible() {
      if (!document.hidden && !toast) stopFlash();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [toast]);

  if (!toast) return null;

  const who = toast.visitorName || toast.visitorEmail || "A visitor";
  return (
    <div className="fixed bottom-6 left-6 z-50 w-80 bg-white border-2 border-violet-500 rounded-2xl shadow-2xl p-4 animate-in">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 12c0 4.418-4.03 8-9 8-1.05 0-2.06-.16-3-.455L4 21l1.5-3.5C4.56 16.13 4 14.63 4 13c0-4.418 4.03-8 9-8s8 2.582 8 7z"
              fill="#6E9277"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-violet-900 leading-tight">New live chat waiting</p>
          <p className="text-sm text-gray-600 truncate">{who}</p>
          {toast.preview && <p className="text-xs text-gray-400 truncate mt-0.5">{toast.preview}</p>}
        </div>
        <button
          onClick={() => setToast(null)}
          className="text-gray-300 hover:text-gray-600 text-lg leading-none"
          title="Dismiss"
        >
          ×
        </button>
      </div>
      <button
        onClick={() => {
          stopFlash();
          setToast(null);
          router.push("/live");
        }}
        className="mt-3 w-full bg-violet-700 hover:bg-violet-800 text-white text-sm font-semibold rounded-lg py-2"
      >
        Answer chat
      </button>
    </div>
  );
}
