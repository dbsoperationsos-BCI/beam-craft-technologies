import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { posterText } from "../src/lib/qrPoster.mjs";

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

test("the link code and the PIN are never typed: no field edits either, and the server makes both", () => {
  const share = read("components", "ai-feature", "event", "ShareDialog.js");
  assert.doesNotMatch(share, /label="Link code"|label="PIN"|Save link settings|TextField/);
  assert.match(share, /<ActionField\s+label="Event link"/);
  assert.match(share, /<ActionField\s+label="Access PIN"/);
  assert.match(share, /label: "New link code"[^\n]*setConfirm\("code"\)/);
  assert.match(share, /label: "Reset PIN"[^\n]*setConfirm\("pin"\)/);
  assert.match(share, /applyChange\(\{ newCode: true \}/);
  assert.match(share, /applyChange\(\{ newPin: true \}/);
  // One switch for the PIN, on the Access PIN field, applied at once; no revoking here; no helper text.
  assert.match(share, /label="Access PIN"\s+(?:helperText="[^"]*"\s+)?labelAside=\{<ToggleSwitch[^\n]*label="Require a PIN to open"[^\n]*applyChange\(\{ requirePin: checked \}/);
  assert.doesNotMatch(share, /revokeAiShare|Revoke link|confirm === "revoke"|A four-digit PIN is generated with the link/);
  assert.match(share, /title="Make a new link code\?"/);
  assert.match(share, /title="Reset the PIN\?"/);
  // One compact dialog: no Link and PIN card and no footer Regenerate.
  assert.doesNotMatch(share, /Link and PIN|>Regenerate<|confirm === "regenerate"/);
  // Opening the dialog only reads.
  const load = share.match(/const load = useCallback\(async \(\) => \{[\s\S]*?\}, \[eventId\]\);/)[0];
  assert.doesNotMatch(load, /updateAiShare|createAiShare/);
});

test("a poster prints a PIN only when the link has one and Print PIN is on", () => {
  const kit = (pin) => ({ url: "https://studio.example/e/5G5TVW", pin, event: { name: "Wedding" } });
  assert.equal(posterText(kit("3955"), {}).pin, "3955");
  assert.equal(posterText(kit("3955"), { showPin: false }).pin, "");
  assert.equal(posterText(kit(null), { showPin: true }).pin, "");
});
