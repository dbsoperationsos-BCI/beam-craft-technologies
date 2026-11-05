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

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: projectRoot,
  },
  // No "N" route badge in the corner while developing. Build and runtime errors still show.
  devIndicators: false,
  images: {
    remotePatterns: r2Hostname ? [{ protocol: "https", hostname: r2Hostname }] : [],
  },
};

export default nextConfig;
