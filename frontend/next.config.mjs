import { networkInterfaces } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** Hostname of the Cloudflare R2 bucket that serves asset and inspection images. */
const r2Hostname = (() => {
  const base = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL || "").trim();
  if (!base) return null;
  try {
    return new URL(base).hostname;
  } catch {
    console.warn(`next.config: NEXT_PUBLIC_R2_PUBLIC_BASE_URL is not a valid URL (${base}); remote images will not be allowed.`);
    return null;
  }
})();

/** This machine's IPv4 addresses on its networks (not loopback), for `allowedDevOrigins`. */
function localNetworkAddresses() {
  return Object.values(networkInterfaces()).flat().filter((entry) => entry && entry.family === "IPv4" && !entry.internal).map((entry) => entry.address);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `next dev` only: still Turbopack, and this is what it reads its project root from. The
  // production build is pinned to webpack instead - see `build` in package.json - so this option
  // has no effect there and is not a stray leftover of an incomplete migration.
  turbopack: {
    root: projectRoot,
  },
  // No development indicator - the "N" button `next dev` pins to the bottom-left of every page
  // with Route / Bundler / Preferences. It was showing on the client-facing Signature Album and
  // gallery pages during studio reviews and reads as part of the product; compile and runtime
  // errors still surface as before. A production build never had it.
  devIndicators: false,
  // `next dev` only: other hosts allowed to load dev pages, e.g. a phone on the same Wi-Fi opening a
  // client gallery at http://<this Mac's IP>:3000. This machine's own network addresses are allowed
  // as found at start-up, so a new Wi-Fi address needs no edit - restart `next dev` after changing
  // networks; DEV_ALLOWED_ORIGINS (frontend/.env.local, comma-separated) adds any others. A
  // production build ignores it.
  allowedDevOrigins: [...new Set([...localNetworkAddresses(), ...(process.env.DEV_ALLOWED_ORIGINS || "").split(",").map((host) => host.trim()).filter(Boolean)])],
  images: {
    remotePatterns: r2Hostname ? [{ protocol: "https", hostname: r2Hostname }] : [],
  },
};

export default nextConfig;
