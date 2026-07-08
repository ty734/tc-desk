// Named palette for custom-field option chips (Asana-style pastels).
export const OPTION_COLORS: Record<string, { bg: string; text: string }> = {
  gray: { bg: "#e5e7eb", text: "#374151" },
  red: { bg: "#fecaca", text: "#991b1b" },
  orange: { bg: "#fed7aa", text: "#9a3412" },
  yellow: { bg: "#fef08a", text: "#854d0e" },
  green: { bg: "#bbf7d0", text: "#166534" },
  teal: { bg: "#99f6e4", text: "#115e59" },
  blue: { bg: "#bfdbfe", text: "#1e40af" },
  purple: { bg: "#e9d5ff", text: "#6b21a8" },
  pink: { bg: "#fbcfe8", text: "#9d174d" },
};

export const COLOR_NAMES = Object.keys(OPTION_COLORS);

export function optionColor(name: string) {
  return OPTION_COLORS[name] ?? OPTION_COLORS.gray;
}

/** Deterministic color for a label so imported fields look reasonable. */
export function autoColor(label: string) {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return COLOR_NAMES[h % COLOR_NAMES.length];
}
