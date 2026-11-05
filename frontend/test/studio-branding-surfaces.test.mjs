import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

/*
 * Which surfaces may be given the dark-mode Global Logo.
 *
 * Settings holds a light-mode and a dark-mode mark, and the appearance picker paints only the
 * *application* dark: every dark rule in `globals.css` is scoped to `.app-shell`, `.app-topbar`,
 * `.crm-page` or the sidebar. The sign-in page, the public onboarding and interview forms, the
 * client's selection gallery, the album proofing room, the AI Feature guest pages and the client's
 * quotation are white whatever the viewer's theme is - and the quotation is what gets printed to
 * PDF for the client.
 *
 * So the dark mark is asked for, never assumed. Reading `data-theme` alone would have put a dark
 * mark on every one of those pages the moment a member of staff with Dark Mode selected opened
 * one. This test is what keeps that from coming back.
 *
 * Two ways to ask. `themed` is for a surface the appearance picker repaints, and only the app bar
 * has one. `surface="dark"` is for a surface that is dark by nature whatever the picker says - the
 * guest join page's mark over an event photograph - and only that page has one.
 *
 * Reads the source, the way the other settings tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const src = (...parts) => path.join(HERE, "..", "src", ...parts);
const read = (...parts) => fs.readFileSync(src(...parts), "utf8");

const LOGO = read("components", "shared", "AppLogo.js");

test("the dark-mode mark is off unless a surface asks for it", () => {
  assert.match(LOGO, /themed = false/, "`themed` must default to off");
  assert.match(LOGO, /surface = "light"/, "`surface` must default to light");
  assert.match(LOGO, /const dark = surface === "dark" \|\| \(themed && themeWantsDarkMark\(theme\)\);/);
  // The hook is read unconditionally - calling it behind `themed` would break the rules of hooks.
  assert.match(LOGO, /const theme = useDocumentTheme\(\);/);
});

test("only the app bar asks for it, because only the app bar is repainted dark", () => {
  const asking = [];
  for (const [file, dir] of [
    ["AppTopbar.js", ["components", "app-shell"]],
    ["LoginForm.js", ["components", "auth"]],
    ["PublicOnboardingForm.js", ["components", "onboarding"]],
    ["PublicApplicationForm.js", ["components", "interview"]],
    ["PublicQuotationPage.js", ["components", "sales"]],
    ["PublicQuotationTermsPage.js", ["components", "sales"]],
    ["GalleryBrand.js", ["components", "image-selection", "client-gallery"]],
    ["ClientProofViewer.js", ["components", "image-selection", "album-proofing", "client"]],
    ["GuestHero.js", ["components", "ai-feature", "guest"]],
    ["GuestGallery.js", ["components", "ai-feature", "guest"]],
    ["GuestStatusScreen.js", ["components", "ai-feature", "guest"]],
  ]) {
    const source = fs.readFileSync(src(...dir, file), "utf8");
    // Every one of these draws the mark; only a `themed` one may be handed the dark upload.
    if (/<AppLogo[^>]*\bthemed\b/s.test(source)) asking.push(file);
  }
  assert.deepEqual(asking, ["AppTopbar.js"], "a white surface must not ask for the dark-mode mark");
});

test("only the surfaces dark by nature - the guest join page's photograph, the client sign-in's dark ground - ask for the dark-surface mark", () => {
  const asking = [];
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name.endsWith(".js") && /<AppLogo[^>]*surface="dark"/s.test(fs.readFileSync(full, "utf8"))) asking.push(entry.name); } };
  walk(src("components"));
  assert.deepEqual(asking.sort(), ["ClientAuthLayout.js", "GuestHero.js"], "a surface that is not dark by nature must not take the dark-surface mark");
  // With no logo uploaded, a dark surface takes the white-lettered bundled mark alone, not the
  // pair the theme picks between.
  assert.ok(read("components", "shared", "BrandFallbackLogo.js").includes('if (dark) return <img src="/brand/beam-craft-white-text.svg"'));
  assert.match(LOGO, /darkFallback=\{surface === "dark"\}/);
});

test("the dark bar leaves a mark uploaded for it alone, and still corrects a borrowed light one", () => {
  const css = read("app", "globals.css");
  // The inversion is a guess made on a borrowed light mark's behalf; a real dark upload is exempt.
  assert.match(css, /\.app-topbar \.app-logo img:not\(\.studio-logo-fallback\):not\(\.studio-logo-own-dark\)/);
  // And the class is set only where the mark shown really is the dark upload.
  assert.match(LOGO, /const ownDark = !src && dark && mark\.ownMark;/);
});
