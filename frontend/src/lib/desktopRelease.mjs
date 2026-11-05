/**
 * The published Visual Curation desktop installer, as this build of the web knows it.
 *
 * The installer is built in the desktop repository (`npm run build:release`, Tauri's NSIS and MSI
 * bundles) and hosted outside this application, so the web holds only where it was put. Nothing is
 * guessed: a missing, non-https or non-installer address reads as "not published", and the sidebar's
 * download dialog says so instead of offering a link that goes nowhere.
 *
 * Only Windows is listed. The desktop app is built on Windows alone; a macOS entry appears when a
 * macOS release exists, not before.
 */

const INSTALLER_EXTENSIONS = [".exe", ".msi"];

function fileNameOf(url) {
  const last = url.pathname.split("/").filter(Boolean).pop() || "";
  try { return decodeURIComponent(last); } catch { return last; }
}

export function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

/** `{ url, fileName, installerType, version, size }` for a usable Windows release, else `null`. */
export function readWindowsRelease({ url, version, sizeBytes } = {}) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== "https:") return null;
  const fileName = fileNameOf(parsed);
  const extension = INSTALLER_EXTENSIONS.find((ext) => fileName.toLowerCase().endsWith(ext));
  if (!extension) return null;
  return {
    url: parsed.href,
    fileName,
    installerType: extension.slice(1).toUpperCase(),
    version: String(version || "").trim(),
    size: formatFileSize(sizeBytes),
  };
}

// Written out in full so Next inlines each value at build time.
export const WINDOWS_RELEASE = readWindowsRelease({
  url: process.env.NEXT_PUBLIC_DESKTOP_WINDOWS_URL,
  version: process.env.NEXT_PUBLIC_DESKTOP_WINDOWS_VERSION,
  sizeBytes: process.env.NEXT_PUBLIC_DESKTOP_WINDOWS_SIZE_BYTES,
});
