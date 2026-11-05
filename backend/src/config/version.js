/*
 * What this process is running, resolved once at boot.
 *
 * The deploy writes a RELEASE file at the repository root on the VPS — the version it computed,
 * the commit it reset to, and when — and this reads it back. Reading the server's own file rather
 * than trusting an environment variable is deliberate: it is written by the same step that built
 * the frontend and restarted PM2, so if it says 1.2.41 then 1.2.41 is what was deployed. The health
 * check compares this against the version the workflow expected, which is what catches a PM2
 * process that restarted but kept running the code it already had.
 *
 * Locally there is no RELEASE file. The version then falls back to the VERSION file with a `dev`
 * build, because the build number counts promotions to main and a working copy has not had one.
 */
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../../..");

function readReleaseFile() {
  try {
    const raw = fs.readFileSync(path.join(REPO_ROOT, "RELEASE"), "utf8");
    const fields = {};
    for (const line of raw.split("\n")) {
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
    return fields.VERSION ? fields : null;
  } catch {
    // No RELEASE file is the normal case in development, not a failure worth logging.
    return null;
  }
}

function readVersionFile() {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, "VERSION"), "utf8").trim();
  } catch {
    return null;
  }
}

const release = readReleaseFile();
const majorMinor = readVersionFile();

const appVersion = {
  // "1.2.41" in production; "1.0.dev" locally; "unknown" if neither file can be read.
  version: release?.VERSION || (majorMinor ? `${majorMinor}.dev` : "unknown"),
  // The commit the VPS was reset to. Null outside a deploy — a working copy's HEAD moves.
  commit: release?.COMMIT || null,
  deployedAt: release?.DEPLOYED_AT || null,
};

module.exports = { appVersion };
