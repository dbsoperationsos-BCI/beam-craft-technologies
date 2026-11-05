import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    /*
     * The browser and Node globals this application legitimately uses — `window`, `document`,
     * `fetch`, `setTimeout`, `FormData`, `process` and the rest. Declared so that `no-undef` below
     * can tell one of those from a name nobody defined.
     */
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      /*
       * A name nobody defined is a crash, so it fails the build.
       *
       * `eslint-config-next` leaves this off — it is written for TypeScript, where the compiler
       * answers the same question — and this is a JavaScript codebase, so nothing was asking it at
       * all. Two live `ReferenceError`s were sitting in the tree when it was switched on, both of
       * the same shape: a name that is in scope in one component read from inside another, which
       * every bundler compiles happily and which throws the moment that component renders.
       *
       *   - `branchOptions` in `CRMPage.js`, defined in `CRMPage` and read in `LeadPopupModal` —
       *     every double-click on a lead ended in "branchOptions is not defined".
       *   - `sale` in `StartProjectFormPanel.js`, which exists nowhere in that file — the shoot
       *     dialog threw as it opened.
       *
       * Neither is the kind of thing tests catch: both are in JSX that only renders once somebody
       * opens the thing. The linter is the right place to ask, so it is asked on every run.
       */
      "no-undef": "error",
      /*
       * Reported, but not a build failure.
       *
       * This rule is right about the general case — a setState in an effect usually means state
       * that should have been derived during render. Every occurrence in this codebase is one of
       * the two cases it cannot distinguish from that:
       *
       *   - Client-only values that must be read *after* mount or hydration breaks: the gallery
       *     session in PublicGallery, the dock position in UploadDock, the resumable batch in
       *     useUploadManager, the OAuth return in CRMPage.
       *   - An async load writing its own result: PublicQuotationPage, ImageViewer,
       *     ImagePreviewDialog.
       *
       * Left as an error, CI would push us to restructure hydration and data loading in a public
       * client gallery and the CRM page to satisfy a lint rule rather than a user-visible problem.
       * Left as a warning it stays on the report, so a genuinely derivable piece of state added
       * later is still noticed. Fix the occurrences one at a time, on purpose — not in a batch to
       * turn a build green.
       */
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
