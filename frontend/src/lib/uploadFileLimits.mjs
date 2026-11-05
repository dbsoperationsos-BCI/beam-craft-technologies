/**
 * How big a picked file may be before the browser even tries it, for a documents field that also
 * compresses pictures (`FileUploadField` with `compressImages`, the production tickets).
 *
 * A document goes up as it is, so it is held to 5 MB. A picture is compressed on the phone to
 * about 150 KB before it leaves, so what matters is only that the phone can decode it - the same
 * 10 MB `MultiImageField` allows, which a phone camera's photo of a paper ticket fits inside.
 */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_PICTURE_BYTES = 10 * 1024 * 1024;

const isPicture = (file) => String(file?.type || "").startsWith("image/");

export const fileSizeLimit = (file) => (isPicture(file) ? MAX_PICTURE_BYTES : MAX_DOCUMENT_BYTES);

/** The files that fit their limit, and those that do not. */
export function splitBySize(files = []) {
  const fitting = [];
  const oversized = [];
  for (const file of files) (file.size > fileSizeLimit(file) ? oversized : fitting).push(file);
  return { fitting, oversized };
}

/** What to say about files that were left out, or "" when none were. */
export function leftOutNotice(count) {
  if (!count) return "";
  return `${count} file${count === 1 ? " was" : "s were"} not added - PDFs up to 5 MB, photos up to 10 MB, and only as many as there is room for.`;
}
