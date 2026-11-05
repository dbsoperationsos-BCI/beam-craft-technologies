import test from "node:test";
import assert from "node:assert/strict";
import { mergeSavedDocument, parseReferenceRows, stringifyReferenceRows } from "../src/lib/crdReferenceRows.mjs";

/*
 * The client's CRD form: a remark in Photo / Video / Other Reference Links takes a space at its end
 * like any text, a photo remark can be written without a photo, and an autosave never takes back what
 * is on screen.
 */
test("a remark keeps the space typed at its end while it is being written", () => {
  const value = stringifyReferenceRows([{ link: "https://a.example", remark: "Bride " }]);
  assert.equal(parseReferenceRows(value)[0].remark, "Bride ");
  // A row holding nothing but spaces is still no row.
  assert.equal(stringifyReferenceRows([{ link: "", remark: "   " }]), "");
});

test("a photo remark stands on its own row while there is no photo", () => {
  const value = stringifyReferenceRows([{ link: "", image: "", remark: "Candid shots by the lake" }], { allowImages: true });
  assert.deepEqual(parseReferenceRows(value, { allowImages: true }), [{ link: "", image: "", remark: "Candid shots by the lake" }]);
});

test("an autosave keeps what is on screen where the server only trimmed it, and anything typed meanwhile", () => {
  const sent = { common: { specialNotes: "Arrive early ", venue: "Hall" } };
  const stored = { common: { specialNotes: "Arrive early", venue: "Hall" } };
  // Nothing typed during the save: the trailing space stays.
  assert.deepEqual(mergeSavedDocument(sent, sent, stored), sent);
  // Typed during the save: kept.
  const latest = { common: { specialNotes: "Arrive early by 8", venue: "Hall" } };
  assert.equal(mergeSavedDocument(latest, sent, stored).common.specialNotes, "Arrive early by 8");
  // A real change from the server - a photo's data stored as a link - is taken, its remark's spacing kept.
  const photoSent = stringifyReferenceRows([{ image: "data:image/png;base64,AAA", remark: "Lake " }], { allowImages: true });
  const photoStored = JSON.stringify([{ link: "", remark: "Lake", image: "https://cdn.example/1.png" }]);
  const merged = mergeSavedDocument({ common: { photoReferenceLinks: photoSent } }, { common: { photoReferenceLinks: photoSent } }, { common: { photoReferenceLinks: photoStored } });
  assert.deepEqual(parseReferenceRows(merged.common.photoReferenceLinks, { allowImages: true }), [{ link: "", remark: "Lake ", image: "https://cdn.example/1.png" }]);
});
