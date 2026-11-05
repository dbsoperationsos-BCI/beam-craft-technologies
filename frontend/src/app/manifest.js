import { BUNDLED_APP_NAME, BUNDLED_APP_SHORT_NAME, appIconUrl, serverStudioBranding, studioAppName } from "../lib/serverStudioBranding.js";

/**
 * What a browser is told when somebody installs this application to a home screen.
 *
 * Served at `/manifest.webmanifest` by the file convention - the name, the icons and the window
 * the application opens in. The name and the icons follow Settings → Branding: the studio's name
 * and an icon drawn from its favicon by the API (`/api/public/app-icon`), and the bundled name and
 * icons when either is not set or the API cannot be reached - so installing never depends on the
 * API answering. A manifest is read once, when the icon is created, so a change in Settings reaches
 * new installs; one already on a device keeps what it was given until it is installed again.
 */

/*
 * A manifest is cached like any route by default, which would freeze whatever branding was there at
 * build time. Re-read once a minute instead - the same minute `serverStudioBranding` caches for - so
 * a name or favicon saved in Settings reaches the next install without a redeploy.
 */
export const revalidate = 60;

/** The icons, as `appIconUrl` resolves them - the bundled ones are drawn from `public/brand/favicon.svg`. */
const iconsFor = (branding) => [
  // `any` is the mark as drawn: a white rounded ground the platform does not reshape.
  { src: appIconUrl(branding, "icon-192"), sizes: "192x192", type: "image/png", purpose: "any" },
  { src: appIconUrl(branding, "icon-512"), sizes: "512x512", type: "image/png", purpose: "any" },
  /*
   * `maskable` is the same mark at 70% on a full-bleed white square. Android cuts its own shape -
   * a circle, a squircle, a rounded square, whichever the launcher uses - out of whatever it is
   * given, keeping only the central 80%. The mark runs the full width of the drawn icon, so handing
   * over the `any` file would clip the B and the C; shrinking it inside the square is what keeps
   * the whole mark inside every shape a launcher might cut.
   */
  { src: appIconUrl(branding, "maskable-192"), sizes: "192x192", type: "image/png", purpose: "maskable" },
  { src: appIconUrl(branding, "maskable-512"), sizes: "512x512", type: "image/png", purpose: "maskable" },
];

export default async function manifest() {
  const branding = await serverStudioBranding();
  const studioName = studioAppName(branding);
  return {
    /*
     * The install's identity, stated rather than inferred. Left out, a browser derives it from
     * `start_url`, and changing that later would read as a second, unrelated application rather
     * than an update to the one already on the home screen.
     */
    id: "/",
    name: studioName || BUNDLED_APP_NAME,
    // What goes under the icon. The studio's own name as it is - a launcher truncates one longer
    // than about twelve characters - and the bundled short name when the studio has not set one.
    short_name: studioName || BUNDLED_APP_SHORT_NAME,
    description:
      "The studio's operations workspace: sales and CRM, projects, image selection, HRM and accounts.",
    lang: "en",
    dir: "ltr",
    /*
     * The login page, not the root: `/` is the public BeamCraft home page now, and an installed app
     * should open on the application. `/login` shows the form to a launch with no session and sends
     * one that has a session straight on to its default screen. Naming a deeper page here would only
     * be right for whoever has access to it. `id` above stays `/`, so existing installs read this as
     * an update rather than a second application.
     */
    start_url: "/login",
    /*
     * Everything this origin serves. The signed-in screens sit at a dozen top-level paths -
     * /employees, /sales, /hrm, /accounts - so there is no prefix a narrower scope could name. The
     * cost is that a client gallery or CRD link opened on a device with the application installed
     * may open inside its window; those pages are public and render without the shell, so they are
     * correct there.
     */
    scope: "/",
    display: "standalone",
    /*
     * The ground a launch is painted on before the first frame arrives, and the colour the system
     * bars take. Both are the light theme's `--background` and the top bar's own white, so the
     * splash and the bar are continuous with the application rather than a flash of some other
     * colour. The theme's dark tiers are handled by `themeColor` in the root layout, which a
     * manifest cannot express - it carries one colour, not a pair.
     */
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["business", "productivity"],
    icons: iconsFor(branding),
  };
}
