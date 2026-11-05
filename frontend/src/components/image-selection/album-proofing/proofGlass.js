/**
 * The frosted surface the floating proof controls are drawn on.
 *
 * These pills sit *over* the spread being reviewed, so they cannot be solid: an opaque bar is a
 * piece of the photograph the reviewer cannot see. Frosted glass is the compromise — the spread
 * carries on underneath, blurred enough that the labels on top stay legible whatever is behind
 * them, which a plain transparent fill cannot promise over an arbitrary photograph.
 *
 * The blur is what does the work, not the alpha. A heavy `backdrop-blur` averages whatever is
 * behind into a flat tone, so `100%` reads the same over a white album page and a black one; the
 * tint only lifts that average toward white. `backdrop-saturate` puts back the colour the blur
 * washes out, which is what stops it looking like grey plastic.
 *
 * `supports-[backdrop-filter]` is the honest fallback: where the browser cannot blur, the pill
 * goes nearly opaque instead of transparent, because transparent-without-blur is the one
 * combination that makes the controls unreadable.
 */
const GLASS_SURFACE = [
  "border border-white/50",
  "bg-white/85 supports-[backdrop-filter]:bg-white/45",
  "backdrop-blur-xl backdrop-saturate-150",
  "shadow-lg shadow-slate-900/10",
  "transition-colors",
].join(" ");

/** At rest. Firms up under the pointer, so it is barely there while looking and solid while using. */
export const PROOF_GLASS = `${GLASS_SURFACE} supports-[backdrop-filter]:hover:bg-white/70`;

/** A control inside a glass pill: its own hover has to read against the frosted surface. */
export const PROOF_GLASS_ITEM = "hover:bg-white/70";
