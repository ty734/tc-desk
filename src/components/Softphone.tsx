"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// Type-only import — erased at compile time, so the browser-only SDK is never
// evaluated during SSR. The runtime Device class is loaded via dynamic import
// inside the effect (client only).
import type { Device as TwDevice, Call as TwCall } from "@twilio/voice-sdk";

// Synthesized ring — same Web Audio approach as LiveChatWatcher (no asset file).
function ring() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const beep = (freq: number, offset: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.start(t);
      osc.stop(t + 0.36);
    };
    beep(880, 0);
    beep(1174, 0.18);
  } catch {
    /* audio not available — ignore */
  }
}

function fmtDuration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function prettyFrom(raw?: string): string {
  if (!raw) return "Unknown caller";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : raw;
}

type Phase = "off" | "ready" | "incoming" | "active";

export default function Softphone() {
  const [phase, setPhase] = useState<Phase>("off");
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [caller, setCaller] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);

  const deviceRef = useRef<TwDevice | null>(null);
  const incomingRef = useRef<TwCall | null>(null);
  const activeRef = useRef<TwCall | null>(null);
  const ringTimer = useRef<number | null>(null);
  const callTimer = useRef<number | null>(null);

  const stopRing = useCallback(() => {
    if (ringTimer.current !== null) {
      clearInterval(ringTimer.current);
      ringTimer.current = null;
    }
  }, []);
  const startRing = useCallback(() => {
    if (ringTimer.current !== null) return;
    ring();
    ringTimer.current = window.setInterval(ring, 2500);
  }, []);
  const stopCallTimer = useCallback(() => {
    if (callTimer.current !== null) {
      clearInterval(callTimer.current);
      callTimer.current = null;
    }
  }, []);

  // Register the Twilio Device once. Stays dormant (renders nothing) if the
  // voice env isn't configured yet or the agent is logged out.
  useEffect(() => {
    let cancelled = false;
    let device: TwDevice | null = null;

    async function init() {
      let token: string | undefined;
      try {
        const res = await fetch("/api/voice/token");
        if (!res.ok) return; // 401 logged out / 503 not configured → dormant
        token = (await res.json()).token;
      } catch {
        return;
      }
      if (cancelled || !token) return;

      const { Device } = await import("@twilio/voice-sdk");
      if (cancelled) return;
      device = new Device(token, { logLevel: "error" });
      deviceRef.current = device;

      device.on("registered", () => {
        if (!cancelled) setPhase((p) => (p === "off" ? "ready" : p));
      });
      device.on("error", (e: { message?: string }) =>
        console.error("[softphone] device error", e?.message),
      );
      device.on("tokenWillExpire", async () => {
        try {
          const r = await fetch("/api/voice/token");
          if (r.ok) device?.updateToken((await r.json()).token);
        } catch {
          /* ignore refresh failure */
        }
      });
      device.on("incoming", (call: TwCall) => {
        incomingRef.current = call;
        setCaller(prettyFrom(call.parameters?.From));
        setPhase("incoming");
        startRing();
        const clear = () => {
          stopRing();
          incomingRef.current = null;
          setPhase((p) => (p === "incoming" ? "ready" : p));
        };
        call.on("cancel", clear); // caller hung up, or another agent grabbed it
        call.on("reject", clear);
        call.on("disconnect", clear);
        call.on("error", clear);
      });

      try {
        await device.register();
      } catch (e) {
        console.error("[softphone] register failed", e);
      }
    }

    init();
    return () => {
      cancelled = true;
      stopRing();
      stopCallTimer();
      device?.destroy();
    };
  }, [startRing, stopRing, stopCallTimer]);

  // Reflect current check-in state — availability is what makes calls ring us
  // (the inbound webhook only dials checked-in agents).
  useEffect(() => {
    fetch("/api/live/sessions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAvailable(!!d.checkedIn))
      .catch(() => {});
  }, []);

  async function toggleAvailable() {
    const next = !available;
    setBusy(true);
    setAvailable(next);
    try {
      await fetch("/api/live/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
    } catch {
      setAvailable(!next);
    } finally {
      setBusy(false);
    }
  }

  function answer() {
    const call = incomingRef.current;
    if (!call) return;
    call.accept();
    activeRef.current = call;
    incomingRef.current = null;
    stopRing();
    setMuted(false);
    setSeconds(0);
    setPhase("active");
    const started = Date.now();
    stopCallTimer();
    callTimer.current = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    call.on("disconnect", () => {
      stopCallTimer();
      activeRef.current = null;
      setPhase("ready");
    });
  }

  function decline() {
    incomingRef.current?.reject();
    incomingRef.current = null;
    stopRing();
    setPhase("ready");
  }

  function hangUp() {
    activeRef.current?.disconnect();
    activeRef.current = null;
    stopCallTimer();
    setPhase("ready");
  }

  function toggleMute() {
    const call = activeRef.current;
    if (!call) return;
    const m = !muted;
    call.mute(m);
    setMuted(m);
  }

  if (phase === "off") return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-black/10 bg-white text-sm shadow-lg">
      {phase === "incoming" ? (
        <div className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Incoming call
          </div>
          <div className="mt-1 text-base font-semibold">{caller}</div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={answer}
              className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-700"
            >
              Answer
            </button>
            <button
              onClick={decline}
              className="flex-1 rounded-lg bg-gray-200 px-3 py-2 font-medium text-gray-800 hover:bg-gray-300"
            >
              Decline
            </button>
          </div>
        </div>
      ) : phase === "active" ? (
        <div className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            On call · {fmtDuration(seconds)}
          </div>
          <div className="mt-1 text-base font-semibold">{caller}</div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={toggleMute}
              className={`flex-1 rounded-lg px-3 py-2 font-medium ${
                muted ? "bg-amber-500 text-white" : "bg-gray-200 text-gray-800 hover:bg-gray-300"
              }`}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={hangUp}
              className="flex-1 rounded-lg bg-red-600 px-3 py-2 font-medium text-white hover:bg-red-700"
            >
              Hang up
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={toggleAvailable}
          disabled={busy}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 disabled:opacity-60"
          title="Ring my browser when a call comes in"
        >
          <span className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                available ? "bg-emerald-500" : "bg-gray-300"
              }`}
            />
            <span className="font-medium">
              {available ? "Available for calls" : "Not taking calls"}
            </span>
          </span>
          <span className="text-xs text-gray-500">{available ? "On" : "Off"}</span>
        </button>
      )}
    </div>
  );
}
