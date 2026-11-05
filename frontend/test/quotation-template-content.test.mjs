import test from "node:test";
import assert from "node:assert/strict";

import { defaultJourney, defaultPdfContent, displayUrl, hrefFor, templateContentFor, termsAndConditions } from "../src/components/sales/quotationTemplateContent.js";

/*
 * What the client's copy prints, read off the version's own snapshot.
 *
 * The rule that matters: a version prints what it was raised with, and a version raised before
 * the snapshot held something falls back to the standard words - never to a name or a website
 * written into the code.
 */

test("a version without a snapshot prints the standard words and no studio name of its own", () => {
  const content = templateContentFor({ payload: { rates: { gstPercent: 18 } } });
  assert.equal(content.eventSectionTitle, defaultPdfContent.eventSectionTitle);
  assert.equal(content.brandName, "Beam Craft", "the bundled name stands in for a blank Global Name");
  assert.equal(content.contact.websiteUrl, "");
  assert.deepEqual(content.terms, termsAndConditions);
  assert.deepEqual(content.journey, defaultJourney);
  assert.equal(content.gstPercent, 18);
  // `{brand}` is emptied rather than printed as a placeholder.
  assert.equal(content.footerNote.includes("{brand}"), false);
});

test("the live Global Name and Global Logo stand in only for a version whose snapshot names none", () => {
  const branding = { studioName: "Beam Craft", galleryLogoUrl: "https://cdn/global.webp" };
  const legacy = templateContentFor({ payload: {} }, branding);
  assert.equal(legacy.brandName, "Beam Craft");
  assert.equal(legacy.logoUrl, "https://cdn/global.webp");
  assert.equal(legacy.copyright.startsWith("Copyright ©"), true);
  assert.ok(legacy.copyright.endsWith("Beam Craft. All rights reserved."));

  const snapshotted = templateContentFor({
    logoUrl: "https://cdn/issued.webp",
    brandSnapshot: { pdfContent: {}, presentation: { studioName: "Don't Blink Studioz", brandDisplayName: "Don't Blink Studioz" } },
  }, branding);
  assert.equal(snapshotted.brandName, "Don't Blink Studioz", "today's Global Name must not replace the name the version was sent under");
  assert.equal(snapshotted.logoUrl, "https://cdn/issued.webp");
});

test("the brand's overrides, pictures, branch and timeline come from the snapshot", () => {
  const content = templateContentFor({
    brandSnapshot: {
      pdfContent: { eventSectionLabel: "Production scope", eventSectionTitle: "Project Itinerary", footerNote: "Reach {brand} any time." },
      terms: [{ title: "Payment", body: "50% advance." }],
      gstPercent: 5,
      presentation: {
        studioName: "Don't Blink Studioz",
        assets: { coverImageUrl: "https://cdn/cover.webp", infrastructure: [{ title: "Erode", subtitle: "Tamil Nadu", photos: ["https://cdn/1.webp"] }], journey: [{ year: "2020", title: "Founded", detail: "", place: "Erode" }] },
        branch: { name: "Erode TN", websiteUrl: "https://www.example.com/", phone: "+91 90000 00000" },
        locations: [{ name: "Erode", isHeadOffice: true }, { name: "Vizag" }],
        contact: { phone: "+91 90000 00000", websiteUrl: "https://www.example.com/", socialHandle: "example_corp" },
      },
    },
  });
  assert.equal(content.eventSectionLabel, "Production scope");
  assert.equal(content.eventSectionTitle, "Project Itinerary");
  assert.equal(content.brandName, "Don't Blink Studioz", "the name is the Global Name the version was raised under");
  assert.equal(content.footerNote, "Reach Don't Blink Studioz any time.");
  assert.equal(content.assets.coverImageUrl, "https://cdn/cover.webp");
  assert.equal(content.assets.infrastructure[0].title, "Erode");
  assert.deepEqual(content.journey.map((row) => row.title), ["Founded"]);
  assert.equal(content.contact.websiteUrl, "https://www.example.com/");
  assert.equal(content.contact.phone, "+91 90000 00000");
  assert.equal(content.locations.length, 2);
  assert.equal(content.gstPercent, 5);
  assert.deepEqual(content.terms, [{ title: "Payment", body: "50% advance." }]);
});

test("a typed website or phone in the brand's wording wins over the branch's", () => {
  const content = templateContentFor({
    brandSnapshot: { pdfContent: { websiteUrl: "www.brand.com", contactPhone: "12345" }, presentation: { contact: { websiteUrl: "https://branch.com", phone: "999" } } },
  });
  assert.equal(content.contact.websiteUrl, "www.brand.com");
  assert.equal(content.contact.phone, "12345");
});

test("a website prints without its scheme and links with one", () => {
  assert.equal(displayUrl("https://www.dontblinkstudioz.com/"), "www.dontblinkstudioz.com");
  assert.equal(displayUrl("www.example.com"), "www.example.com");
  assert.equal(hrefFor("www.example.com"), "https://www.example.com");
  assert.equal(hrefFor("http://example.com"), "http://example.com");
  assert.equal(hrefFor(""), "");
});

test("the template's old default wording in a snapshot reads as nothing chosen", () => {
  const content = templateContentFor({ brandSnapshot: { pdfContent: { eventSectionLabel: "The celebration", eventSectionTitle: "Event Coverage", closingQuote: "Our own line." } } });
  assert.equal(content.eventSectionLabel, defaultPdfContent.eventSectionLabel);
  assert.equal(content.eventSectionTitle, defaultPdfContent.eventSectionTitle);
  assert.equal(content.closingQuote, "Our own line.", "a brand's own words are kept");
});
