const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../../../config/db");
const { matchesSignature } = require("../../../services/documentStorage");
const { paymentModes, modesWithDetails } = require("../../../services/paymentOptionLists");
const { userNamesById } = require("../../../services/userNames");
const { extractPdfText } = require("./pdfText");
const { parseTransactions } = require("./parser");
const dataScope = require("../../../services/dataScope.service");
const { CASH_SCOPE_COLUMNS } = require("../cash-entries/controller");

/**
 * Accounts Manager -> Import from PDF: one PDF in, the money received and spent it describes out.
 *
 * Nothing is recorded here. Each transaction found comes back for the person importing to check and
 * file against a project through the ordinary cash entry form - `POST /api/accounts/cash-entries`,
 * with every rule that route applies. This route only reads, and flags:
 *
 *   * **the file** - by the SHA-256 of its bytes, so a statement uploaded before under any name is
 *     said to have been;
 *   * **each transaction** - by its transaction ID / UTR, date, amount and details together against the cash
 *     book, so a payment already recorded is marked a duplicate while the new ones beside it stay to
 *     be recorded.
 *
 * One file per request, so a batch is read file by file by the screen and one that fails - a wrong
 * password, a scanned image - is reported for itself without holding up the rest.
 *
 * The password is used to open the file and dropped with the request. It is not stored, and the
 * activity log never records a body.
 */

/** A bank statement for a year runs to a few MB; anything larger is not one. */
const MAX_PDF_BYTES = 10 * 1024 * 1024;

const extractSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  // A data URI, as every other upload in this app is sent, or bare base64 - refused while still a
  // string when it cannot be 10 MB or less once decoded.
  data: z.string().min(1).max(Math.ceil((MAX_PDF_BYTES * 4) / 3) + 100, "This file is larger than 10 MB. Split the statement and upload the parts."),
  password: z.string().max(200).optional().default(""),
});

/*
 * The studio's payment modes a way of paying named in a statement maps to, best first. The first one
 * the studio's own list has is used, so a studio that renamed or removed a mode simply gets the next,
 * or none - and the form asks.
 */
const MODE_CANDIDATES = {
  UPI: ["UPI"],
  NEFT: ["Bank Transfer", "NEFT", "Net Banking"],
  RTGS: ["Bank Transfer", "RTGS", "Net Banking"],
  IMPS: ["Bank Transfer", "IMPS", "Net Banking"],
  NET_BANKING: ["Net Banking", "Bank Transfer"],
  CASH: ["Cash"],
  CARD: ["Credit / Debit Cards", "Card"],
  CHEQUE: ["Cheque", "Other"],
};
const MODE_LABELS = { NEFT: "NEFT", RTGS: "RTGS", IMPS: "IMPS", CHEQUE: "Cheque", NET_BANKING: "Net banking", CARD: "Card", CASH: "Cash", UPI: "UPI" };

function studioMode(kind, names) {
  if (!kind) return null;
  const lower = new Map(names.map((name) => [name.toLowerCase(), name]));
  for (const candidate of MODE_CANDIDATES[kind] || []) {
    const found = lower.get(candidate.toLowerCase());
    if (found) return found;
  }
  return null;
}

function decode(data) {
  const base64 = String(data).replace(/^data:[^;,]*;base64,/, "");
  return Buffer.from(base64, "base64");
}

/** The answer for a file that gave no transactions to record, in the shape every file's answer has. */
const fileResult = (fields) => ({ status: "read", message: "", kind: null, previousUpload: null, debitCount: 0, check: null, debitCheck: null, transactions: [], ...fields });

async function previousUploadOf(record) {
  if (!record) return null;
  const names = await userNamesById([record.uploadedBy]);
  return { fileName: record.fileName, uploadedAt: record.createdAt, uploadedByName: names.get(record.uploadedBy) || null };
}

/**
 * One payment's identity for spotting a duplicate: its transaction ID, date, amount and details
 * together. All four have to agree - the same reference on another day, for another sum or with
 * other details is a different payment (a reversal, a reused cheque number, a bank recycling a
 * short reference) and is not held back. The details are compared without regard to case or
 * spacing. A payment with no transaction ID has no identity and is never a duplicate.
 *
 * `entryType` keeps money in and money out apart: a refund carrying the reference of the payment it
 * returns is not that payment again.
 */
const sameDetails = (text) => String(text || "").replace(/\s+/g, " ").trim().toUpperCase();
const paymentKey = (transactionId, date, amount, details, entryType = "") => (transactionId && date && amount !== null && amount !== undefined
  ? `${entryType}|${String(transactionId).trim().toUpperCase()}|${date}|${Number(amount).toFixed(2)}|${sameDetails(details)}`
  : null);

/*
 * The day an entry was filed under. A form sends a bare date, stored as midnight UTC; an entry
 * written as midnight India time sits on the evening before in UTC. Both days are offered, so the
 * same payment matches whichever way it was stored.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const entryDays = (date) => {
  const at = new Date(date);
  return [...new Set([at.toISOString().slice(0, 10), new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)])];
};

/**
 * The cash entries already recorded for these payments, by `paymentKey`.
 *
 * Every entry counts - a payment recorded in another branch is still recorded, and filing it again
 * would count it twice - but only one this person may see is named. One outside their reach comes
 * back as `null`: a duplicate all the same, with no entry id to give away.
 */
async function recordedPayments(req, transactions) {
  const wanted = [...new Set(transactions.map((transaction) => transaction.transactionId).filter(Boolean))];
  if (!wanted.length) return new Map();
  const [scope, rows] = await Promise.all([
    dataScope.resolve({ userId: Number(req.user.id), module: req.permission.module, feature: req.permission.feature, columns: CASH_SCOPE_COLUMNS }),
    prisma.cashEntry.findMany({
      where: { transactionId: { in: wanted }, deletedAt: null },
      select: { transactionId: true, entryId: true, entryType: true, entryDate: true, amount: true, description: true, branchId: true, handlerEmployeeId: true, createdBy: true, project: { select: { deletedAt: true } }, shoot: { select: { project: { select: { deletedAt: true } } } } },
    }),
  ]);
  const found = new Map();
  for (const row of rows) {
    // An entry against a project in the Recycling Bin still counts as recorded - the money happened,
    // and filing it again would count it twice - but it is not listed anywhere, so it is not named.
    const binned = Boolean(row.project?.deletedAt || row.shoot?.project?.deletedAt);
    const named = scope.allows(row) && !binned ? row.entryId : null;
    for (const day of entryDays(row.entryDate)) {
      const key = paymentKey(row.transactionId, day, row.amount, row.description, row.entryType);
      if (!found.has(key) || (named && !found.get(key))) found.set(key, named);
    }
  }
  return found;
}

async function extract(req, res) {
  const parsed = extractSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Choose a PDF file to read." });
  const { fileName, data, password } = parsed.data;

  const buffer = decode(data);
  if (!buffer.length) return res.status(400).json({ message: `${fileName} could not be read.` });
  if (buffer.length > MAX_PDF_BYTES) {
    return res.json({ data: fileResult({ fileName, fileHash: null, status: "failed", message: "This file is larger than 10 MB. Split the statement and upload the parts." }) });
  }
  if (!matchesSignature(buffer, "application/pdf")) {
    return res.json({ data: fileResult({ fileName, fileHash: null, status: "failed", message: "This file is not a PDF." }) });
  }

  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
  try {
    const previous = await prisma.cashStatementImport.findUnique({ where: { fileHash } });
    const previousUpload = await previousUploadOf(previous);

    let pages;
    try {
      pages = await extractPdfText(buffer, password);
    } catch (error) {
      if (!error.code) throw error;
      return res.json({ data: fileResult({ fileName, fileHash, previousUpload, status: "failed", message: error.message, passwordProblem: error.code.startsWith("PASSWORD") }) });
    }

    const result = parseTransactions(pages);
    if (!result.hasText) {
      return res.json({ data: fileResult({ fileName, fileHash, previousUpload, status: "failed", message: "This PDF has no readable text - it is probably a scanned image. Record its payments by hand with Add Entry." }) });
    }

    // Remembered once it has been read, whatever is then recorded from it: a re-upload is reported
    // as one, and the payments recorded from it the first time are marked by their references below.
    if (!previous) {
      await prisma.cashStatementImport.create({
        data: { fileHash, fileName, transactionCount: result.transactions.length + result.debits.length, uploadedBy: Number(req.user.id) || null },
      }).catch((error) => { if (error.code !== "P2002") throw error; });
    }

    /*
     * Money in and money out, each marked with which it is and kept in the statement's date order.
     * Every one is recorded by hand - received against its project, spent against its shoot - so both
     * are offered; neither is filed by reading.
     */
    const found = [
      ...result.transactions.map((transaction) => ({ ...transaction, entryType: "Received" })),
      ...result.debits.map((transaction) => ({ ...transaction, entryType: "Spent" })),
    ].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    if (!found.length) {
      return res.json({ data: fileResult({ fileName, fileHash, previousUpload, kind: result.kind, status: "empty", message: "No transactions were found in this PDF.", check: result.check, debitCheck: result.debitCheck }) });
    }

    const [names, detailModes, recorded] = await Promise.all([
      paymentModes(),
      modesWithDetails(),
      recordedPayments(req, found),
    ]);
    const transactions = found.map((transaction, index) => {
      const paymentMode = studioMode(transaction.mode, names);
      return {
        key: `${fileHash.slice(0, 12)}-${index}`,
        entryType: transaction.entryType,
        date: transaction.date,
        amount: transaction.amount,
        paymentMode,
        // A mode that asks for a remark ("Other") is told what the statement called it.
        paymentModeOther: paymentMode && detailModes.includes(paymentMode) ? MODE_LABELS[transaction.mode] || null : null,
        transactionId: transaction.transactionId,
        description: transaction.description,
        // `duplicate` when an entry has the same transaction ID, date, amount and details;
        // `duplicateOf` names it only when it is one this person may see.
        duplicate: recorded.has(paymentKey(transaction.transactionId, transaction.date, transaction.amount, transaction.description, transaction.entryType)),
        duplicateOf: recorded.get(paymentKey(transaction.transactionId, transaction.date, transaction.amount, transaction.description, transaction.entryType)) || null,
      };
    });

    return res.json({ data: fileResult({ fileName, fileHash, previousUpload, kind: result.kind, debitCount: result.debitCount, check: result.check, debitCheck: result.debitCheck, transactions }) });
  } catch (error) {
    // The name only: a message from inside pdf.js may quote the file.
    console.error("Unable to read this PDF:", error.name || "Error");
    return res.status(500).json({ message: "Unable to read this PDF." });
  }
}

module.exports = { extract, studioMode, paymentKey, entryDays, MAX_PDF_BYTES };
