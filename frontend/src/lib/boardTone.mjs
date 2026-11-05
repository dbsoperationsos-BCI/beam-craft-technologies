/**
 * A board column's status colour, read off the background class its screen already gives it
 * (`bg-emerald-600 text-white`, a pill's `bg-sky-500`), so every board keeps its own colours while
 * the lane itself only carries a thin line, a light wash and the card accents in that colour.
 *
 * Read as a hex rather than a class: the lane mixes it at low strength (`tint`), which a Tailwind
 * class cannot do for a colour chosen at run time.
 */
const TONES = {
  slate: "#475569", gray: "#4b5563", zinc: "#52525b", neutral: "#525252", stone: "#57534e",
  red: "#dc2626", orange: "#ea580c", amber: "#d97706", yellow: "#ca8a04", lime: "#65a30d",
  green: "#16a34a", emerald: "#059669", teal: "#0d9488", cyan: "#0891b2", sky: "#0284c7",
  blue: "#2563eb", indigo: "#4f46e5", violet: "#7c3aed", purple: "#9333ea", fuchsia: "#c026d3",
  pink: "#db2777", rose: "#e11d48", black: "#111827",
};

export const DEFAULT_TONE = TONES.slate;

/** The hex of a column's status colour, from its class list; slate when it names none. */
export function toneOf(className = "") {
  // An exact colour - `bg-[#7c3aed]`, as the CRM's columns are given.
  const hex = /(?:^|\s)bg-\[(#[0-9a-fA-F]{6})\]/.exec(String(className));
  if (hex) return hex[1].toLowerCase();
  const match = /(?:^|\s)bg-(black|[a-z]+)(?:-\d{2,3})?(?:\s|$)/.exec(String(className));
  return (match && TONES[match[1]]) || DEFAULT_TONE;
}

/** The colour at a given strength (0-1) over white, as an rgba() the lane and avatars are washed in. */
export function tint(hex, alpha) {
  const value = Number.parseInt(String(hex).replace("#", ""), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * The colour to write in on a light wash of `hex`: the tone itself, or slate where the tone is too
 * light to read (the CRM's pale grey Yet to connect), so an avatar's letters always pass contrast.
 */
export function inkOf(hex) {
  const value = Number.parseInt(String(hex).replace("#", ""), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? "#334155" : hex;
}

/** Up to two initials for a card's avatar: "Keerthana Raj" → "KR", "bc dc" → "BD", "DBS-19" → "D". */
export function initialsOf(text = "") {
  const words = String(text).split(/[\s|·,-]+/).map((word) => word.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  if (!words.length) return "?";
  return (words.length === 1 ? words[0].slice(0, 1) : `${words[0][0]}${words[words.length - 1][0]}`).toUpperCase();
}

/** A card's meta line as separate chips: "Active · Joined 2026-10-21" → ["Active", "Joined 2026-10-21"]. */
export const chipsOf = (meta) => String(meta || "").split(/\s+·\s+/).map((part) => part.trim()).filter(Boolean);
