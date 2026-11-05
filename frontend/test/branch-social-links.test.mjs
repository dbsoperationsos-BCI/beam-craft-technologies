import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LINK_PATTERN, MAX_LABELLED_LINKS, linkListErrors, linkListOf, linkListPayload, newLinkProblems } from "../src/lib/labelledLinks.mjs";

/*
 * Settings → Organization → Branches → Edit: the External URLs section (Web URL, Location URL and
 * Review Link, each added from a dropdown and removable) and Social Media Links (named freely).
 * Both are one component, `LabelledLinksField`, and one set of rules, `labelledLinks`.
 */
const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const PANEL = read("components", "settings", "BranchesPanel.js");
const FIELD = read("components", "shared", "LabelledLinksField.js");

test("External URLs sits above Social Media Links, and its three are added from a dropdown, not fixed boxes", () => {
  const external = PANEL.indexOf(">External URLs<");
  const social = PANEL.indexOf(">Social Media Links<");
  assert.ok(external > 0 && social > external, "External URLs comes first");
  const block = PANEL.slice(PANEL.indexOf("const EXTERNAL_URLS = ["), PANEL.indexOf("];", PANEL.indexOf("const EXTERNAL_URLS = [")));
  assert.deepEqual([...block.matchAll(/\["(\w+)", "([^"]+)"\]/g)].map((match) => [match[1], match[2]]), [
    ["websiteUrl", "Web URL"],
    ["locationUrl", "Location URL"],
    ["googleReviewUrl", "Review Link"],
  ]);
  const externalSection = PANEL.slice(external, social);
  assert.doesNotMatch(externalSection, /<TextField label="Web URL"/, "no fixed box any more");
  assert.match(externalSection, /<LabelledLinksField\s+links=\{externalRows\}\s+onChange=\{updateExternal\}/);
  assert.match(externalSection, /addLabel="\+ Add external URL"/);
  assert.match(externalSection, /labelOptions=\{EXTERNAL_URLS\.map\(\(\[, label\]\) => label\)\}/);
  // A row shows while its column holds a link; deleting it empties the column.
  assert.match(PANEL, /externalShown: EXTERNAL_URLS\.map\(\(\[field\]\) => field\)\.filter\(\(field\) => String\(branch\[field\] \|\| ""\)\.trim\(\)\)/);
  assert.match(PANEL, /\[field, rows\.find\(\(row\) => externalFieldOf\(row\.label\) === field\)\?\.url \?\? ""\]/);
  // In the component: a dropdown of the ones not yet added, and the button disabled once none is left.
  assert.match(FIELD, /const remaining = labelOptions \? labelOptions\.filter\(\(option\) => !links\.some\(\(link\) => link\.label === option\)\) : null;/);
  assert.match(FIELD, /<Dropdown\s+required\s+label="Label"/);
  assert.match(FIELD, /disabled=\{disabled \|\| !remaining\.length\}/);
});

test("Social Media Links has no fixed fields - only the links the studio adds, with the same component", () => {
  assert.doesNotMatch(PANEL, /const SOCIAL_LINKS = \[|facebookUrl|linkedinUrl|instagramUrl/);
  const section = PANEL.slice(PANEL.indexOf(">Social Media Links<"), PANEL.indexOf(">Registration<"));
  assert.match(section, /<LabelledLinksField\s+links=\{form\.customSocialLinks \|\| \[\]\}/);
  assert.match(section, /addLabel="\+ Add social media link"/);
});

test("the add dialog asks for the label and the link together, and checks both", () => {
  assert.deepEqual(newLinkProblems({ label: "", url: "" }), { label: "Name the link.", url: "Enter the link." });
  assert.deepEqual(newLinkProblems({ label: "YouTube", url: "ask at the desk" }), { url: "Enter a valid link, starting with https://." });
  // A label used by a row already there, or by a fixed field of the same section, is refused.
  assert.equal(newLinkProblems({ label: "youtube", url: "https://y.com" }, { links: [{ label: "YouTube", url: "https://x.com" }] }).label, "There is already a link with this label.");
  assert.equal(newLinkProblems({ label: "Location URL", url: "https://y.com" }, { reservedLabels: ["Web URL", "Location URL"] }).label, "There is already a link with this label.");
  assert.deepEqual(newLinkProblems({ label: " Portfolio ", url: "beamcraft.in/work" }), {});
  // Both boxes in one dialog, and the row arrives filled in.
  assert.match(FIELD, /label="Label"[\s\S]*?value=\{draft\.label\}/);
  assert.match(FIELD, /label="Link"[\s\S]*?value=\{draft\.url\}/);
  assert.match(FIELD, /onChange\(\[\.\.\.links, \{ label: draft\.label\.trim\(\), url: draft\.url\.trim\(\) \}\]\)/);
});

test("each added row stays editable and removable, at most ten, and is checked and sent like the rest", () => {
  assert.equal(MAX_LABELLED_LINKS, 10);
  assert.match(FIELD, /ariaLabel=\{`Remove the \$\{link\.label\} link`\}/);
  assert.match(FIELD, /links\.length < max/);
  // On save: an emptied row is said, a sentence is refused, a good one passes.
  assert.deepEqual(linkListErrors([{ label: "A", url: "" }, { label: "B", url: "nope" }, { label: "C", url: "https://c.com" }]),
    ["Enter the link, or remove this field.", "Enter a valid link, starting with https://.", ""]);
  assert.deepEqual(linkListPayload([{ label: " A ", url: " https://a.com " }]), [{ label: "A", url: "https://a.com" }]);
  assert.deepEqual(linkListOf(null), []);
  // The social list, in the form's checks and in what it sends; the External URLs go as their own columns.
  assert.match(PANEL, /const socialErrors = linkListErrors\(form\.customSocialLinks\);/);
  assert.match(PANEL, /customSocialLinks: linkListPayload\(values\.customSocialLinks\),/);
  assert.doesNotMatch(PANEL, /customExternalLinks/);
  // Loose, but nothing other than http(s) may come before the address - the server's rule.
  assert.equal(LINK_PATTERN.test("instagram.com/beamcraft"), true);
  assert.equal(LINK_PATTERN.test("javascript:alert(1).x"), false);
});
