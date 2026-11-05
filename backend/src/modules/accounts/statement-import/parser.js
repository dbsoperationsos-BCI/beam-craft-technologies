/**
 * The money received that a PDF's text describes: every credit on a bank statement, or the one
 * payment a receipt is for.
 *
 * No bank lays a statement out the same way, so nothing here knows any bank. A statement is found by
 * its header row - a Deposit / Credit column beside a Withdrawal / Debit or Balance one - and each
 * dated row under it is read by **where** its amounts sit: an amount under the Deposit heading is
 * money in, one under Withdrawal is money out and is left out, the Balance is ignored. A file with
 * no such header is read as a receipt: one amount, one date, one reference, found by their labels.
 *
 * Whatever is found is a suggestion. The person importing checks every row in the cash entry form
 * before anything is saved, so a guess this makes wrongly is corrected there, not stored.
 *
 * Pure: it takes the positioned text `pdfText.extractPdfText` returns and touches nothing else, so
 * the tests can hand it pages written out by hand.
 */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_NAMES = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE_PATTERNS = [
  // 2026-10-26
  { pattern: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, parts: (m) => [m[1], m[2], m[3]] },
  // 26/10/2026, 26-10-26, 26.10.2026 - Indian statements are day first.
  { pattern: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/, parts: (m) => [m[3], m[2], m[1]] },
  // 26 Oct 2026, 26-Oct-26, 26Oct2026
  { pattern: new RegExp(`\\b(\\d{1,2})[\\s/-]?(${MONTH_NAMES})[a-z]*[\\s/,-]*(\\d{4}|\\d{2})\\b`, "i"), parts: (m) => [m[3], m[2], m[1]] },
  // Oct 26, 2026
  { pattern: new RegExp(`\\b(${MONTH_NAMES})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i"), parts: (m) => [m[3], m[1], m[2]] },
];

const pad = (value) => String(value).padStart(2, "0");

/** The first date in `text`, as `YYYY-MM-DD`, or null. */
function parseDate(text) {
  let best = null;
  for (const { pattern, parts } of DATE_PATTERNS) {
    const match = String(text || "").match(pattern);
    if (!match || (best && best.index <= match.index)) continue;
    let [year, month, day] = parts(match);
    month = MONTHS[String(month).slice(0, 3).toLowerCase()] || Number(month);
    year = Number(year);
    if (year < 100) year += 2000;
    day = Number(day);
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) continue;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCDate() !== day) continue;
    best = { iso: `${year}-${pad(month)}-${pad(day)}`, index: match.index, length: match[0].length };
  }
  return best;
}

/*
 * An amount cell on a statement: always two decimals, optionally a currency mark before it and a
 * Cr / Dr after. Two decimals is what keeps a 12-digit reference number from reading as money.
 */
const AMOUNT_CELL = /^(?:₹|rs\.?|inr)?\s*\(?-?(\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}\)?\s*(cr|dr)?\.?$/i;

/** A money figure as a number - commas, currency marks and Cr / Dr dropped. */
function toAmount(text) {
  const value = Number(String(text || "").replace(/₹|rs\.?|inr|cr|dr|[,()\s]/gi, ""));
  return Number.isFinite(value) ? Math.abs(value) : null;
}

const MODE_KEYWORDS = [
  // UPI, and the UPIAB / UPIAR / UPILR prefixes some banks write in its place.
  ["UPI", /\bupi[a-z]{0,2}\b/i],
  ["NEFT", /\bneft\b/i],
  ["RTGS", /\brtgs\b/i],
  ["IMPS", /\b(imps|mmt)\b/i],
  ["CHEQUE", /\b(chq|cheque|clg|clearing)\b/i],
  ["CASH", /\b(cash|csh)\b/i],
  ["CARD", /\b(pos|card|ecom)\b/i],
  ["NET_BANKING", /\b(inb|net ?banking|internet banking|ib funds?)\b/i],
];

/** How the money moved, as the text names it, or null when it does not. */
function detectMode(text) {
  const found = MODE_KEYWORDS.find(([, pattern]) => pattern.test(text));
  return found ? found[0] : null;
}

const LABELLED_REFERENCE = /\b(?:utr|rrn|txn\.?\s*(?:id|no|ref)|transaction\s*(?:id|no|number|ref(?:erence)?)|upi\s*ref(?:erence)?(?:\s*(?:no|id))?|ref(?:erence)?\.?\s*(?:no|number|id)|chq\.?\s*no|cheque\s*no)\.?\s*[:#-]?\s*([A-Z0-9]{6,30})\b/i;

/**
 * The transaction ID / UTR in a line of text.
 *
 * A labelled one ("UTR: …", "Transaction ID …") wins. Failing that, UPI and IMPS carry a 12-digit
 * reference in the narration, and anything else falls back to the longest code with enough digits
 * in it to be one - which may be wrong, and is shown for checking rather than trusted.
 */
function findReference(text, mode = detectMode(text)) {
  const value = String(text || "");
  // The bank's UTR / RRN first: a payment app's own transaction ID is never on the bank statement,
  // so the UTR is the one that matches the same payment recorded from either.
  const utr = value.match(/\b(?:utr|rrn)\.?\s*(?:no|number)?\.?\s*[:#-]?\s*([A-Z0-9]{6,30})\b/i);
  if (utr && /\d/.test(utr[1])) return utr[1].toUpperCase();
  const labelled = value.match(LABELLED_REFERENCE);
  if (labelled && /\d/.test(labelled[1])) return labelled[1].toUpperCase();
  const tokens = value.split(/[\s/|:,()\\-]+/).filter(Boolean);
  if (mode === "UPI" || mode === "IMPS") {
    const twelve = tokens.find((token) => /^\d{12}$/.test(token));
    if (twelve) return twelve;
  }
  const candidates = tokens.filter((token) => /^[A-Z0-9]{10,30}$/i.test(token)
    && (token.match(/\d/g) || []).length >= 6
    && !parseDate(token)
    && !AMOUNT_CELL.test(token));
  if (!candidates.length) return null;
  return candidates.reduce((best, token) => (token.length > best.length ? token : best)).toUpperCase();
}

/** One page's text as lines, top to bottom, each a run of cells left to right. */
function groupLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - item.y) <= 3) line.cells.push(item);
    else lines.push({ y: item.y, cells: [item] });
  }
  return lines.map((line) => {
    const cells = line.cells.sort((a, b) => a.x - b.x).map((cell) => ({ ...cell, str: cell.str.trim() })).filter((cell) => cell.str);
    return { y: line.y, cells, text: cells.map((cell) => cell.str).join(" ") };
  });
}

const CREDIT_HEADING = /\b(deposits?|credits?|money in|paid in)\b|^cr\.?$/i;
const DEBIT_HEADING = /\b(withdrawals?|debits?|money out|paid out)\b|^dr\.?$/i;
const BALANCE_HEADING = /\bbalance\b/i;
const AMOUNT_HEADING = /\bamount\b/i;
const CREDIT_MARK = /^(cr|credit)\.?$/i;
const SKIP_LINE = /\b(opening balance|closing balance|brought forward|carried forward|b\/f|c\/f|total|page \d+|statement of account|generated on)\b/i;

const centre = (cell) => cell.x + cell.width / 2;
const right = (cell) => cell.x + cell.width;

/**
 * The statement's column headings on this line, or null when it is not a header row.
 *
 * Either a Deposit / Credit column of its own, or - on a statement with one Amount column - an Amount
 * heading, where each amount then says Cr or Dr for itself (or a Cr / Dr column beside it does).
 */
function headerColumns(line) {
  if (!line.cells.some((cell) => /date/i.test(cell.str))) return null;
  const notBalance = (pattern) => line.cells.find((cell) => pattern.test(cell.str) && !BALANCE_HEADING.test(cell.str));
  const credit = notBalance(CREDIT_HEADING);
  const debit = notBalance(DEBIT_HEADING);
  const balance = line.cells.find((cell) => BALANCE_HEADING.test(cell.str));
  const amount = credit ? null : notBalance(AMOUNT_HEADING);
  if (!credit && !amount) return null;
  if (!debit && !balance) return null;
  return { credit: credit || null, debit, balance, amount };
}

/** Which heading an amount sits under - by its centre or its right edge, whichever lines up closer. */
function columnOf(cell, columns) {
  let nearest = null;
  for (const [name, heading] of Object.entries(columns)) {
    if (!heading) continue;
    const distance = Math.min(Math.abs(centre(cell) - centre(heading)), Math.abs(right(cell) - right(heading)));
    if (!nearest || distance < nearest.distance) nearest = { name, distance };
  }
  return nearest?.name || null;
}

/** A line of nothing but column headings - one repeated at the top of a page - is no narration. */
const HEADING_WORDS = /^(sl|si|s\.?no\.?|date|txn date|value date|particulars|description|narration|details|ref(erence)? no\.?.*|chq.*|cheque.*|debit|credit|withdrawals?|deposits?|balance|amount)$/i;
const onlyHeadings = (line) => line.cells.every((cell) => HEADING_WORDS.test(cell.str));
/**
 * A page's lines with a row split across two of them put back together.
 *
 * Some banks (Indian Overseas Bank) print a row's date on one line and its amounts a few points
 * lower on the next, so neither line alone is a row: the dated one has no money and the money has no
 * date. A line of amounts with no date is joined to the dated line just above it - or just below,
 * when only that one is near - as long as that line carries no amounts of its own.
 */
function tableLines(items) {
  const lines = groupLines(items);
  const dated = lines.filter((line) => readRow(line));
  const merged = new Set();
  for (const line of lines) {
    if (readRow(line) || !line.cells.some((cell) => AMOUNT_CELL.test(cell.str))) continue;
    const near = dated
      .filter((row) => !merged.has(row) && Math.abs(row.y - line.y) <= 10 && !row.cells.some((cell) => AMOUNT_CELL.test(cell.str)))
      // The dated line above first, at the same distance as one below.
      .sort((a, b) => Math.abs(a.y - line.y) - Math.abs(b.y - line.y) || b.y - a.y)[0];
    if (!near) continue;
    near.cells = [...near.cells, ...line.cells].sort((a, b) => a.x - b.x);
    near.text = near.cells.map((cell) => cell.str).join(" ");
    merged.add(near);
    line.absorbed = true;
  }
  return lines.filter((line) => !line.absorbed);
}

const END_OF_TABLE = /^summary\b|\btotal (credits|debits|deposits|withdrawals)\b/i;

/**
 * A row of a statement, when it starts with a date - or with a serial number and then a date, as a
 * statement with an "Sl" column does. The serial is not part of the description.
 */
function readRow(line) {
  const { cells } = line;
  const serial = cells.length > 1 && /^\d{1,4}\.?$/.test(cells[0].str) && parseDate(cells[1].str)?.index === 0 ? 1 : 0;
  const leading = cells.slice(serial, serial + 3).map((cell) => cell.str).join(" ");
  const date = parseDate(leading);
  if (!date || date.index > 2) return null;
  // "(25-Oct-26)" under the date is a value date on the row's second line, not a row of its own.
  if (cells[serial].str.startsWith("(")) return null;
  const rest = cells.slice(serial);
  const amounts = rest.filter((cell) => AMOUNT_CELL.test(cell.str));
  // "-" is an empty column (SBI writes one under whichever of Debit / Credit a row leaves blank).
  const words = rest.filter((cell) => !AMOUNT_CELL.test(cell.str) && !CREDIT_MARK.test(cell.str) && !/^dr\.?$/i.test(cell.str) && !/^-+$/.test(cell.str)
    && !(parseDate(cell.str)?.length >= cell.str.length - 1));
  return { y: line.y, date: date.iso, amounts, words: [{ y: line.y, text: words.map((cell) => cell.str).join(" ") }] };
}

/** The money in on a row: under the Deposit heading, or an amount marked Cr that is not the balance. */
function creditOf(row, line, columns) {
  // The running balance is never the payment, whatever it says after it - "100.03 Cr" is a balance
  // in credit, not money in.
  const amounts = row.amounts.filter((cell) => !columns.balance || columnOf(cell, columns) !== "balance");
  const marked = amounts.find((cell) => /cr\.?$/i.test(cell.str));
  if (marked) return marked;
  if (amounts.some((cell) => /dr\.?$/i.test(cell.str))) return null;
  if (columns.credit) return amounts.find((cell) => columnOf(cell, columns) === "credit") || null;
  // One Amount column with the direction in a Cr / Dr column of its own.
  if (line.cells.some((cell) => CREDIT_MARK.test(cell.str))) return amounts.find((cell) => columnOf(cell, columns) === "amount") || null;
  return null;
}

/**
 * The money out on a row that has no money in: Dr after it, else the amount under the Withdrawal
 * heading, else - one Amount column - whatever is not the balance. Never the balance, never 0.00.
 */
function debitOf(row, columns) {
  const amounts = row.amounts.filter((cell) => (!columns.balance || columnOf(cell, columns) !== "balance") && toAmount(cell.str) > 0);
  const marked = amounts.find((cell) => /dr\.?$/i.test(cell.str));
  const under = columns.debit ? amounts.find((cell) => columnOf(cell, columns) === "debit") : null;
  const cell = marked || under || (columns.credit ? null : amounts[0]);
  return cell ? toAmount(cell.str) : null;
}

/**
 * Joins each line that carries no date to the dated row it belongs to, by height on the page.
 *
 * A narration runs on below its row more often than above it, so a row above the line is preferred
 * at up to twice the distance of one below - which is what tells an SBI row's last line ("…TOWN",
 * well below its own date) from the "DEP TFR" heading the next row starts with, and still sends a
 * Union Bank narration's first line, just above its centred date, to that date's row.
 */
function attachNarration(rows, loose) {
  for (const line of loose) {
    let nearest = null;
    for (const row of rows) {
      const distance = Math.abs(row.y - line.y);
      if (distance > 45) continue;
      const cost = row.y > line.y ? distance / 2 : distance;
      if (!nearest || cost < nearest.cost) nearest = { row, cost };
    }
    nearest?.row.words.push({ y: line.y, text: line.text });
  }
}

// A value date in brackets is the row's date again, so it is left out of what the row says.
const describe = (row) => row.words.sort((a, b) => b.y - a.y).map((word) => word.text.replace(/\(\d{1,2}[-/ ][a-z0-9]{2,3}[-/ ]\d{2,4}\)/gi, "").trim()).filter(Boolean).join(" ");

/**
 * A bank statement whose column headings are not text - SBI draws them - read by its running
 * balance instead: on each dated row the right-most amount is the balance, the other is the
 * payment, and whether the balance went up or down by it says which way the money went. A row whose
 * neighbour does not settle it (the first row, a gap in the balance) is put with whichever of the
 * two directions' amounts it lines up under.
 *
 * Null unless at least three dated rows carry a payment and a balance, so a receipt is never read
 * as one.
 */
function parseByBalance(pages) {
  const rows = [];
  for (const items of pages) {
    const dated = [];
    const loose = [];
    for (const line of tableLines(items)) {
      if (END_OF_TABLE.test(line.text) || SKIP_LINE.test(line.text)) continue;
      const row = readRow(line);
      if (row && row.amounts.length >= 2) dated.push(row);
      else if (!row && !line.cells.some((cell) => AMOUNT_CELL.test(cell.str)) && !onlyHeadings(line)) loose.push(line);
    }
    attachNarration(dated, loose);
    rows.push(...dated);
  }
  if (rows.length < 3) return null;

  const signed = (cell) => (/dr\.?$/i.test(cell.str) ? -1 : 1) * toAmount(cell.str);
  const entries = rows.map((row) => {
    const cells = [...row.amounts].sort((a, b) => a.x - b.x);
    const balanceCell = cells[cells.length - 1];
    const paid = cells.slice(0, -1).find((cell) => toAmount(cell.str) > 0) || null;
    return { row, paid, amount: paid ? toAmount(paid.str) : 0, balance: signed(balanceCell), direction: null };
  });
  // Oldest first or newest first: the balance before a row is the row before it, or the row after.
  const forward = entries.reduce((count, entry, index) => count + (index && entry.row.date >= entries[index - 1].row.date ? 1 : 0), 0);
  const ascending = forward >= (entries.length - 1) / 2;
  const close = (a, b) => Math.abs(a - b) < 0.005;
  entries.forEach((entry, index) => {
    const before = ascending ? entries[index - 1] : entries[index + 1];
    if (!entry.paid || !before) return;
    const change = entry.balance - before.balance;
    if (close(change, entry.amount)) entry.direction = "in";
    else if (close(change, -entry.amount)) entry.direction = "out";
  });
  // Where each direction's amounts sit, from the rows the balance settled.
  const edge = (direction) => {
    const settled = entries.filter((entry) => entry.direction === direction);
    return settled.length ? settled.reduce((sum, entry) => sum + right(entry.paid), 0) / settled.length : null;
  };
  const [inEdge, outEdge] = [edge("in"), edge("out")];
  for (const entry of entries) {
    if (!entry.paid || entry.direction || inEdge === null || outEdge === null) continue;
    entry.direction = Math.abs(right(entry.paid) - inEdge) < Math.abs(right(entry.paid) - outEdge) ? "in" : "out";
  }

  const credits = entries.filter((entry) => entry.direction === "in");
  const debits = entries.filter((entry) => entry.paid && entry.direction === "out");
  const read = (entry) => finish({ date: entry.row.date, amount: entry.amount, description: describe(entry.row) });
  return {
    kind: "statement",
    debitCount: entries.filter((entry) => entry.paid && entry.direction !== "in").length,
    transactions: credits.map(read),
    debits: debits.map(read),
  };
}

/**
 * A bank statement: the credits under its Deposit / Credit heading, plus how many rows were money
 * out. Null when the pages carry no statement header at all.
 *
 * A narration that runs over two or three lines is joined to the row it belongs to by **height**:
 * each line without a date goes to the dated row nearest it on the page. Some banks centre the date
 * against the narration, so its first line sits above the date - going by order alone gave every
 * row the tail of its own narration and the head of the next.
 */
function parseStatement(pages) {
  let columns = null;
  let sawHeader = false;
  const transactions = [];
  const debits = [];
  let debitCount = 0;

  for (const items of pages) {
    const rows = [];
    const loose = [];
    let previous = null;
    for (const line of tableLines(items)) {
      // A heading may wrap - "Deposit" over "Amount (INR)" - so a line is also read with the one just above it.
      const above = previous;
      previous = line;
      const heading = headerColumns(line)
        || (above && above.y - line.y <= 14 ? headerColumns({ ...line, cells: [...above.cells, ...line.cells] }) : null);
      if (heading) { columns = heading; sawHeader = true; continue; }
      if (!columns) continue;
      if (END_OF_TABLE.test(line.text)) { columns = null; continue; }
      if (SKIP_LINE.test(line.text)) continue;
      const row = readRow(line);
      // The headings in force for this row, since the table may end before the page does.
      if (row) rows.push({ row, line, columns });
      else if (!line.cells.some((cell) => AMOUNT_CELL.test(cell.str)) && !onlyHeadings(line)) loose.push(line);
    }
    attachNarration(rows.map((item) => item.row), loose);
    for (const { row, line, columns: headings } of rows) {
      if (!row.amounts.length) continue;
      const credit = creditOf(row, line, headings);
      const amount = credit ? toAmount(credit.str) : null;
      if (!amount) {
        debitCount += 1;
        const debit = debitOf(row, headings);
        if (debit) debits.push({ date: row.date, amount: debit, description: describe(row) });
        continue;
      }
      transactions.push({ date: row.date, amount, description: describe(row) });
    }
  }

  if (!sawHeader) return null;
  return {
    kind: "statement",
    debitCount,
    transactions: transactions.map(finish),
    debits: debits.map(finish),
  };
}

/*
 * Money as a payment app writes it: "₹500", "+ Rs. 1,250", "-₹99.50", "500.00 CR". A figure needs a
 * currency mark or two decimals to count, so a serial number or a year is never read as money.
 */
const MONEY_CELL = /^([+-])?\s*(?:(?:₹|rs\.?|inr)\s*[+-]?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?|(\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})\s*(cr|dr)?\.?$/i;
const IN_WORDS = /\b(credit|credited|received|cr|deposit)\b/i;
const OUT_WORDS = /\b(debit|debited|paid|sent|dr|withdrawal|purchase)\b/i;

/** Which way one row's money went, from its sign, a Cr / Dr after it, or the words beside it. */
function directionOf(cell, text) {
  const match = cell.str.match(MONEY_CELL);
  if (match?.[1] === "+") return "in";
  if (match?.[1] === "-" || /^-|[-]\s*(₹|rs)/i.test(cell.str)) return "out";
  if (/cr\.?$/i.test(cell.str)) return "in";
  if (/dr\.?$/i.test(cell.str)) return "out";
  const saysIn = IN_WORDS.test(text);
  const saysOut = OUT_WORDS.test(text);
  if (saysIn && !saysOut) return "in";
  if (saysOut && !saysIn) return "out";
  return null;
}

/**
 * A statement with one amount per row and no running balance - PhonePe, Google Pay, Paytm and the
 * like - where each row says which way it went: a + or -, Cr or Dr, or "Credit" / "Received from"
 * against "Debit" / "Paid to". Null unless at least two rows say so.
 */
function parseByDirection(pages) {
  const rows = [];
  for (const items of pages) {
    const dated = [];
    const loose = [];
    for (const line of tableLines(items)) {
      if (END_OF_TABLE.test(line.text) || SKIP_LINE.test(line.text)) continue;
      const row = readRow(line);
      const money = line.cells.filter((cell) => MONEY_CELL.test(cell.str));
      if (row && money.length) dated.push({ ...row, money });
      else if (!row && !money.length && !onlyHeadings(line)) loose.push(line);
    }
    attachNarration(dated, loose);
    rows.push(...dated);
  }
  const decided = rows.map((row) => ({ row, direction: directionOf(row.money[0], describe(row)) }));
  if (decided.filter((item) => item.direction).length < 2) return null;
  const credits = decided.filter((item) => item.direction === "in");
  const read = ({ row }) => finish({ date: row.date, amount: toAmount(row.money[0].str.replace(/^[+-]/, "")), description: describe(row) });
  return {
    kind: "statement",
    debitCount: decided.length - credits.length,
    transactions: credits.map(read),
    debits: decided.filter((item) => item.direction === "out").map(read),
  };
}

const STATED_CREDITS = /\btotal\s*(credits?|deposits?|cr)\b|\bcredits?\s*total\b/i;
const STATED_DEBITS = /\btotal\s*(debits?|withdrawals?|dr)\b|\bdebits?\s*total\b/i;

/**
 * The total of money in the statement prints for itself - "Total Credits : 17,983.00" on the same
 * line, or under its label on the line below as SBI lays it out - so what was found can be checked
 * against it. Null where the statement prints none.
 */
function statedTotal(pages, labelled) {
  for (const items of pages) {
    const lines = groupLines(items);
    for (let index = 0; index < lines.length; index += 1) {
      const label = lines[index].cells.find((cell) => labelled.test(cell.str));
      if (!label) continue;
      const after = lines[index].cells.find((cell) => cell.x > label.x && AMOUNT_CELL.test(cell.str));
      if (after) return toAmount(after.str);
      const below = lines[index + 1];
      if (below && lines[index].y - below.y <= 35) {
        const figures = below.cells.filter((cell) => AMOUNT_CELL.test(cell.str));
        const nearest = figures.sort((a, b) => Math.abs(centre(a) - centre(label)) - Math.abs(centre(b) - centre(label)))[0];
        if (nearest) return toAmount(nearest.str);
      }
    }
  }
  return null;
}

const RECEIPT_AMOUNT_LABEL = /\b(amount|total|paid|received|credited|payment of)\b/i;
const CURRENCY_AMOUNT = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i;
const PLAIN_AMOUNT = /\b(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{2})\b/;
const PAYER = /\b(?:received from|paid by|from|sender(?: name)?|payer(?: name)?|remitter(?: name)?|customer name)\s*[:-]?\s*(.+)/i;

/** The amount a receipt is for: a labelled one first, then one with a currency mark, then any. */
function receiptAmount(lines) {
  const pick = (text) => {
    const match = text.match(CURRENCY_AMOUNT) || text.match(PLAIN_AMOUNT);
    return match ? toAmount(match[1]) : null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    if (!RECEIPT_AMOUNT_LABEL.test(lines[index])) continue;
    const amount = pick(lines[index].replace(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g, "")) || (lines[index + 1] ? pick(lines[index + 1]) : null);
    if (amount) return amount;
  }
  const text = lines.join("\n");
  const currency = text.match(CURRENCY_AMOUNT);
  if (currency) return toAmount(currency[1]);
  const plain = text.match(PLAIN_AMOUNT);
  return plain ? toAmount(plain[1]) : null;
}

/** A receipt: the one payment it is for, or none when no amount can be found. */
function parseReceipt(pages) {
  const lines = pages.flatMap((items) => groupLines(items).map((line) => line.text));
  const text = lines.join("\n");
  const amount = receiptAmount(lines);
  if (!amount) return { kind: "receipt", debitCount: 0, transactions: [], debits: [] };
  const payer = lines.map((line) => line.match(PAYER)).find(Boolean);
  const description = payer ? `From ${payer[1].trim()}` : (lines[0] || "");
  return {
    kind: "receipt",
    debitCount: 0,
    transactions: [finish({ date: parseDate(text)?.iso || null, amount, description, referenceText: text })],
    debits: [],
  };
}

/** The mode and reference read off a transaction's own text, and the description tidied. */
function finish({ date, amount, description, referenceText }) {
  const source = referenceText || description;
  const mode = detectMode(source);
  return {
    date,
    amount: amount.toFixed(2),
    mode,
    transactionId: findReference(source, mode),
    description: String(description || "").replace(/\s+/g, " ").trim().slice(0, 500),
  };
}

/**
 * @param pages what `extractPdfText` returned
 * @returns {{ kind: "statement"|"receipt", debitCount: number, transactions: Array<{ date, amount, mode, transactionId, description }>, debits: Array<same>, check: { stated, found, matches }|null, debitCheck: { stated, found, matches }|null, hasText: boolean }}
 *   `transactions` is the money in, `debits` the money out; each check is against the statement's own printed total.
 */
function parseTransactions(pages) {
  const hasText = pages.some((items) => items.length > 0);
  if (!hasText) return { kind: "unknown", debitCount: 0, transactions: [], debits: [], check: null, debitCheck: null, hasText };
  const result = parseStatement(pages) || parseByBalance(pages) || parseByDirection(pages) || parseReceipt(pages);
  /*
   * The check against the statement's own figure: where it prints a total of credits, what was found
   * should come to it. Not a guarantee of each row, but a missed or misread one shows up here
   * instead of passing in silence.
   */
  const against = (labelled, found) => {
    const stated = result.kind === "statement" ? statedTotal(pages, labelled) : null;
    const sum = found.reduce((total, item) => total + Number(item.amount), 0);
    return stated === null ? null : { stated: stated.toFixed(2), found: sum.toFixed(2), matches: Math.abs(stated - sum) < 0.005 };
  };
  // The same check for money out, against the Total Debits the statement prints.
  return { ...result, check: against(STATED_CREDITS, result.transactions), debitCheck: against(STATED_DEBITS, result.debits || []), hasText };
}

module.exports = { parseTransactions, parseDate, findReference, detectMode, groupLines, toAmount };
