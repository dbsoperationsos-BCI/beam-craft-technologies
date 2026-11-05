const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_USAGE_TIMEOUT_MINUTES, MIN_USAGE_TIMEOUT_MINUTES, MAX_USAGE_TIMEOUT_MINUTES,
} = require("../src/modules/usage/settings/service");

/*
 * The one number that decides what "in use" means for the whole studio.
 *
 * It is read by every browser and written by an administrator, so the things worth pinning down are
 * that the two ends agree about the default, that the write is guarded and the read is not, and
 * that the bounds are ones the heartbeat can actually honour.
 */

test("the default is three minutes, and the browser's fallback says the same", () => {
  assert.equal(DEFAULT_USAGE_TIMEOUT_MINUTES, 3);
  // The browser carries its own copy for the moment before its first beat comes back. If the two
  // disagree, a tab that has just opened measures usage differently from one that has been up a
  // while - which is the fault holding the number on the server was meant to end.
  const lib = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "lib", "usageHeartbeat.js"), "utf8");
  const fallback = lib.match(/export const IDLE_AFTER_MS = ([0-9_]+);/);
  assert.ok(fallback, "usageHeartbeat.js no longer states a fallback");
  assert.equal(Number(fallback[1].replace(/_/g, "")), DEFAULT_USAGE_TIMEOUT_MINUTES * 60_000);
});

test("the column default matches, so a fresh install and an upgraded one agree", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "..", "prisma", "migrations", "20260903140000_app_monitoring_settings", "migration.sql"),
    "utf8",
  );
  assert.match(migration, new RegExp(`\`usage_timeout_minutes\` INTEGER NOT NULL DEFAULT ${DEFAULT_USAGE_TIMEOUT_MINUTES}`));
  // And a row is seeded, so the read path never has to invent one.
  assert.match(migration, /INSERT IGNORE INTO `app_monitoring_settings`/);
});

test("the bounds are ones the heartbeat can honour", () => {
  const { HEARTBEAT_SECONDS } = require("../src/modules/usage/heartbeat/service");
  // Shorter than two beats and a stretch would end between one beat and the next, recording
  // somebody working continuously as a string of fragments.
  assert.ok(MIN_USAGE_TIMEOUT_MINUTES * 60 >= HEARTBEAT_SECONDS * 2,
    "the minimum timeout is shorter than two heartbeats, so continuous work would read as fragments");
  assert.ok(MAX_USAGE_TIMEOUT_MINUTES > MIN_USAGE_TIMEOUT_MINUTES);
  assert.ok(DEFAULT_USAGE_TIMEOUT_MINUTES >= MIN_USAGE_TIMEOUT_MINUTES && DEFAULT_USAGE_TIMEOUT_MINUTES <= MAX_USAGE_TIMEOUT_MINUTES);
});

test("the read is open to anybody signed in and the write is not", () => {
  /*
   * Every browser needs the timeout to know when to stop counting somebody as active, so guarding
   * the GET would leave most of the studio measuring usage by a number nobody told them. The write
   * is the privileged half, and it names this section's own row on the Settings rail.
   */
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "usage", "settings", "routes.js"), "utf8");
  assert.match(routes, /router\.use\(protect\)/, "the settings routes are not behind authentication");
  assert.match(routes, /router\.get\("\/", getSettings\)/, "the read should carry no permission guard");
  assert.match(routes, /router\.patch\("\/",\s*checkPermission\("SETTINGS", "Application Monitoring", "READ_WRITE"\)/,
    "the write is no longer guarded by SETTINGS / Application Monitoring");
  // The router-wide form would guard the GET too, which is the mistake this shape exists to avoid.
  assert.doesNotMatch(routes, /router\.use\(requireModule/);
});
