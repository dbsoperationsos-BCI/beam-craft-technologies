const { uploadObject } = require("./objectStorage");
const { isConfigured, missingKeys } = require("../config/r2");

const DOCUMENT_FOLDER = "assets/documents";
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

const fail = (status, message) => Object.assign(new Error(message), { status });
const isHttpUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value.trim());

// Documents are stored as uploaded - the bytes are never re-encoded - but **what the bucket is told
// they are** is this list and nothing else. It is both the extension table and the allowlist: a type
// that is not here is refused rather than stored under whatever the file name claimed.
const extensionsByMimeType = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/plain": "txt",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/*
 * What a file's **own first bytes** have to say for the declared type to be believed.
 *
 * The declared MIME decides the extension and whether the type is stored at all, and a caller can
 * declare anything: a macro-laden `.docm`, a CSV of formula cells or an HTML page sent as
 * `application/pdf` was stored as a PDF and handed to whoever opened it. Every type here carries a
 * fixed signature, so the claim is checkable - and the file people are most likely to be sent one
 * of is the PDF.
 *
 * Only the types that have a signature are listed. A `.docx` is a zip and a `.csv` is text, so
 * neither can be told from the other by its first bytes; those are bounded by the allow-list a
 * caller passes instead (`types`), which is how the public forms accept nothing but a PDF or an
 * image.
 */
const SIGNATURES = {
  "application/pdf": [{ at: 0, bytes: [0x25, 0x50, 0x44, 0x46] }],
  "image/jpeg": [{ at: 0, bytes: [0xff, 0xd8, 0xff] }],
  "image/png": [{ at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  // `RIFF....WEBP`: the four bytes between the two marks are the file's own length.
  "image/webp": [{ at: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, { at: 8, bytes: [0x57, 0x45, 0x42, 0x50] }],
};

/** True where the type has no signature to check, or the bytes carry it. */
const matchesSignature = (buffer, mimeType) => (SIGNATURES[mimeType] || [])
  .every(({ at, bytes }) => bytes.every((byte, index) => buffer[at + index] === byte));

let warnedOnce = false;
function warnUnconfigured() {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(`[documentStorage] Cloudflare R2 is not configured (missing: ${missingKeys().join(", ")}). Documents are being kept inline. Set these before deploying.`);
}


/**
 * Uploads one picked document to R2 and returns the record to persist: `{ name, url }`.
 *
 * A document that already carries a `url` is returned untouched, so an update that echoes back
 * the files already on the asset never re-uploads them. Outside production a missing R2
 * configuration keeps the inline payload so local development still works, exactly as images do.
 *
 * @param {{name: string, data?: string, url?: string}} document
 * @param {object} [options]
 * @param {string} [options.folder="assets/documents"] key prefix inside the bucket.
 * @param {string[]} [options.types] MIME types this caller accepts, narrowing the application's own
 *   list - what the public forms pass so an unauthenticated upload is a PDF or an image, nothing else.
 * @returns {Promise<{name: string, url?: string, data?: string, key: string|null}|null>}
 */
async function storeDocument(document, options = {}) {
  if (!document) return null;
  /*
   * `trustUrls: false` - for a caller whose documents come from **outside a session**.
   *
   * The shortcut below returns any `http(s)` url untouched, which is right for an authenticated
   * edit echoing back the files already on a record: nothing is re-uploaded. On a public,
   * token-authenticated form it is something else entirely - whoever holds the link chooses what
   * the studio's own "Résumé" link points at, with no file ever uploaded. So that path passes
   * `trustUrls: false` and a url-only document is simply dropped.
   */
  if (isHttpUrl(document.url)) {
    if (options.trustUrls === false) return null;
    return { name: document.name, url: document.url.trim(), key: null, reused: true };
  }

  const match = String(document.data || "").match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) throw fail(400, `${document.name || "This document"} could not be read.`);
  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw fail(400, `${document.name || "This document"} could not be decoded.`);
  if (buffer.length > MAX_DOCUMENT_BYTES) throw fail(400, `${document.name || "This document"} must be 5 MB or smaller.`);

  /*
   * What the bucket is allowed to be told this file is.
   *
   * The declared MIME went through to R2 as the object's `Content-Type` with nothing checked, and
   * the stored extension came from the **candidate's own file name**. The bucket is served whole
   * from `R2_PUBLIC_BASE_URL`, so a public form could put `image/svg+xml` or `text/html` on that
   * origin and have it executed as a page rather than downloaded as a document.
   *
   * `extensionsByMimeType` was already the list of what this application stores; it is now the
   * allowlist as well, and the extension is derived from the **type** rather than from the name -
   * so `cert.svg` carrying a PDF is stored as the PDF it is, and one carrying SVG is refused.
   *
   * Enforced for every caller rather than only the public one: an authenticated screen has no
   * reason to store a type this list does not name either, and a rule with an exemption is a rule
   * somebody eventually routes around.
   */
  const allowedExtension = extensionsByMimeType[mimeType];
  if (!allowedExtension) throw fail(400, `${document.name || "This document"} is not a kind of file this application stores.`);
  /*
   * `types` narrows that list for one caller, and the public forms use it.
   *
   * The list above is what the *application* stores, which is wider than what any one screen should
   * accept: a resignation letter is a PDF or a photograph of a signed page, and an unauthenticated
   * caller has no business putting a spreadsheet or a Word macro document on the studio's bucket
   * for HR to open. Where a caller names its types, nothing outside them is stored.
   */
  if (Array.isArray(options.types) && !options.types.includes(mimeType)) {
    throw fail(400, `${document.name || "This document"} is not a kind of file this form accepts.`);
  }
  /*
   * And the bytes have to agree with the claim. Without this the type is only an assertion by the
   * caller: an HTML page or a macro document declared `application/pdf` was stored as a PDF, on a
   * bucket served whole, for whoever opened it next.
   */
  if (!matchesSignature(buffer, mimeType)) {
    throw fail(400, `${document.name || "This document"} is not really a ${allowedExtension.toUpperCase()} file.`);
  }

  if (!isConfigured) {
    if (process.env.NODE_ENV === "production") throw fail(500, "Document storage is not configured on this server.");
    warnUnconfigured();
    return { name: document.name, data: document.data, key: null, reused: false };
  }

  const { key, url } = await uploadObject(buffer, { folder: options.folder || DOCUMENT_FOLDER, extension: allowedExtension, contentType: mimeType });
  return { name: document.name, url, key, reused: false };
}

/** Runs {@link storeDocument} over a list, dropping empty entries. */
async function storeDocuments(documents, options = {}) {
  const list = (Array.isArray(documents) ? documents : []).filter(Boolean);
  const stored = [];
  for (const document of list) {
    const result = await storeDocument(document, options);
    if (result) stored.push(result);
  }
  return stored;
}

module.exports = { storeDocument, storeDocuments, MAX_DOCUMENT_BYTES, matchesSignature };
