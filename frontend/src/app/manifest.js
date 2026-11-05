/**
 * What a browser is told when somebody installs this application to a home screen.
 *
 * Served at `/manifest.webmanifest` by the file convention - the name, the icons and the window
 * the application opens in. It is static on purpose, and read once, at install: Settings can
 * change the studio's name and its tab mark at runtime (see `StudioFavicon`), but a manifest is
 * fetched when the icon is created and an installed device keeps what it was given. Branding an
 * installed app from the database would therefore only reach installs made after the change, and
 * would make the install itself depend on the API answering - so the mark that ships with the
 * application is the one that goes on the home screen.
 */

/** The studio's mark, rendered from `public/brand/favicon.svg`. See README - PWA. */
const ICONS = [
  // `any` is the mark as drawn: a white rounded ground the platform does not reshape.
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  /*
   * `maskable` is the same mark at 70% on a full-bleed white square. Android cuts its own shape -
   * a circle, a squircle, a rounded square, whichever the launcher uses - out of whatever it is
   * given, keeping only the central 80%. The mark runs the full width of the drawn icon, so handing
   * over the `any` file would clip the B and the C; shrinking it inside the square is what keeps
   * the whole mark inside every shape a launcher might cut.
   */
  { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
  { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

export default function manifest() {
  return {
    /*
     * The install's identity, stated rather than inferred. Left out, a browser derives it from
     * `start_url`, and changing that later would read as a second, unrelated application rather
     * than an update to the one already on the home screen.
     */
    id: "/",
    name: "DBS Operations OS",
    // What fits under an icon. Android gives a home screen label about twelve characters before it
    // truncates, and "DBS Operations OS" is not one of them.
    short_name: "DBS OS",
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
    icons: ICONS,
  };
}
