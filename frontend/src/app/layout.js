import { cookies } from "next/headers";
import "./globals.css";
import { DEFAULT_THEME, THEME_STORAGE_KEY, isTheme } from "@/lib/theme";
import StudioFavicon from "@/components/shared/StudioFavicon";
import SwipeNavigationGuard from "@/components/shared/SwipeNavigationGuard";
import { faviconIcons } from "@/lib/favicon.mjs";
import { BUNDLED_APP_SHORT_NAME, appIconUrl, serverStudioBranding, studioAppName } from "@/lib/serverStudioBranding";

/*
 * Built per request rather than fixed, for what follows the studio's Settings → Branding: the tab
 * icon, and on iOS the home screen icon and the name under it - the favicon and the studio name
 * when they are set, the bundled ones when they are not. Everything else here is as it always was.
 */
export async function generateMetadata() {
  const branding = await serverStudioBranding();
  return {
    ...metadata,
    icons: { ...metadata.icons, icon: faviconIcons(branding), apple: [{ url: appIconUrl(branding, "apple-touch-icon-180"), sizes: "180x180", type: "image/png" }] },
    appleWebApp: { ...metadata.appleWebApp, title: studioAppName(branding) || BUNDLED_APP_SHORT_NAME },
  };
}

const metadata = {
  title: "DBS Operations OS",
  description: "HRM Foundation",
  /*
   * The mark a tab wears from the first byte: the studio's favicon from Settings → Branding - one
   * per tab strip, light and dark, the browser choosing by its own setting - and the bundled mark
   * only where nothing has been uploaded (`faviconIcons`, set in `generateMetadata` above).
   * `StudioFavicon` still follows a newly saved one without a reload.
   */
  icons: {
    /*
     * iOS reads neither the manifest's icons nor an SVG for a home screen, so Add to Home Screen
     * gets its own PNG. Flattened onto white rather than left transparent: iOS draws no alpha and
     * rounds the corners itself, and a transparent mark arrives on a black square.
     */
    apple: [{ url: "/icons/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  /*
   * Installed on an iPhone, the application opens without Safari's chrome and titles its card
   * "DBS OS" - the same name the manifest puts under the icon, which iOS does not read. The status
   * bar is left `default` (dark text on the bar's own ground): `black-translucent` would run the
   * page under the bar, and the app shell's top bar is sticky at `top-0` with nothing to offset it
   * by, so the clock would sit on top of the hamburger.
   */
  appleWebApp: { capable: true, title: "DBS OS", statusBarStyle: "default" },
  /*
   * The same thing `capable` above says, under the name iOS 16 and earlier answer to.
   *
   * Next renders `capable: true` as `<meta name="mobile-web-app-capable">`, which is the name the
   * standard settled on and which iOS has honoured since 17. An iPhone older than that reads only
   * `apple-mobile-web-app-capable`, and without it Add to Home Screen still makes the icon - it just
   * opens inside Safari, with the address bar and the tab strip, which is the one thing installing
   * was meant to remove. Both names, so the icon opens the same window on every iPhone.
   */
  other: { "apple-mobile-web-app-capable": "yes" },
};

/**
 * The colour the browser and the system bars take around the page.
 *
 * A pair rather than the manifest's single `theme_color`, because the application has a dark
 * appearance and a bar that stays white around a dark page is the seam that gives away a web view.
 * White is the top bar's own `bg-white/95`; the dark value is what `.app-topbar` is repainted to
 * under `enhanced-dark` in `globals.css`. These follow the machine's `prefers-color-scheme` rather
 * than the theme cookie below - a `<meta>` cannot be chosen per request without making every page
 * dynamic on it, and the two agree for everybody who has not overridden the theme by hand.
 */
export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

/**
 * The document, wearing the theme from the first frame.
 *
 * The choice is kept in a cookie rather than in localStorage precisely so this can happen: the
 * server reads it and writes `data-theme` into the HTML it sends, so the correct palette is
 * painted immediately. The alternatives both have a visible cost - setting the attribute in an
 * effect shows one frame of the light theme and then swaps, which is a white flash on every
 * navigation for anyone reading in the dark, and an inline bootstrap script is a raw `<script>`
 * inside a React component, which React warns about on every render.
 */
export default async function RootLayout({ children }) {
  const stored = (await cookies()).get(THEME_STORAGE_KEY)?.value;
  const theme = isTheme(stored) ? stored : DEFAULT_THEME;

  return (
    <html lang="en" className="h-full antialiased" data-theme={theme}>
      <body className="min-h-full flex flex-col">
        {/* Every page this application serves, the client's tabs included, wears the studio's
            mark - and follows it the moment Settings saves a new one. */}
        <StudioFavicon />
        <SwipeNavigationGuard />
        {children}
      </body>
    </html>
  );
}
