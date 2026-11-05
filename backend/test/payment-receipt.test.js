const test = require("node:test");
const assert = require("node:assert/strict");
const { receiptFor, clientOwnName } = require("../src/modules/accounts/cash-entries/receipt");
const { receiptHtml } = require("../src/services/paymentReceiptPdf");

/*
 * The payment receipt a cash received entry downloads from a project's Payments tab: the entry's
 * branch heads it, the client is named as they know themselves, and the total due is the one true just
 * after this payment - not after the ones recorded since.
 */
function stubClient({ branch, headOffice, project, extras = 0, receivedToDate = 0, lead = { officialEmailId: "kavin@example.com", groomName: "Kavin", brideName: "Thangamani" } } = {}) {
  const calls = {};
  return {
    calls,
    projectExtraQuotation: { aggregate: async () => ({ _sum: { amount: extras } }) },
    cashEntry: { aggregate: async (query) => { calls.received = query; return { _sum: { amount: receivedToDate } }; } },
    branch: {
      findUnique: async () => branch || null,
      findFirst: async () => headOffice || null,
    },
    salesProject: { findUnique: async () => project || null },
    salesCrmLead: { findFirst: async () => lead },
  };
}
const reader = { read: async () => ({ studioName: "Studio", galleryLogoUrl: "" }) };
const entry = {
  id: "c1", entryId: "DBS-MR-DD-CBE-000004", entryType: "Received", projectId: "p1", branchId: 2,
  entryDate: new Date("2026-10-13"), createdAt: new Date("2026-10-13T10:00:00Z"), amount: "20000",
  category: "Partial Payment", paymentMode: "Other", paymentModeOther: "Cheque", transactionId: "CHQ12",
  handler: { employeeName: "Kavya" }, clientName: "WED 3t3 ERD Kavin & Thangamani | SM",
};

test("a receipt is headed by the entry's branch and names the client as they know themselves", async () => {
  const client = stubClient({
    branch: { addressLine1: "12 Main Road", addressLine2: "", city: "Coimbatore", postalCode: "641001", state: "TN", gstNumber: "33ABCDE1234F1Z5", phone: "0422 000000", email: "cbe@studio.example" },
    project: { id: "p1", eventId: "DBS-BK-1", enquiryId: "ENQ-1", clientLogin: { email: "login@example.com" }, whatsappGroupName: "WED 3t3 ERD Kavin & Thangamani | SM", groupNameGeneratorJson: { groomName: "Kavin", brideName: "Thangamani" }, clientMainNumber: "+91 90000 00000", initialConvertedValue: "90000" },
    extras: 10000,
    receivedToDate: 65000,
  });
  const receipt = await receiptFor(entry, { client, reader });
  assert.deepEqual(receipt.studio.addressLines, ["12 Main Road", "Coimbatore - 641001", "TN"]);
  assert.equal(receipt.studio.gstNumber, "33ABCDE1234F1Z5");
  // A Dum Dum enquiry: groom and bride.
  assert.equal(receipt.client.name, "Kavin and Thangamani");
  // The invoice number is the entry's own received number.
  assert.equal(receipt.payment.number, "DBS-MR-DD-CBE-000004");
  assert.equal(receipt.studio.email, "cbe@studio.example");
  assert.equal(receipt.studio.phone, "0422 000000");
  assert.equal(receipt.client.email, "kavin@example.com", "the lead's Official Email ID before the login's");
  assert.equal(receipt.payment.mode, "Cheque");
  // Signed 1,00,000 less 65,000 received up to and including this payment.
  assert.equal(receipt.payment.balanceDue, 35000);
  assert.deepEqual(client.calls.received.where.OR, [{ entryDate: { lt: entry.entryDate } }, { entryDate: entry.entryDate, createdAt: { lte: entry.createdAt } }]);
});

test("Head Office heads it when the entry has no branch, and money spent has no receipt", async () => {
  const client = stubClient({ headOffice: { addressLine1: "HO", city: "Erode", state: "TN" } });
  const receipt = await receiptFor({ ...entry, branchId: null, projectId: null }, { client, reader });
  assert.deepEqual(receipt.studio.addressLines, ["HO", "Erode", "TN"]);
  assert.equal(receipt.payment.balanceDue, null, "no project, no total due to state");
  assert.equal(await receiptFor({ ...entry, entryType: "Spent" }, { client, reader }), null);
});

test("Bill to is the enquiry's name - one name, or groom and bride - and the receipt escapes what it prints", () => {
  // Qua Qua: the lead's one name. Dum Dum: groom and bride, or whichever is given.
  assert.equal(clientOwnName({}, { name: "Sneha Manurkar", groomName: "", brideName: "" }), "Sneha Manurkar");
  assert.equal(clientOwnName({}, { name: "Lead", groomName: "Kavin", brideName: "Thangamani" }), "Kavin and Thangamani");
  assert.equal(clientOwnName({}, { groomName: "", brideName: "Thangamani" }), "Thangamani");
  // No lead: the generator's names; nothing at all, "" (the caller falls back to the group name).
  assert.equal(clientOwnName({ groupNameGeneratorJson: { clientName: "Acme Corp" } }, null), "Acme Corp");
  assert.equal(clientOwnName({ groupNameGeneratorJson: { groomName: "Arun", brideName: "Divya" } }, null), "Arun and Divya");
  assert.equal(clientOwnName({ groupNameGeneratorJson: null }, null), "");
  const html = receiptHtml({ studio: { name: "<b>Studio</b>" }, payment: { number: "R1", amount: 1500, date: "2026-10-13" }, client: { name: "A & B" } });
  assert.match(html, /&lt;b&gt;Studio&lt;\/b&gt;/);
  assert.match(html, /Rupees One Thousand Five Hundred Only/);
  assert.match(html, /<h1>Invoice<\/h1>/);
  assert.match(html, /<th>Date of issue<\/th><td>13 Oct 2026<\/td>/);
  assert.match(html, /Bill to/);
  assert.doesNotMatch(html, /Date due/, "the money has already come in");
  assert.doesNotMatch(html, /Total due/, "no project, no total due");
  assert.match(receiptHtml({ studio: {}, client: {}, payment: { number: "R1", amount: 1500, balanceDue: 8500 } }), /<th>Total due<\/th><td>Rs\. 8,500\.00/);
  assert.match(html, /Thank you for your business\./);
  // Received by is a row of the payment details, not a line in the footer.
  assert.match(receiptHtml({ studio: {}, client: {}, payment: { number: "R1", amount: 1, receivedBy: "Arun" } }), /<th>Received by<\/th><td>Arun<\/td>/);
});
