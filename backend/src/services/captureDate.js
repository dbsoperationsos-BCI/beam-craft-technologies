// A capture time the client read off a photo is believed only inside a sane window: nothing before
// digital cameras wrote EXIF, nothing after tomorrow. Outside it the photo simply has no capture
// time (as one with no EXIF has), rather than a row pinned to the year 1 or 9999 - which would
// also fall outside MySQL's DATETIME and turn the upload into a 500. Shared by every browser
// uploader that re-encodes a photo before sending it (AI Event media, Photo Selection).
const CAPTURE_FLOOR = new Date("1990-01-01T00:00:00Z");
function saneCaptureDate(text) {
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || date < CAPTURE_FLOOR || date.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  return date;
}

module.exports = { saneCaptureDate };
