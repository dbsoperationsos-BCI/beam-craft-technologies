import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Client Details -> Site key: a set-up client's row makes a new key for its server, after a confirmation,
 * and shows it once as the `.env` lines - for the server, not for the client.
 *
 * Reads the source, the way the other screen tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const PAGE = read("components", "subscribe", "SubscriptionClientsPage.js");
const SERVICE = read("services", "subscribe", "client-onboarding.service.js");

test("the service posts to the team's site-key route", () => {
  assert.match(SERVICE, /export function createClientSiteKey\(id\)[\s\S]*?`\$\{BASE\}\/\$\{id\}\/site-key`, \{ method: "POST" \}/);
});

test("the manual site key is on a set-up client's row, beside Reset password, inside the write-only menu", () => {
  assert.match(PAGE, /row\.client\?\.activatedAt \? \[\s*\{ label: "Reset password"[\s\S]{0,400}\{ label: "Manual site key \(other server\)", onSelect: \(\) => setKeyingRow\(row\) \}/);
  assert.match(PAGE, /renderActions: \(row\) => \(canWrite \?/);
});

test("the key is shown once, as the .env lines, marked for the server and not the client", () => {
  assert.match(PAGE, /`BEAMCRAFT_SITE=\$\{subdomain\}`, `BEAMCRAFT_SITE_KEY=\$\{siteKey\}`, `BEAMCRAFT_API_URL=\$\{API_URL\}`/);
  assert.match(PAGE, /label="For the server's \.env, not for the client"/);
  assert.match(PAGE, /This key is shown only once/);
});

test("the manual key says it is not needed on our own server, and that a new one stops the old", () => {
  assert.match(PAGE, /Not needed for [\s\S]{0,120}connects to Beam Craft by itself/);
  assert.match(PAGE, /hasSiteKey \? " Making a new one stops the old manual key at once\." : ""/);
});
