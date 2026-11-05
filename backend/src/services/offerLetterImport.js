const JSZip = require("jszip");
const mammoth = require("mammoth");

/**
 * Settings → Offer Letter → Sections → Import from .docx: a Word document read into the letter's own
 * sections - `{ title, format, content | points }`, the shape Add Section writes - for the admin to
 * review before anything is saved. Only the words and their structure come across; the letter prints
 * them in its own style, so nothing of the file's fonts, colours or spacing reaches it.
 *
 *   A heading (Heading 1-6), or a short line that is bold throughout   → a section's title
 *   Paragraphs under it                                                 → PARAGRAPH, a line each
 *   A bulleted list                                                     → POINTS
 *   A numbered list                                                     → NUMBERED
 *   A table                                                             → POINTS, a row each
 *   Images, headers, footers, fonts, colours                            → left out
 *
 * A section is one kind or the other, so where a paragraph and a list share a title the list goes on
 * as a section of its own with no title - the review marks it by line, and asks for one. So does
 * anything before the first title. Limits are the Sections editor's: 120-character titles, 3,000-character paragraphs, 30
 * points of 500 characters; what goes past them is cut and said in `warnings`.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;
// A .docx is a zip: refused before it is read when it opens out larger than this - counted as its
// parts are actually inflated, never from the sizes the file declares about itself.
const MAX_UNZIPPED_BYTES = 20 * 1024 * 1024;
// Lists nested deeper than this are read flat - a document is never this deep, a crafted one might be.
const MAX_DEPTH = 100;
const MAX_ENTRIES = 2000;
const TITLE_LIMIT = 120;
const CONTENT_LIMIT = 3000;
const POINT_LIMIT = 500;
const MAX_POINTS = 30;
// A bold line longer than this is a bold sentence, not a title.
const BOLD_TITLE_MAX = 90;

const fail = (status, message) => Object.assign(new Error(message), { status });

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };
const decode = (text) => String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, name) => {
  if (name[0] === "#") {
    const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }
  return ENTITIES[name.toLowerCase()] ?? match;
});
const clean = (text) => decode(text).replace(/\s+/g, " ").trim();
// "1. Appointment", "2.1) Duties", "IV. Leave" - a document's own numbering in front of a title; the
// letter numbers its sections itself, so it would print "3. 1. Appointment".
const stripTitleNumber = (title) => String(title || "").replace(/^\s*(?:\d+(?:\.\d+)*|[IVXLC]+)[.)]?\s+(?=\S)/, "").trim();

/**
 * Mammoth's HTML as a small tree - `{ tag, children }` and text - read with one pass over its tags.
 * Its output is a known handful of well-formed tags (h1-h6, p, strong, em, ul, ol, li, table, tr,
 * td, a, br...), so a stack is all the parsing it needs.
 */
function parse(html) {
  const root = { tag: "root", children: [] };
  const stack = [root];
  const VOID = new Set(["br", "img", "hr"]);
  for (const match of String(html).matchAll(/<(\/?)([a-z0-9]+)[^>]*?(\/?)>|([^<]+)/gi)) {
    const [, closing, rawTag, selfClosing, text] = match;
    const top = stack[stack.length - 1];
    if (text !== undefined) { top.children.push(text); continue; }
    const tag = rawTag.toLowerCase();
    if (closing) {
      const at = stack.map((node) => node.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const node = { tag, children: [] };
    top.children.push(node);
    if (tag === "br") node.children.push("\n");
    if (!VOID.has(tag) && !selfClosing && stack.length < MAX_DEPTH) stack.push(node);
  }
  return root;
}

const textOf = (node, skip = new Set()) => (typeof node === "string" ? node
  : skip.has(node.tag) ? "" : node.children.map((child) => textOf(child, skip)).join(""));

/** A paragraph that is bold throughout - its text all inside <strong> - and short: a title. */
function boldTitle(node) {
  const meaningful = node.children.filter((child) => (typeof child === "string" ? child.trim() : true));
  if (!meaningful.length || meaningful.some((child) => typeof child === "string" || child.tag !== "strong")) return "";
  const text = clean(textOf(node));
  return text && text.length <= BOLD_TITLE_MAX ? text : "";
}

/** A list's items, each its own text; a list inside an item comes after it, flattened. */
function listItems(list) {
  const items = [];
  for (const item of list.children) {
    if (typeof item === "string" || item.tag !== "li") continue;
    const own = clean(textOf(item, new Set(["ul", "ol"])));
    if (own) items.push(own);
    for (const child of item.children) {
      if (typeof child !== "string" && (child.tag === "ul" || child.tag === "ol")) items.push(...listItems(child));
    }
  }
  return items;
}

/** A table's rows, each its cells joined - a point a row. */
function tableRows(table) {
  const rows = [];
  const walk = (node) => {
    if (typeof node === "string") return;
    if (node.tag === "tr") {
      const cells = node.children.filter((cell) => typeof cell !== "string" && (cell.tag === "td" || cell.tag === "th")).map((cell) => clean(textOf(cell))).filter(Boolean);
      if (cells.length) rows.push(cells.join(" - "));
      return;
    }
    node.children.forEach(walk);
  };
  walk(table);
  return rows;
}

/** Mammoth's HTML read into sections, and what had to be cut to fit. */
function sectionsFromHtml(html) {
  const sections = [];
  const warnings = [];
  let current = null;
  let pendingTitle = "";

  const open = (format) => {
    current = { title: pendingTitle, format, content: "", points: [] };
    pendingTitle = "";
    sections.push(current);
  };
  const addParagraph = (text) => {
    if (!current || current.format !== "PARAGRAPH" || pendingTitle) open("PARAGRAPH");
    current.content = current.content ? `${current.content}\n${text}` : text;
  };
  const addPoints = (format, items) => {
    if (!items.length) return;
    if (!current || current.format !== format || pendingTitle) open(format);
    current.points.push(...items);
  };
  const setTitle = (title) => {
    // A title with nothing under it yet is replaced by the next, rather than left empty.
    pendingTitle = title;
    current = null;
  };

  for (const node of parse(html).children) {
    if (typeof node === "string") {
      const text = clean(node);
      if (text) addParagraph(text);
      continue;
    }
    if (/^h[1-6]$/.test(node.tag)) {
      const title = stripTitleNumber(clean(textOf(node)));
      if (title) setTitle(title);
    } else if (node.tag === "p") {
      const title = stripTitleNumber(boldTitle(node));
      if (title) { setTitle(title); continue; }
      const text = clean(textOf(node));
      if (text) addParagraph(text);
    } else if (node.tag === "ul") {
      addPoints("POINTS", listItems(node));
    } else if (node.tag === "ol") {
      addPoints("NUMBERED", listItems(node));
    } else if (node.tag === "table") {
      addPoints("POINTS", tableRows(node));
    } else {
      const text = clean(textOf(node));
      if (text) addParagraph(text);
    }
  }

  // Fitted to the editor's limits, each cut said once.
  const fitted = sections.map((section, index) => {
    const name = section.title || `Section ${index + 1}`;
    let { title } = section;
    if (title.length > TITLE_LIMIT) { title = title.slice(0, TITLE_LIMIT).trim(); warnings.push(`"${name.slice(0, 40)}..." - the title was cut to ${TITLE_LIMIT} characters.`); }
    if (section.format === "PARAGRAPH") {
      let content = section.content;
      if (content.length > CONTENT_LIMIT) { content = content.slice(0, CONTENT_LIMIT).trim(); warnings.push(`${name} - the text was cut to ${CONTENT_LIMIT.toLocaleString("en-IN")} characters.`); }
      return { title, format: "PARAGRAPH", content };
    }
    let points = section.points.map((point) => (point.length > POINT_LIMIT ? point.slice(0, POINT_LIMIT).trim() : point));
    if (section.points.some((point) => point.length > POINT_LIMIT)) warnings.push(`${name} - a point longer than ${POINT_LIMIT} characters was cut.`);
    if (points.length > MAX_POINTS) { warnings.push(`${name} - ${points.length} points; the first ${MAX_POINTS} are kept.`); points = points.slice(0, MAX_POINTS); }
    return { title, format: section.format, points };
  });
  return { sections: fitted, warnings };
}

/** Refuses a file that is not a .docx, or one that would open out far larger than it is. */
async function checkDocx(buffer, fileName = "") {
  if (!buffer?.length) throw fail(400, "Choose a .docx file.");
  if (buffer.length > MAX_FILE_BYTES) throw fail(400, "Choose a .docx file of 5 MB or less.");
  if (!/\.docx$/i.test(String(fileName))) throw fail(400, "Only Word .docx files can be imported - save the document as .docx and try again.");
  // A .docx is a zip, which starts "PK"; anything else wearing the name is refused.
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw fail(400, "That file is not a Word .docx document.");
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw fail(400, "That file could not be opened as a Word document.");
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > MAX_ENTRIES) throw fail(400, "That document is too large to import.");
  if (!zip.file("word/document.xml")) throw fail(400, "That file is not a Word .docx document.");
  /*
   * Every part inflated here first, its bytes counted as they come out, and stopped the moment the
   * whole passes the cap. The sizes a zip declares are the file's own say-so - a crafted one declares
   * a few bytes and inflates to gigabytes - so only what actually comes out is believed. Once this
   * has run to the end, mammoth's own inflating of the same parts is the same, already-counted bytes.
   */
  let total = 0;
  for (const entry of entries) {
    await new Promise((resolve, reject) => {
      const stream = entry.internalStream("uint8array");
      stream
        .on("data", (chunk) => {
          total += chunk.length;
          if (total > MAX_UNZIPPED_BYTES) { stream.pause(); reject(fail(400, "That document is too large to import.")); }
        })
        .on("error", () => reject(fail(400, "That file could not be opened as a Word document.")))
        .on("end", resolve)
        .resume();
    });
  }
}

/** A .docx file read into sections for review - `{ sections, warnings }`. Nothing is saved. */
async function importOfferSections(buffer, fileName) {
  await checkDocx(buffer, fileName);
  let html;
  try {
    // Images are dropped rather than carried as data: the letter prints none.
    ({ value: html } = await mammoth.convertToHtml({ buffer }, { convertImage: mammoth.images.imgElement(() => ({ src: "" })), ignoreEmptyParagraphs: true }));
  } catch {
    throw fail(400, "That file could not be read as a Word document.");
  }
  const result = sectionsFromHtml(html);
  if (!result.sections.length) throw fail(400, "Nothing to import - the document has no text.");
  return result;
}

module.exports = { MAX_FILE_BYTES, importOfferSections, sectionsFromHtml, checkDocx, stripTitleNumber };
