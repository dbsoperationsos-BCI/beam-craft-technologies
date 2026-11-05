import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * For Payment, as the client's copy reads it.
 *
 * The quotation prints a small link under its price - set like the terms link, and only where the
 * Assigned Branch holds some way to be paid - and the page it opens shows the branch's account,
 * UPI ID and QR with a section for each only where there is something to show. The terms link,
 * its page and the pricing card's figures are not touched.
 *
 * Reads the source, the way the other control tests in this suite do: there is no DOM here.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const PUBLIC_PAGE = src("components", "sales", "PublicQuotationPage.js");
const PAYMENT_PAGE = src("components", "sales", "PublicQuotationPaymentPage.js");
const TERMS_PAGE = src("components", "sales", "PublicQuotationTermsPage.js");
const SERVICE = src("services", "sales", "public-quotation.service.js");
const ROUTE = src("app", "q", "[token]", "payment", "page.js");

test("the pricing card prints the payment link between the GST line and the validity line, only where there is a page to open", () => {
  const card = PUBLIC_PAGE.slice(PUBLIC_PAGE.indexOf("{/* ── The money ── */}"), PUBLIC_PAGE.indexOf("{/* ── The notes ── */}"));
  // The card itself lives in `QuotationPricingCards.js`, shared with the Extras & Changes cards.
  const CARD = src("components", "sales", "QuotationPricingCards.js");
  const drawn = CARD.slice(CARD.indexOf("export function QuotationPricingCard("));
  const gst = drawn.indexOf("{gstLine}");
  const link = drawn.indexOf("<PaymentLink");
  const validity = drawn.indexOf("{validityText}");
  assert.ok(gst > -1 && link > gst && validity > link, "GST line, then the payment link, then the validity line");
  // Its words - "For Payment" unless General says otherwise - and its switch; still only where there is a page.
  assert.match(card, /content\.sections\.payment && content\.paymentLabel && quotation\.paymentDetailsAvailable === true \? content\.paymentLabel : ""/);
  assert.match(drawn, /\{Boolean\(paymentLabel\) && <PaymentLink href=\{paymentHref\} label=\{paymentLabel\} \/>\}/);
  // Set like the terms link - small, underlined, the same letter-spacing - in the sheet's gold on navy.
  assert.match(CARD, /<p className="mt-4">\n\s*<a href=\{href\} className="text-\[12\.5px\] font-semibold underline underline-offset-4" style=\{\{ color: GOLD, letterSpacing: "\.04em" \}\}>\{label\}<\/a>/);
  // The figures are as they were.
  assert.match(card, /amountText=\{currency\(quotation\.amount\)\}/);
});

test("the link is made absolute for the PDF exactly as the terms link is, and the terms link is unchanged", () => {
  assert.match(PUBLIC_PAGE, /const paymentPath = `\/q\/\$\{encodeURIComponent\(token\)\}\/payment`;/);
  // No link at all in the studio's Preview, which has no page behind either; on a link, as before.
  assert.match(PUBLIC_PAGE, /const paymentHref = preview \? undefined : printMode && typeof window !== "undefined" \? `\$\{window\.location\.origin\}\$\{paymentPath\}` : paymentPath;/);
  assert.match(PUBLIC_PAGE, /const termsHref = preview \? undefined : printMode && typeof window !== "undefined" \? `\$\{window\.location\.origin\}\$\{termsPath\}` : termsPath;/);
  assert.match(PUBLIC_PAGE, /<a href=\{termsHref\} className="text-\[12\.5px\] font-semibold underline underline-offset-4" style=\{\{ color: "#1a5cd6", letterSpacing: "\.04em" \}\}>\{content\.termsTitle\}<\/a>/);
  assert.match(TERMS_PAGE, /PublicQuotationTermsPage\(\{ token \}\)/);
});

test("the payment page is its own route on the same sheet, reading its own public call", () => {
  assert.match(ROUTE, /import PublicQuotationPaymentPage from "@\/components\/sales\/PublicQuotationPaymentPage"/);
  assert.match(SERVICE, /export async function getPublicQuotationPayment\(token\)/);
  assert.match(SERVICE, /\/api\/public\/quotations\/\$\{encodeURIComponent\(token\)\}\/payment/);
  assert.match(PAYMENT_PAGE, /import \{ Eyebrow, GOLD, GOLD_DEEP, INK, QUOTATION_BODY_FONT, RuledTitle, SHEET_CSS, sheetBackground \} from "\.\/PublicQuotationPage"/);
  assert.match(PAYMENT_PAGE, /getPublicQuotationPayment\(token\)/);
  // Nothing here reaches the admin register.
  assert.doesNotMatch(PAYMENT_PAGE, /admin\/branches|branches\.service/);
});

test("each section prints only where the branch holds something for it, and nothing is invented", () => {
  assert.match(PAYMENT_PAGE, /\.filter\(\(\[, value\]\) => Boolean\(value\)\)/, "bank rows drop the blanks");
  /*
   * One card per account, since a branch may be paid into several: the list is the branch's own
   * order, the first account being the one it leads with, and a branch paid into one prints exactly
   * the card it printed when a branch could hold only one.
   */
  assert.match(PAYMENT_PAGE, /\{accounts\.map\(\(account, index\) => <PaymentCard/);
  // Numbered, and named by its bank: two cards differing only in a numeral ask a client to compare
  // account numbers to tell which is which.
  assert.match(PAYMENT_PAGE, /title=\{accounts\.length > 1 \? `Bank Transfer \$\{index \+ 1\}\$\{account\.bank \? ` · \$\{account\.bank\}` : ""\}` : "Bank Transfer"\}/);
  // Cards with nothing to print are dropped *before* they are numbered, so the numbers cannot read
  // 1 then 3 with nothing between them.
  assert.match(PAYMENT_PAGE, /\.filter\(\(account\) => account\.rows\.length > 0\);/);
  // And a client handed two accounts is told whether the studio wants one payment or two.
  assert.match(PAYMENT_PAGE, /Pay into any one of these accounts\./);
  assert.match(PAYMENT_PAGE, /\{upiIds\.length > 0 && <PaymentCard title="UPI Payment">/);
  // Every handle the branch holds, each its own row - a branch with one reads as it always did.
  assert.match(PAYMENT_PAGE, /\{upiIds\.map\(\(upiId, index\) => <PaymentRow/);
  // The copy control prints no word, so its name is the only thing telling two of them apart.
  assert.match(PAYMENT_PAGE, /name=\{upiIds\.length > 1 \? `UPI ID \$\{index \+ 1\}` : "UPI ID"\}/);
  assert.match(PAYMENT_PAGE, /aria-label=\{copied \? `\$\{controlName\} copied` : `Copy \$\{controlName\}`\}/);
  assert.match(PAYMENT_PAGE, /const upiIds = Array\.isArray\(payment\?\.upiIds\) \? payment\.upiIds\.filter\(Boolean\) : \[\]/);
  assert.match(PAYMENT_PAGE, /\{Boolean\(payment\.paymentQrUrl\) && <PaymentCard title="Payment QR">/);
  assert.match(PAYMENT_PAGE, /Scan using any supported UPI application/);
  assert.match(PAYMENT_PAGE, /Payment details are not available for this quotation/);
});

test("account number, IFSC and UPI ID carry an icon-only copy control on the studio's own clipboard helper", () => {
  assert.match(PAYMENT_PAGE, /import \{ copyToClipboard \} from "@\/lib\/clipboard"/);
  assert.match(PAYMENT_PAGE, /\["Account Number", account\.accountNumber, true\]/);
  assert.match(PAYMENT_PAGE, /\["IFSC Code", account\.ifsc, true\]/);
  assert.match(PAYMENT_PAGE, /\["Account Holder Name", account\.accountHolderName, false\]/);
  // And the copy control on a second card is told apart from the first's, as the UPI rows are.
  assert.match(PAYMENT_PAGE, /name=\{accounts\.length > 1 \? `\$\{label\}, \$\{account\.bank \|\| `account \$\{index \+ 1\}`\}` : label\}/);
  assert.match(PAYMENT_PAGE, /key=\{upiId\}\s*\n\s*label="UPI ID"/);
  // The icon and nothing else: a tick for a moment on success, and the name only where it is not
  // printed - on the button for a screen reader, in the tooltip for a mouse.
  assert.match(PAYMENT_PAGE, /\{copied \? <CheckRounded[^>]*\/> : <ContentCopyRounded[^>]*\/>\}/);
  assert.doesNotMatch(PAYMENT_PAGE, /"Copied"|copyLabel/, "no word is printed beside the icon");
  assert.match(PAYMENT_PAGE, /title=\{`Copy \$\{controlName\}`\}/);
  // The control is the shared Button, not a typed <button>.
  assert.doesNotMatch(PAYMENT_PAGE, /<button/);
});
