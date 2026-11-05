import AppLogo from "@/components/shared/AppLogo";

/**
 * The studio's logo, wherever the client gallery shows it.
 *
 * Both the name and the logo come from studio-wide Image Selection settings, carried on the gallery
 * meta. `BrandFallbackLogo` is the fallback, so a studio that has never uploaded a logo — and every
 * gallery published before the setting existed — shows the bundled mark rather than a blank space
 * where the brand goes. An uploaded logo is a plain <img>: it is an arbitrary URL on the studio's
 * own R2 bucket, not something next/image has a configured loader for on this public page.
 *
 * `GalleryLogo` exists because the gallery shows the logo in four places and three of them used to
 * hardcode the bundled SVG and the name "Don't Blink Studioz" — so an uploaded logo appeared nowhere
 * a client actually looks. Every one of them now goes through here, and a studio that uploads a logo
 * sees it in the sidebar, on the mobile bar and on the welcome screen at once.
 */
/**
 * The gallery's own logo is passed as `src` because a published gallery carries the branding it was
 * published with, rather than reading Settings back. Everything after that — the fallback to the
 * bundled mark, the fallback again if the logo will not load, and the fixed height it is contained
 * at without being stretched or cropped — is `AppLogo`, the same component the rest of the
 * application shows its mark through. A gallery published before the setting existed passes
 * nothing, and `AppLogo` then answers with the studio's current Global Logo, or with the bundled
 * mark where there is none.
 *
 * `variant` says which of the gallery's three places this is — the sidebar and folder grid, the
 * mobile bar, or the badge under the welcome screen — and each has a stated size of its own, so a
 * square upload and a wide wordmark read as the same size there.
 */
export function GalleryLogo({ studioName, logoUrl, variant = "clientSelection" }) {
  // `data-gallery-logo`: inside the client's app the app shows its own mark, so this one is hidden.
  return <span data-gallery-logo className="contents"><AppLogo variant={variant} src={logoUrl} alt={studioName} /></span>;
}

/** The badge at the foot of the welcome screen. */
export default function GalleryBrand({ studioName, logoUrl }) {
  if (!logoUrl) return null;
  return <footer className="pt-10 text-center">
    <div className="flex justify-center opacity-80">
      <GalleryLogo studioName={studioName} logoUrl={logoUrl} variant="clientSelectionBadge" />
    </div>
  </footer>;
}
