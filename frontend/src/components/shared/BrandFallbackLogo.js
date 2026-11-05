/**
 * The mark every surface falls back to when no Global Logo has been set.
 *
 * Settings -> Global Logo is what the application shows wherever it shows a logo; until a studio has
 * uploaded one, the surfaces that ask for it used to render nothing at all, leaving a blank space
 * where the brand goes. This is what stands there instead.
 *
 * Two files ship, and both are in the document at once so CSS can choose between them from the
 * `data-theme` the server has already written on <html>. That is what makes the right one appear on
 * the very first frame with no JavaScript, and follow the appearance picker the instant it changes.
 * Which file suits which theme is a matter of legibility, and the artwork itself says so: the black
 * lettering carries a white outline around its triangle and is drawn for a light ground, while the
 * white lettering carries a near-black one and is drawn for a dark ground. The pairing lives in
 * `globals.css` under `.studio-logo-fallback`; swapping it is a one-line change there.
 *
 * Both images carry the same `alt`, because exactly one of them is ever displayed - the other is
 * `display: none`, which assistive technology skips - so the mark is named once either way.
 *
 * Loaded as <img> rather than inlined on purpose: each file carries its own <style> block using the
 * same class names as the other, and an <img> keeps those styles inside their own document where
 * they cannot reach the page or each other.
 */
/**
 * What the bundled mark is called, for the `alt` of the two files below.
 *
 * It names *the artwork*, not the studio. Nothing writes it on screen as a brand name - see
 * `brandNameFor` - and it is here only so assistive technology can say which mark is showing.
 */
export const FALLBACK_LOGO_ALT = "Beam Craft";

/**
 * The name to write beside the logo: the Global Name from Settings, and nothing else.
 *
 * Empty until the branding endpoint has answered, and empty again where the studio has left the
 * Global Name blank. Both callers guard on it, so an empty answer draws no text at all rather than
 * a gap - which is the point. The application used to name itself here when the field was empty;
 * it does not, because a name nobody typed is not the studio's name and reads as one.
 */
export function brandNameFor(branding) {
  return branding?.studioName || "";
}

/*
 * A sentence *about* the studio cannot be left with a hole in it where the name goes, so it does
 * not use the rule above — `brandNameInProse` in `@/lib/studioBranding.mjs` falls back to the
 * bundled brand instead of to nothing. A caption beside the mark may be absent; a sentence may not.
 */

/**
 * `style` is how `AppLogo` hands both files the height and width cap its variant states. It is
 * given to each of them rather than to a wrapper, because only one is ever displayed and the pair
 * has no element between them to size.
 *
 * `dark` is a surface that is dark whatever the appearance picker says (`AppLogo`'s
 * `surface="dark"`): it takes the white-lettered mark alone, rather than the pair the theme
 * chooses between - which on a light theme would put black lettering on the dark.
 */
export default function BrandFallbackLogo({ className = "", style, alt = FALLBACK_LOGO_ALT, dark = false }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (dark) return <img src="/brand/beam-craft-white-text.svg" alt={alt} style={style} className={`studio-logo-fallback ${className}`} />;
  return <>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/brand/beam-craft-black-text.svg" alt={alt} style={style} className={`studio-logo-fallback studio-logo-fallback-light ${className}`} />
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/brand/beam-craft-white-text.svg" alt={alt} style={style} className={`studio-logo-fallback studio-logo-fallback-dark ${className}`} />
  </>;
}
