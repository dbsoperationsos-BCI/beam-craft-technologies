import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { defaultPdfContent, gstLabel, templateContentFor, validityLine, validityMonthsOf } from "../src/components/sales/quotationTemplateContent.js";

/*
 * The Pricing & Total card's words and switches, set on Settings → Quotation Settings → General.
 * The defaults print exactly what the card always printed; the figures are never touched.
 */
const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const PAGE = read("components", "sales", "PublicQuotationPage.js");
const PANEL = read("components", "settings", "QuotationSettingsPanel.js");

const quotation = (snapshot = {}, extra = {}) => ({ amount: 109823, quotationDate: "2026-10-14T09:00:00Z", payload: { brandSnapshot: { gstPercent: 18, ...snapshot } }, ...extra });

test("the defaults reproduce the card as it always printed", () => {
  const content = templateContentFor(quotation());
  assert.equal(content.pricingLabel, "Pricing & Total of Services and Deliverables");
  assert.equal(content.gstLine, "+ 18% GST APPLICABLE");
  assert.equal(content.paymentLabel, "For Payment");
  assert.equal(content.validityText, "This Quotation Valid up-to 3 Months from the Date Created");
  assert.deepEqual(["pricing", "gst", "payment", "validity"].map((key) => content.sections[key]), [true, true, true, true]);
});

test("a version raised before these settings prints exactly as it did", () => {
  // Its snapshot froze the old validity sentence in full, and carries no switches for the card.
  const content = templateContentFor(quotation({ pdfContent: { validityText: "This Quotation Valid up-to 3 Months from the Date Created" }, presentation: { sections: { notes: true } } }));
  assert.equal(content.validityText, "This Quotation Valid up-to 3 Months from the Date Created");
  assert.equal(content.sections.pricing, true);
});

test("the words set on General print, with the quotation's own rate, months and date", () => {
  const content = templateContentFor(quotation({ pdfContent: { pricingLabel: "Your Investment", gstText: "GST extra at {gst}%", paymentLabel: "Pay now", validityMonths: "6", validityText: "Valid for {months} months, until {validUntil}." } }));
  assert.equal(content.pricingLabel, "Your Investment");
  assert.equal(content.gstLine, "GST extra at 18%");
  assert.equal(content.paymentLabel, "Pay now");
  assert.equal(content.validityText, "Valid for 6 months, until 14 Apr 2027.");
});

test("the GST line states the quotation's rate and never invents one", () => {
  assert.equal(gstLabel(18), "+ 18% GST APPLICABLE");
  assert.equal(gstLabel(18.5, "Plus {gst}% tax"), "Plus 18.5% tax");
  assert.equal(gstLabel(0, "Plus {gst}% tax"), "", "no rate, no line");
  assert.equal(gstLabel(null), "");
});

test("validity counts whole months from the quotation's date, and stays inside the month", () => {
  assert.equal(validityMonthsOf("12"), 12);
  for (const bad of ["", "0", "61", "2.5", "abc", null]) assert.equal(validityMonthsOf(bad), 3);
  assert.equal(validityLine("Until {validUntil}", "1", "2026-01-31T10:00:00"), "Until 28 Feb 2026");
  assert.equal(validityLine("{months} months", "9", "2026-10-14"), "9 months");
  assert.equal(defaultPdfContent.validityMonths, "3");
});

test("each switch hides only its own part, and the total is the saved one either way", () => {
  const card = PAGE.slice(PAGE.indexOf("{/* ── The money ── */}"), PAGE.indexOf("{/* ── The notes ── */}"));
  assert.match(card, /\{content\.sections\.pricing && \(\(\) => \{/);
  assert.match(card, /const gstLine = content\.sections\.gst && content\.gstLine \? content\.gstLine : "";/);
  assert.match(card, /const validityText = content\.sections\.validity && content\.validityText \? content\.validityText : "";/);
  assert.match(card, /amountText=\{currency\(quotation\.amount\)\}/);
  const off = templateContentFor(quotation({ presentation: { sections: { pricing: false, gst: false } } }));
  assert.equal(off.sections.pricing, false);
  assert.equal(off.sections.gst, false);
  assert.equal(off.sections.validity, true);
});

test("General has a Pricing & Total section: its switches, its words, and a validity it will not save out of range", () => {
  assert.match(PANEL, /\["Pricing & Total", \[\n\s*\["pricingLabel"/);
  for (const key of ["gstText", "paymentLabel", "validityMonths", "validityText"]) assert.match(PANEL, new RegExp(`\\["${key}", `));
  assert.match(PANEL, /\{sectionHeader\("pricing", "Pricing & Total", "The navy card with the quotation's total\. [^"]*"\)\}/);
  for (const key of ["gst", "payment", "validity"]) assert.match(PANEL, new RegExp(`partSwitch\\("${key}", `));
  assert.match(PANEL, /disabled=\{!dirty \|\| saving\} onClick=\{\(\) => void save\(\)\}>\{saving \? "Saving\.\.\." : "Save shared content"\}/);
  assert.match(PANEL, /if \(!fields\.check\(\{ validityMonths: validMonths\(values\.validityMonths\) \? "" : "Enter a whole number of months from 1 to 60\." \}\)\) return;/);
});
