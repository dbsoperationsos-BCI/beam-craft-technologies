/*
 * The release this bundle was built from — "1.2.41" in production, "dev" in a local build.
 *
 * NEXT_PUBLIC_* values are inlined at build time, and the production build runs on the VPS during
 * the deploy, so this is stamped by the same step that writes RELEASE for the backend: the two
 * always name the same release. That it cannot change at runtime is the point. A bundle a browser
 * cached before a deploy keeps reporting the version it was built with, so a screenshot from
 * someone describing behaviour the current release does not have says which build they are on.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
