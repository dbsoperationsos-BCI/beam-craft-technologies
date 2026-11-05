import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { linkTimeLeft } from "../src/lib/expiredLink.mjs";

const now = new Date("2026-10-01T10:00:00+05:30");
const after = (minutes) => new Date(now.getTime() + minutes * 60000).toISOString();
const label = (minutes, at = now) => linkTimeLeft(after(minutes), at)?.label;

test("the time left is said in days, hours and minutes, on one line and with no date", () => {
  assert.deepEqual(linkTimeLeft(after(4 * 1440 + 18 * 60 + 32), now), { label: "Expires in 4d 18h 32m", lead: "Expires in 4d", rest: "18h 32m" });
  assert.equal(label(1440 + 3 * 60 + 10), "Expires in 1d 3h 10m");
  assert.equal(label(12 * 60 + 45), "Expires in 12h 45m");
  assert.equal(label(42), "Expires in 42m");
  // Counted from the stored expiry: a day later it says a day less.
  assert.equal(label(4 * 1440 + 18 * 60 + 32, new Date(now.getTime() + 1440 * 60000)), "Expires in 3d 18h 32m");
});

test("the badge's two lines are the label's own pieces: the days, then the hours and minutes", () => {
  const lines = (minutes) => { const left = linkTimeLeft(after(minutes), now); return [left.lead, left.rest]; };
  assert.deepEqual(lines(3 * 1440 + 22 * 60 + 39), ["Expires in 3d", "22h 39m"]);
  assert.deepEqual(lines(3 * 1440 + 22 * 60 + 38), ["Expires in 3d", "22h 38m"], "a minute later, a minute less");
  assert.deepEqual(lines(3 * 1440 + 20), ["Expires in 3d", "20m"]);
  assert.deepEqual(lines(2 * 1440), ["Expires in 2d", ""], "whole days alone need no second line");
  assert.deepEqual(lines(12 * 60 + 45), ["Expires in", "12h 45m"]);
  assert.deepEqual(lines(42), ["Expires in", "42m"]);
  assert.deepEqual(lines(0.5), ["Expires in", "under 1m"]);
  for (const minutes of [3 * 1440 + 22 * 60 + 39, 2 * 1440, 765, 42, 0.5]) {
    const left = linkTimeLeft(after(minutes), now);
    assert.equal(`${left.lead} ${left.rest}`.trim(), left.label, "nothing counted twice");
  }
});

test("a unit that is nought is left out, and seconds are never shown", () => {
  assert.equal(label(2 * 1440), "Expires in 2d");
  assert.equal(label(3 * 1440 + 20), "Expires in 3d 20m");
  assert.equal(label(1440 + 5 * 60), "Expires in 1d 5h");
  assert.equal(label(3 * 60), "Expires in 3h");
  assert.equal(label(42.9), "Expires in 42m", "partial minutes round down");
  assert.equal(label(0.5), "Expires in under 1m");
});

test("nothing is shown with no expiry, an unreadable one, or one already past - the server owns expired links", () => {
  for (const value of [null, undefined, "", "not a date", after(-1)]) assert.equal(linkTimeLeft(value, now), null, String(value));
});

test("the chip floats bottom-right, clear of Download and out of the PDF; the header and expired page are untouched", () => {
  const page = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "PublicQuotationPage.js"), "utf8");
  // On every client link; only the PDF, the studio's Preview (which has no link) and the client's app
  // (which shows the quotation inside itself, `#embed=app`) leave it out.
  assert.match(page, /\{!printMode && !preview && !embed\.app && <FloatingExpiry expiresAt=\{quotation\.linkExpiresAt\} \/>\}/);
  const chip = page.slice(page.indexOf("function FloatingExpiry"), page.indexOf("function", page.indexOf("function FloatingExpiry") + 10));
  // Fixed, so it takes no room in the page; anchored bottom-right with safe spacing from the edges.
  assert.match(chip, /className="no-print fixed bottom-0 right-0 z-50"/);
  assert.match(chip, /transformOrigin: "bottom right"/);
  assert.match(chip, /const inset = phone \? 10 : 12;/);
  assert.match(chip, /marginRight: `max\(\$\{inset\}px, env\(safe-area-inset-right\)\)`, marginBottom: `max\(\$\{inset\}px, env\(safe-area-inset-bottom\)\)`/);
  // On a phone screen, one compact line with the same label the countdown already builds.
  assert.match(chip, /<span className="whitespace-nowrap text-\[11px\] font-semibold leading-none tabular-nums">\{left\.label\}<\/span>/);
  // Download keeps the top-right corner.
  assert.match(page, /className="no-print fixed right-0 top-0 z-50"/);
  // Two lines, the time left the stronger, no date - and one timer, ticking without a refresh.
  assert.match(chip, /<span className="text-\[11px\] font-medium">\{left\.lead\}<\/span>/);
  assert.match(chip, /\{left\.rest && <span className="text-\[12px\] font-semibold">\{left\.rest\}<\/span>\}/);
  assert.doesNotMatch(chip, /left\.date|Valid until/);
  assert.equal((page.match(/setInterval\(/g) || []).length, 1);
  assert.match(chip, /window\.setInterval\(\(\) => setNow\(Date\.now\(\)\), 30000\)/);
  // The proposal header carries no expiry.
  const header = page.slice(page.indexOf("{/* ── The proposal ── */}"), page.indexOf("{/* ── The events ── */}"));
  assert.doesNotMatch(header, /linkTimeLeft|Expires|FloatingExpiry/);
  // The expired page is still the one the 410 opens, before anything of the quotation is drawn.
  assert.match(page, /if \(expired\) return <ExpiredClientLink \{\.\.\.expired\} data-quotation-state="expired" \/>;/);
  assert.ok(page.indexOf("if (expired) return <ExpiredClientLink") < page.indexOf("<FloatingExpiry expiresAt="));
});
