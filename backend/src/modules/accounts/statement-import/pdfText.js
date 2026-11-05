/**
 * The words on each page of a PDF, with where each one sits.
 *
 * pdf.js reads the file in memory, opening it with the password the person typed for it, and hands
 * back every run of text with its x/y position. The positions are what tell a statement's Deposit
 * column from its Withdrawal column, so they are kept rather than flattened into one string.
 *
 * The password lives only for this call: it is never written to the database, a log or a file.
 */

/** A statement longer than this is not one statement; reading stops rather than running on. */
const MAX_PAGES = 200;
/** Runs of text across the whole file - far beyond any statement, short of a file built to be slow. */
const MAX_TEXT_ITEMS = 50_000;
/** How long one file may take before it is given up on. */
const TIMEOUT_MS = 30_000;
/*
 * How many files this process reads at once. pdf.js works on the API's own thread, so a batch from
 * several people at the same moment queues here rather than all parsing side by side.
 */
const MAX_CONCURRENT = 2;
let running = 0;
const waiting = [];

async function withSlot(work) {
  if (running >= MAX_CONCURRENT) await new Promise((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

let pdfjsPromise = null;
// pdf.js ships as an ES module only, so it is imported on first use rather than required.
const loadPdfjs = () => {
  pdfjsPromise ||= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
};

const fail = (code, message) => Object.assign(new Error(message), { code });

/**
 * @returns {Promise<Array<Array<{ str: string, x: number, y: number, width: number }>>>} one array per page
 * @throws an error whose `code` is PASSWORD_REQUIRED, PASSWORD_INCORRECT or UNREADABLE
 */
function extractPdfText(buffer, password = "") {
  return withSlot(() => readWithin(buffer, password));
}

async function readWithin(buffer, password) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    // A view of the upload's own bytes rather than a third copy of them.
    data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length),
    password: password || undefined,
    // The file is somebody's upload: no evaluated font code, no fonts handed to the system, nothing
    // fetched from anywhere.
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    maxImageSize: 1_000_000,
    stopAtErrors: false,
    verbosity: 0,
  });
  /*
   * A hard stop for a file built to be expensive. pdf.js yields between its steps, so this fires
   * between pages and destroying the task ends the work there.
   */
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      void task.destroy();
      reject(fail("UNREADABLE", "This PDF took too long to read."));
    }, TIMEOUT_MS);
  });
  try {
    const reading = read(pdfjs, task);
    // Once the timeout has answered, the read's own rejection has nobody waiting on it.
    reading.catch(() => {});
    return await Promise.race([reading, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function read(pdfjs, task) {
  let document;
  try {
    document = await task.promise;
  } catch (error) {
    if (error?.name === "PasswordException") {
      throw error.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD
        ? fail("PASSWORD_INCORRECT", "The password for this PDF is not correct.")
        : fail("PASSWORD_REQUIRED", "This PDF is password-protected. Enter its password.");
    }
    throw fail("UNREADABLE", "This file could not be opened as a PDF.");
  }

  try {
    const pages = [];
    let total = 0;
    const count = Math.min(document.numPages, MAX_PAGES);
    for (let number = 1; number <= count && total < MAX_TEXT_ITEMS; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const items = content.items
        .filter((item) => typeof item.str === "string" && item.str.trim())
        .slice(0, MAX_TEXT_ITEMS - total)
        .map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width || 0 }));
      total += items.length;
      pages.push(items);
      page.cleanup();
    }
    return pages;
  } finally {
    await document.destroy();
  }
}

module.exports = { extractPdfText, MAX_PAGES, MAX_TEXT_ITEMS };
