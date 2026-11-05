const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { extractPdfText } = require("../src/modules/accounts/statement-import/pdfText");
const { parseTransactions, parseDate, findReference, detectMode } = require("../src/modules/accounts/statement-import/parser");
const { studioMode, paymentKey, entryDays } = require("../src/modules/accounts/statement-import/controller");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", "statement-import", name));
const cell = (str, x, y, width = str.length * 4) => ({ str, x, y, width });

test("a locked statement opens with its password and yields only the credits", async () => {
  const result = parseTransactions(await extractPdfText(fixture("statement-locked.pdf"), "dbs123"));
  assert.equal(result.kind, "statement");
  assert.equal(result.debitCount, 1, "the ATM withdrawal is money out and is left out");
  assert.deepEqual(result.transactions.map((row) => [row.date, row.amount, row.mode, row.transactionId]), [
    ["2026-10-01", "25000.00", "UPI", "412345678901"],
    ["2026-10-03", "150000.00", "NEFT", "HDFCN52026100312345"],
    ["2026-10-07", "40000.00", "IMPS", "512345678902"],
  ]);
  assert.match(result.transactions[2].description, /PHOTOGRAPHY ADVANCE/, "a wrapped narration joins its row");
});

test("a missing or wrong password is reported as such, not as an unreadable file", async () => {
  await assert.rejects(extractPdfText(fixture("statement-locked.pdf"), ""), { code: "PASSWORD_REQUIRED" });
  await assert.rejects(extractPdfText(fixture("statement-locked.pdf"), "wrong"), { code: "PASSWORD_INCORRECT" });
  await assert.rejects(extractPdfText(Buffer.from("%PDF-1.4 not really"), ""), { code: "UNREADABLE" });
});

test("a receipt yields its one payment", async () => {
  const result = parseTransactions(await extractPdfText(fixture("receipt-locked.pdf"), "1234"));
  assert.equal(result.kind, "receipt");
  assert.deepEqual(result.transactions, [{
    date: "2026-10-12", amount: "18500.00", mode: "UPI", transactionId: "612345678903", description: "From Meera Nair",
  }]);
});

test("a PDF with no text is told apart from one with no transactions", async () => {
  assert.equal(parseTransactions(await extractPdfText(fixture("no-text.pdf"), "")).hasText, false);
  const empty = parseTransactions([[cell("Thank you for banking with us", 40, 700)]]);
  assert.equal(empty.hasText, true);
  assert.equal(empty.transactions.length, 0);
});

test("a statement with one Amount column reads Cr / Dr off the amount", () => {
  const page = [
    cell("Txn Date", 40, 700), cell("Description", 100, 700), cell("Amount", 400, 700), cell("Balance", 500, 700),
    cell("12-Oct-2026", 40, 680), cell("BY CLG CHQ 004512", 100, 680), cell("5,000.00 Cr", 400, 680), cell("15,000.00", 500, 680),
    cell("13-Oct-2026", 40, 666), cell("TO CARD 1234", 100, 666), cell("2,000.00 Dr", 400, 666), cell("13,000.00", 500, 666),
  ];
  const result = parseTransactions([page]);
  assert.equal(result.kind, "statement");
  assert.deepEqual(result.transactions.map((row) => [row.date, row.amount, row.mode]), [["2026-10-12", "5000.00", "CHEQUE"]]);
  assert.equal(result.debitCount, 1);
});

test("dates, references and modes in the shapes banks write them", () => {
  assert.equal(parseDate("26/10/2026").iso, "2026-10-26");
  assert.equal(parseDate("26-Oct-26").iso, "2026-10-26");
  assert.equal(parseDate("Oct 26, 2026").iso, "2026-10-26");
  assert.equal(parseDate("2026-10-26").iso, "2026-10-26");
  assert.equal(parseDate("31/02/2026"), null, "a day that does not exist is no date");
  assert.equal(findReference("UTR No: SBIN326123456789 credited"), "SBIN326123456789");
  assert.equal(findReference("UPI/CR/712345678904/ARUN/okicici"), "712345678904");
  assert.equal(findReference("BY CASH DEPOSIT"), null);
  assert.equal(detectMode("RTGS CR SOME CO"), "RTGS");
  assert.equal(detectMode("Interest credit"), null);
});

test("a statement's way of paying maps onto the studio's own payment modes", () => {
  const modes = ["UPI", "Bank Transfer", "Net Banking", "Cash", "Credit / Debit Cards", "Other"];
  assert.equal(studioMode("NEFT", modes), "Bank Transfer");
  assert.equal(studioMode("CHEQUE", modes), "Other");
  assert.equal(studioMode("UPI", ["Cash"]), null, "a mode the studio does not keep is left for the form to ask");
  assert.equal(studioMode(null, modes), null);
});

test("reading a statement needs Cash Management Read / Write, not Read alone", async () => {
  const iamService = require("../src/services/iam.service");
  const router = require("../src/modules/accounts/statement-import/routes");
  assert.ok(router.stack.find((entry) => entry.route?.path === "/extract" && entry.route.methods.post));
  // protect, then the module guard, then the routes.
  const guard = router.stack[1].handle;
  const original = iamService.hasPermission;
  const answer = async (held) => {
    iamService.hasPermission = async (userId, module, feature, level) => module === "ACCOUNTS" && feature === "Cash Management" && held.includes(level);
    let code = 200;
    let passed = false;
    const res = { status(value) { code = value; return this; }, json() { return this; } };
    await guard({ method: "POST", user: { id: 7 }, params: {} }, res, () => { passed = true; });
    return passed ? "next" : code;
  };
  try {
    assert.equal(await answer(["READ"]), 403);
    assert.equal(await answer(["READ", "READ_WRITE"]), "next");
    assert.equal(await answer([]), 403);
  } finally {
    iamService.hasPermission = original;
  }
});

test("a statement with a serial column, centred narrations and balances marked Cr", () => {
  // The shape of a Union Bank statement: "Sl" before the date, each narration on two lines with
  // the date centred between them, and the balance written "1,000.03 Cr".
  const header = [cell("SI", 30, 700), cell("Date", 60, 700), cell("Particulars", 130, 700), cell("Withdrawal", 330, 700, 50), cell("Deposit", 420, 700, 40), cell("Balance", 500, 700, 40)];
  const row = (y, serial, date, first, second, withdrawal, deposit, balance) => [
    cell(first, 130, y + 5), cell(serial, 30, y), cell(date, 60, y), cell(second, 130, y - 5),
    ...(withdrawal ? [cell(withdrawal, 340, y, 40)] : []),
    ...(deposit ? [cell(deposit, 420, y, 40)] : []),
    cell(balance, 495, y, 45),
  ];
  const page = [
    ...header,
    ...row(670, "9", "09-09-2026", "UPIAR/625239235232/DR/SHIVAM", "A/YESB/paytm", "200.00", null, "0.03 Cr"),
    ...row(646, "10", "10-09-2026", "UPIAB/625368172699/CR/SABARIS", "H/INDB/sabari", null, "1,000.00", "1,000.03 Cr"),
    ...row(622, "11", "11-09-2026", "UPIAB/129435600936/CR/DHANUS", "H /CNRB/dhanush", null, "3,000.00", "4,000.03 Cr"),
    cell("Summary :", 60, 590), cell("Total Credits :", 330, 590), cell("4,000.00", 420, 590, 40),
  ];
  const result = parseTransactions([page]);
  assert.equal(result.debitCount, 1);
  assert.deepEqual(result.transactions.map((item) => [item.date, item.amount, item.mode, item.transactionId, item.description]), [
    ["2026-09-10", "1000.00", "UPI", "625368172699", "UPIAB/625368172699/CR/SABARIS H/INDB/sabari"],
    ["2026-09-11", "3000.00", "UPI", "129435600936", "UPIAB/129435600936/CR/DHANUS H /CNRB/dhanush"],
  ]);
});

test("a statement whose headings are not text is read by its running balance", () => {
  // SBI draws its Debit / Credit headings, so only the balance says which way each row went.
  const row = (y, date, narration, debit, credit, balance) => [
    cell(date, 27, y), cell(date, 82, y), cell(narration, 138, y), cell("-", 304, y),
    debit ? cell(debit, 350, y, 30) : cell("-", 366, y, 4),
    credit ? cell(credit, 430, y, 30) : cell("-", 446, y, 4),
    cell(balance, 514, y, 30),
    cell("AT 64963 PALLIPALAYAM", 138, y - 12),
  ];
  const page = [
    cell("Balance", 514, 720, 30),
    ...row(700, "01/04/2026", "UPI/CR/399987259942/Mr", null, "2,170.00", "2,200.92"),
    ...row(650, "02/04/2026", "UPI/DR/103033353506/BAJAJ", "2,174.00", null, "26.92"),
    ...row(600, "03/04/2026", "UPI/CR/609367165972/K", null, "200.00", "226.92"),
    ...row(550, "04/04/2026", "NEFT*HDFC0000001*N123456789012*ACME", null, "14,000.00", "14,226.92CR"),
  ];
  const result = parseTransactions([page]);
  assert.equal(result.kind, "statement");
  assert.equal(result.debitCount, 1);
  assert.deepEqual(result.transactions.map((item) => [item.date, item.amount, item.mode]), [
    ["2026-04-01", "2170.00", "UPI"],
    ["2026-04-03", "200.00", "UPI"],
    ["2026-04-04", "14000.00", "NEFT"],
  ]);
  assert.equal(result.transactions[0].description, "UPI/CR/399987259942/Mr AT 64963 PALLIPALAYAM");
});

/*
 * The layouts other banks and payment apps use, written out as positioned text. None names a bank
 * in the parser; each is read by what its headings, balances or signs say.
 */
test("HDFC: Withdrawal Amt. / Deposit Amt. / Closing Balance, with a value date between", () => {
  const page = [
    cell("Date", 30, 700), cell("Narration", 80, 700), cell("Chq./Ref.No.", 260, 700), cell("Value Dt", 340, 700),
    cell("Withdrawal Amt.", 390, 700, 60), cell("Deposit Amt.", 460, 700, 50), cell("Closing Balance", 520, 700, 60),
    cell("01/10/26", 30, 680), cell("NEFT CR-ICIC0000104-ACME EVENTS-N274262123456789", 80, 680), cell("0000N274262123456789", 260, 680), cell("01/10/26", 340, 680),
    cell("45,000.00", 470, 680, 40), cell("1,45,000.00", 530, 680, 50),
    cell("02/10/26", 30, 666), cell("POS 416021XXXXXX1234 AMAZON", 80, 666), cell("0000412345678901", 260, 666), cell("02/10/26", 340, 666),
    cell("1,999.00", 410, 666, 40), cell("1,43,001.00", 530, 666, 50),
  ];
  const result = parseTransactions([page]);
  assert.deepEqual(result.transactions.map((item) => [item.date, item.amount, item.mode]), [["2026-10-01", "45000.00", "NEFT"]]);
  assert.equal(result.debitCount, 1);
});

test("ICICI: a serial column and headings that wrap onto a second line", () => {
  const page = [
    cell("S No.", 20, 706), cell("Transaction", 60, 706), cell("Transaction Remarks", 150, 706), cell("Withdrawal Amount", 360, 706, 60), cell("Deposit Amount", 440, 706, 55), cell("Balance", 520, 706, 40),
    cell("Date", 60, 696), cell("(INR)", 370, 696, 20), cell("(INR)", 450, 696, 20), cell("(INR)", 525, 696, 20),
    cell("1", 20, 676), cell("05.10.2026", 60, 676), cell("UPI/712345678904/Advance/arun@okicici", 150, 676), cell("25,000.00", 450, 676, 45), cell("30,000.00", 515, 676, 45),
    cell("2", 20, 660), cell("06.10.2026", 60, 660), cell("ATM/CASH WDL", 150, 660), cell("5,000.00", 370, 660, 45), cell("25,000.00", 515, 660, 45),
  ];
  const result = parseTransactions([page]);
  assert.deepEqual(result.transactions.map((item) => [item.date, item.amount, item.transactionId]), [["2026-10-05", "25000.00", "712345678904"]]);
});

test("Kotak: one Amount column with a Dr / Cr column beside it", () => {
  const page = [
    cell("Date", 30, 700), cell("Narration", 90, 700), cell("Amount", 380, 700, 40), cell("Dr / Cr", 440, 700), cell("Balance", 500, 700, 40),
    cell("12-10-2026", 30, 680), cell("IMPS-512345678902-MEERA", 90, 680), cell("18,500.00", 380, 680, 40), cell("CR", 440, 680), cell("38,500.00", 500, 680, 40),
    cell("13-10-2026", 30, 666), cell("ELECTRICITY BILL", 90, 666), cell("2,000.00", 380, 666, 40), cell("DR", 440, 666), cell("36,500.00", 500, 666, 40),
  ];
  const result = parseTransactions([page]);
  assert.deepEqual(result.transactions.map((item) => [item.date, item.amount, item.mode]), [["2026-10-12", "18500.00", "IMPS"]]);
});

test("newest first, with headings drawn as pictures: the balance still says which way", () => {
  const row = (y, date, narration, amount, balance) => [cell(date, 30, y), cell(narration, 100, y), cell(amount, 400, y, 40), cell(balance, 500, y, 40)];
  const page = [
    ...row(700, "20/10/2026", "UPI/CR/800000000003/C", "300.00", "1,500.00"),
    ...row(680, "19/10/2026", "UPI/DR/800000000002/B", "200.00", "1,200.00"),
    ...row(660, "18/10/2026", "UPI/CR/800000000001/A", "400.00", "1,400.00"),
    ...row(640, "17/10/2026", "OPENING CREDIT", "1,000.00", "1,000.00"),
  ];
  const result = parseTransactions([page]);
  assert.deepEqual(result.transactions.map((item) => item.amount), ["300.00", "400.00"]);
  assert.equal(result.debitCount, 2, "a first row nothing settles goes with the amounts it lines up under");
});

test("PhonePe / GPay: one amount per row, a Credit / Debit word, rupees without paise", () => {
  const page = [
    cell("Date", 30, 720), cell("Transaction Details", 120, 720), cell("Type", 380, 720), cell("Amount", 460, 720),
    cell("Oct 12, 2026", 30, 700), cell("Received from Meera Nair", 120, 700), cell("CREDIT", 380, 700), cell("₹18,500", 460, 700),
    cell("Transaction ID T2610121234567890123", 120, 688), cell("UTR No. 612345678903", 120, 678),
    cell("Oct 13, 2026", 30, 650), cell("Paid to Sri Kumaran Stores", 120, 650), cell("DEBIT", 380, 650), cell("₹450", 460, 650),
    cell("Oct 14, 2026", 30, 620), cell("Received from Arun", 120, 620), cell("CREDIT", 380, 620), cell("₹2,000.50", 460, 620),
  ];
  const result = parseTransactions([page]);
  assert.equal(result.kind, "statement");
  assert.deepEqual(result.transactions.map((item) => [item.date, item.amount, item.transactionId]), [
    ["2026-10-12", "18500.00", "612345678903"],
    ["2026-10-14", "2000.50", null],
  ]);
  assert.equal(result.debitCount, 1);
});

test("the credits found are checked against the total the statement prints", () => {
  const page = [
    cell("Date", 30, 700), cell("Particulars", 90, 700), cell("Withdrawals", 380, 700, 50), cell("Deposits", 450, 700, 40), cell("Balance", 520, 700, 40),
    cell("01-10-2026", 30, 680), cell("BY TRANSFER", 90, 680), cell("1,000.00", 450, 680, 40), cell("1,000.00", 520, 680, 40),
    cell("02-10-2026", 30, 666), cell("BY TRANSFER", 90, 666), cell("500.00", 450, 666, 40), cell("1,500.00", 520, 666, 40),
    cell("Total Credits :", 300, 640), cell("2,500.00", 450, 640, 40),
  ];
  assert.deepEqual(parseTransactions([page]).check, { stated: "2500.00", found: "1500.00", matches: false });
});

test("IOB: the date on one line, the amounts a few points below, the value date in brackets", () => {
  const page = [
    cell("Date(Value", 50, 560), cell("Ref No.", 283, 560), cell("Transaction", 333, 560),
    cell("Particulars", 168, 555), cell("Debit(Rs)", 398, 555, 39), cell("Credit(Rs)", 456, 555, 42), cell("Balance(Rs)", 507, 555, 49),
    cell("Date)", 63, 549), cell("/Cheque No", 275, 549), cell("Type", 346, 549),
    cell("25-Oct-26", 45, 531), cell("UPI/666409642264/DR/Vishnu Enterpr", 112, 531),
    cell("S25388550", 278, 526), cell("Transfer", 344, 526), cell("300.00", 415, 526, 25), cell("-", 496, 526, 3), cell("301.78", 533, 526, 25),
    cell("(25-Oct-26)", 45, 521), cell("/YES/UPI", 112, 521),
    cell("25-Oct-26", 45, 508), cell("UPI/666408448260/CR/ S LAKSHMI", 112, 508),
    cell("S23271388", 278, 503), cell("Transfer", 344, 503), cell("-", 437, 503, 3), cell("500.00", 474, 503, 25), cell("601.78", 533, 503, 25),
    cell("(25-Oct-26)", 45, 498), cell("/IOB/UPI", 112, 498),
  ];
  const result = parseTransactions([page]);
  assert.equal(result.debitCount, 1);
  assert.deepEqual(result.transactions.map((item) => [item.date, item.amount, item.transactionId, item.description]), [
    ["2026-10-25", "500.00", "666408448260", "UPI/666408448260/CR/ S LAKSHMI S23271388 Transfer /IOB/UPI"],
  ]);
});

test("a duplicate is the same transaction ID, date, amount and details - all four", () => {
  const recorded = paymentKey("612345678903", "2026-10-12", "18500.00", "UPI/CR/612345678903/MEERA");
  assert.equal(paymentKey("612345678903", "2026-10-12", 18500, "UPI/CR/612345678903/MEERA"), recorded, "the same payment, however the amount is written");
  assert.equal(paymentKey("612345678903".toLowerCase(), "2026-10-12", "18500.00", "  upi/cr/612345678903/meera "), recorded, "case and spacing do not matter");
  assert.notEqual(paymentKey("612345678903", "2026-10-13", "18500.00", "UPI/CR/612345678903/MEERA"), recorded, "another day is another payment");
  assert.notEqual(paymentKey("612345678903", "2026-10-12", "18000.00", "UPI/CR/612345678903/MEERA"), recorded, "another amount is another payment");
  assert.notEqual(paymentKey("612345678903", "2026-10-12", "18500.00", "UPI/CR/612345678903/ARUN"), recorded, "other details are another payment");
  assert.equal(paymentKey(null, "2026-10-12", "18500.00", "UPI/CR/MEERA"), null, "no transaction ID, never a duplicate");
  // An entry stored at midnight UTC or at midnight India time still falls on its own day.
  assert.ok(entryDays(new Date("2026-10-12T00:00:00Z")).includes("2026-10-12"));
  assert.ok(entryDays(new Date("2026-10-11T18:30:00Z")).includes("2026-10-12"));
});

test("money out is read beside money in, and checked against the statement's Total Debits", async () => {
  const locked = parseTransactions(await extractPdfText(fixture("statement-locked.pdf"), "dbs123"));
  assert.deepEqual(locked.debits.map((item) => [item.date, item.amount]), [["2026-10-05", "10000.00"]], "the ATM withdrawal, under Withdrawal Amt.");
  const page = [
    cell("Date", 30, 700), cell("Particulars", 90, 700), cell("Withdrawals", 380, 700, 50), cell("Deposits", 450, 700, 40), cell("Balance", 520, 700, 40),
    cell("01-10-2026", 30, 680), cell("BY TRANSFER", 90, 680), cell("1,000.00", 450, 680, 40), cell("1,000.00", 520, 680, 40),
    cell("02-10-2026", 30, 666), cell("TO RENT", 90, 666), cell("400.00", 390, 666, 40), cell("600.00", 520, 666, 40),
    cell("Total Debits :", 300, 640), cell("400.00", 450, 640, 40),
  ];
  const result = parseTransactions([page]);
  assert.deepEqual(result.debits.map((item) => [item.date, item.amount, item.description]), [["2026-10-02", "400.00", "TO RENT"]]);
  assert.deepEqual(result.debitCheck, { stated: "400.00", found: "400.00", matches: true });
});

test("a refund is not the payment it returns: money in and out are told apart in a duplicate", () => {
  assert.notEqual(paymentKey("612345678903", "2026-10-12", "500.00", "UPI", "Received"), paymentKey("612345678903", "2026-10-12", "500.00", "UPI", "Spent"));
});
