const { getBrowser } = require("./quotationPdfService");
const { escapeHtml } = require("./emailTemplates");
const { amountInWords, fallbackLogo, logoSource } = require("./payslipPdfService");

/*
 * The invoice for one cash received entry, as a PDF: "Invoice" with its number and date of issue and
 * the studio's logo beside it; the studio (name, the branch's address, phone, email and GSTIN) beside
 * Bill to (the client's name, phone and email); then the payment itself - what it was towards, its
 * mode, who received it, and the amount in figures and words. No due date: the money has already come
 * in. Written as HTML here and printed to A4 by the same headless browser the quotation and the
 * payslip use. Building the facts is `modules/accounts/cash-entries/receipt.js`'s.
 */

const money = (value) => (Number(value) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Written out rather than by `Intl`, so the date on a client's document never depends on the Node build. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(value) {
  const at = value ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime())) return "";
  return `${String(at.getDate()).padStart(2, "0")} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

const row = (label, value) => (value ? `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>` : "");
const line = (text) => (text ? `<p>${escapeHtml(text)}</p>` : "");

/*
 * One A4 page, a single white surface laid out down the whole page rather than packed at the top: "Invoice", its number and date and the logo at the head;
 * the studio beside Bill to; the payment details as a two-column box - what it was towards, its mode,
 * who received it, the amount received with its words beneath, and the total still due; and, held to the foot
 * of the page, the thank-you and the computer-generated note.
 */
function receiptHtml(receipt) {
  const { studio = {}, payment = {}, client = {} } = receipt;
  const logo = logoSource(studio.logoUrl) || fallbackLogo();
  const reference = payment.transactionId ? `Ref: ${payment.transactionId}` : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Invoice - ${escapeHtml(payment.number)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #1e293b; }
  .sheet { position: relative; width: 210mm; height: 297mm; display: flex; flex-direction: column; overflow: hidden; padding: 22mm 20mm 16mm 50mm; }
  /* The one ornament: two thin parallel lines on one sweeping curve, set in from the left edge, clear of the text. */
  .wave { position: absolute; top: 0; left: 4mm; width: 42mm; height: 100%; }
  .sheet > :not(.wave) { position: relative; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  h1 { margin: 10mm 0 22px; font-size: 60px; font-weight: 700; letter-spacing: -0.01em; color: #0f172a; }
  .logo { max-height: 70px; max-width: 170px; object-fit: contain; }
  .meta { border-collapse: collapse; }
  .meta th, .meta td { padding: 3px 18px 3px 0; text-align: left; font-size: 12px; }
  .meta th { font-weight: 400; color: #64748b; }
  .meta tr:first-child th, .meta tr:first-child td { font-weight: 700; color: #0f172a; }
  .rule { height: 1px; background: #e5e7eb; margin: 14mm 0 10mm; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
  .parties p { margin: 3px 0; font-size: 12px; line-height: 1.5; color: #334155; }
  .parties .label { margin-bottom: 8px; font-size: 11px; color: #94a3b8; }
  .parties .name { font-size: 13px; font-weight: 700; color: #0f172a; }
  /* The payment as a two-column box: the label on the left on grey, its value on the right. */
  h2 { margin: 16mm 0 8px; font-size: 13px; font-weight: 700; color: #0f172a; }
  .details { width: 100%; border-collapse: collapse; }
  .details th, .details td { border: 1px solid #e2e5ea; padding: 11px 14px; text-align: left; vertical-align: top; font-size: 12px; }
  .details th { width: 36%; font-weight: 600; color: #475569; background: #f3f4f6; }
  .details td { color: #0f172a; }
  .details .strong td { font-size: 14px; font-weight: 700; }
  /* The amount in words, under the figure in the same cell. */
  .details .words { margin-top: 4px; font-size: 11px; font-weight: 400; color: #64748b; }
  .details .due td { font-size: 16px; font-weight: 700; }
  .spacer { flex: 1; }
  .foot { padding-top: 8mm; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
  .foot .thanks { margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #0f172a; }
  .foot p { margin: 2px 0; color: #64748b; }
</style></head>
<body><div class="sheet">
  <svg class="wave" viewBox="0 0 100 1000" preserveAspectRatio="none" aria-hidden="true">
    <!-- Two lines on one sweeping curve, parallel all the way down: a broad soft one, and a firmer one beside it. -->
    <path d="M56 -60 C 56 110 24 110 24 280 C 24 450 56 450 56 620 C 56 790 24 790 24 960 C 24 1130 56 1130 56 1300" fill="none" stroke="#e6e9ee" stroke-width="7" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    <path d="M70 -60 C 70 110 38 110 38 280 C 38 450 70 450 70 620 C 70 790 38 790 38 960 C 38 1130 70 1130 70 1300" fill="none" stroke="#c7cfd9" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg>
  <div class="top">
    <div>
      <h1>Invoice</h1>
      <table class="meta"><tbody>
        <tr><th>Invoice number</th><td>${escapeHtml(payment.number)}</td></tr>
        <tr><th>Date of issue</th><td>${escapeHtml(dayLabel(payment.date))}</td></tr>
      </tbody></table>
    </div>
    <img class="logo" src="${escapeHtml(logo)}" alt="">
  </div>
  <div class="rule"></div>
  <div class="parties">
    <div>
      <p class="label">From</p>
      <p class="name">${escapeHtml(studio.name)}</p>
      ${(studio.addressLines || []).map(line).join("")}
      ${line(studio.phone)}
      ${line(studio.email)}
      ${studio.gstNumber ? line(`GSTIN: ${studio.gstNumber}`) : ""}
    </div>
    <div>
      <p class="label">Bill to</p>
      <p class="name">${escapeHtml(client.name)}</p>
      ${line(client.phone)}
      ${line(client.email)}
      ${client.projectId ? line(`Project: ${client.projectId}`) : ""}
    </div>
  </div>
  <h2>Payment details</h2>
  <table class="details"><tbody>
    ${row("Towards", payment.category)}
    ${row("Payment mode", [payment.mode, reference].filter(Boolean).join(" - "))}
    ${row("Received by", payment.receivedBy)}
    <tr class="strong"><th>Amount received</th><td>Rs. ${money(payment.amount)}<div class="words">${escapeHtml(amountInWords(payment.amount))}</div></td></tr>
    ${payment.balanceDue === null || payment.balanceDue === undefined ? "" : `<tr class="due"><th>Total due</th><td>Rs. ${money(payment.balanceDue)}</td></tr>`}
  </tbody></table>
  <div class="spacer"></div>
  <div class="foot">
    <div>
      <p class="thanks">Thank you for your business.</p>
      <p>This is a computer-generated invoice and does not need a signature.</p>
    </div>
  </div>
</div></body></html>`;
}

/** Prints the invoice to an A4 PDF and resolves to its bytes. */
async function renderReceiptPdf(receipt) {
  const instance = await getBrowser();
  const page = await instance.newPage();
  try {
    // Nothing on the page may reach out but the logo: no script runs.
    await page.setJavaScriptEnabled(false);
    await page.setContent(receiptHtml(receipt), { waitUntil: "load", timeout: 30_000 });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { receiptHtml, renderReceiptPdf };
