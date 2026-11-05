/*
 * The offer letter's own sections as one piece of text, and back - so an imported document can be
 * edited in a single box, like a document, rather than a card at a time.
 *
 *   ## Title          a section's title
 *   - a point         a bulleted point (• works too)
 *   1. a point        a numbered point (1) works too)
 *   anything else     the section's paragraph, line breaks kept
 *
 * A blank line is only a gap. A section is one kind - a paragraph, points or numbered points - so a
 * list under a title that already has a paragraph (or the other way round) is said, not guessed at.
 */

const TITLE = /^##\s*(.*)$/;
const BULLET = /^\s*[-•*]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
// "1. Appointment" or "2.1) Duties" or "IV. Leave" - a document's own numbering in front of a title,
// which the letter adds itself.
const TITLE_NUMBER = /^\s*(?:\d+(?:\.\d+)*|[IVXLC]+)[.)]?\s+(?=\S)/;

export const TITLE_LIMIT = 120;
export const CONTENT_LIMIT = 3000;
export const POINT_LIMIT = 500;
export const MAX_POINTS = 30;

/** A title without the numbering a document put in front of it. */
export const stripTitleNumber = (title) => String(title || "").replace(TITLE_NUMBER, "").trim();

/** Sections as the text the box shows. */
export function sectionsToText(sections = []) {
  return sections.map((section) => {
    const body = section.format === "POINTS" ? section.points.map((point) => `- ${point}`)
      : section.format === "NUMBERED" ? section.points.map((point, at) => `${at + 1}. ${point}`)
        : [String(section.content || "")];
    return [`## ${section.title || ""}`, ...body].join("\n");
  }).join("\n\n");
}

/**
 * The box's text as sections - `{ sections, errors }`. `errors` says, in the studio's words and by
 * line, what has to change before it can be saved; `sections` holds what could be read either way,
 * so the letter beside it can still be drawn.
 */
export function textToSections(text = "") {
  const sections = [];
  const errors = [];
  let current = null;
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((raw, index) => {
    const line = raw.replace(/\s+$/, "");
    const lineNo = index + 1;
    if (!line.trim()) return;
    const title = line.match(TITLE);
    if (title) {
      current = { title: stripTitleNumber(title[1]), format: null, content: "", points: [], line: lineNo };
      sections.push(current);
      if (!current.title) errors.push(`Line ${lineNo}: give the section a title after ##.`);
      return;
    }
    if (!current) {
      errors.push(`Line ${lineNo}: start with a title - a line beginning ## - before any text.`);
      current = { title: "", format: null, content: "", points: [], line: lineNo };
      sections.push(current);
    }
    const bullet = line.match(BULLET);
    const number = bullet ? null : line.match(NUMBER);
    const format = bullet ? "POINTS" : number ? "NUMBERED" : "PARAGRAPH";
    if (current.format && current.format !== format) {
      if (!current.mixed) errors.push(`"${current.title || `Line ${current.line}`}" mixes a paragraph and a list, or bullets and numbers - give each its own ## title.`);
      current.mixed = true;
      return;
    }
    current.format = format;
    if (format === "PARAGRAPH") current.content = current.content ? `${current.content}\n${line.trim()}` : line.trim();
    else current.points.push((bullet || number)[1].trim());
  });

  const cleaned = sections.map((section) => {
    const name = section.title || `Line ${section.line}`;
    if (!section.format) errors.push(`"${name}" has nothing under it - write its text or points, or remove the title.`);
    if (section.title.length > TITLE_LIMIT) errors.push(`"${name.slice(0, 40)}..." - keep a title to ${TITLE_LIMIT} characters.`);
    if (section.format === "PARAGRAPH" && section.content.length > CONTENT_LIMIT) errors.push(`"${name}" - keep a paragraph to ${CONTENT_LIMIT.toLocaleString("en-IN")} characters.`);
    if (section.points.length > MAX_POINTS) errors.push(`"${name}" - keep a section to ${MAX_POINTS} points.`);
    if (section.points.some((point) => point.length > POINT_LIMIT)) errors.push(`"${name}" - keep each point to ${POINT_LIMIT} characters.`);
    return section.format === "PARAGRAPH" || !section.format
      ? { title: section.title, format: "PARAGRAPH", content: section.content }
      : { title: section.title, format: section.format, points: section.points };
  });
  return { sections: cleaned, errors };
}
