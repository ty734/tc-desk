"use client";

import { optionColor } from "@/lib/colors";

export function Chip({ label, color }: { label: string; color: string }) {
  const c = optionColor(color);
  return (
    <span
      className="inline-block text-xs font-medium rounded-full px-2 py-0.5 whitespace-nowrap"
      style={{ background: c.bg, color: c.text }}
    >
      {label}
    </span>
  );
}

const CHANNEL_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  email: { label: "Email", bg: "#bfdbfe", text: "#1e40af" },
  amazon: { label: "Amazon", bg: "#fed7aa", text: "#9a3412" },
  chat: { label: "Chat", bg: "#bbf7d0", text: "#166534" },
  voice: { label: "Phone", bg: "#c7d2fe", text: "#3730a3" },
  ig: { label: "IG", bg: "#fbcfe8", text: "#9d174d" },
  fb: { label: "FB", bg: "#e9d5ff", text: "#6b21a8" },
  // Social engagement channels (Meta Phase 1) — comment vs DM stay visually
  // distinct because comment replies are PUBLIC.
  facebook_comment: { label: "FB Comment", bg: "#e9d5ff", text: "#6b21a8" },
  facebook_dm: { label: "FB DM", bg: "#ddd6fe", text: "#5b21b6" },
  instagram_comment: { label: "IG Comment", bg: "#fbcfe8", text: "#9d174d" },
  instagram_dm: { label: "IG DM", bg: "#fecdd3", text: "#9f1239" },
};

/** Small colored badge for the ticket's channel (email/amazon/chat/…). */
export function ChannelBadge({ channel }: { channel: string }) {
  const s = CHANNEL_STYLES[channel] ?? { label: channel, bg: "#e5e7eb", text: "#374151" };
  return (
    <span
      className="inline-block text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 whitespace-nowrap shrink-0"
      style={{ background: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  );
}

const AVATAR_COLORS = ["#6E9277", "#2E4959", "#D6A35D", "#7FA088", "#29404E", "#A9746E", "#557361"];

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: AVATAR_COLORS[h % AVATAR_COLORS.length],
      }}
      title={name}
    >
      {initials}
    </span>
  );
}

/** Compact "how long ago" label, e.g. "just now", "5m", "3h", "2d". */
export function formatAge(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
