/**
 * Where to put a photo's thumbnail inside a circle so that one face fills it.
 *
 * The People row shows each person as a circle cut from an existing thumbnail - no crop is stored
 * anywhere - so the browser has to place the whole image behind a round window. Given the face's
 * box as fractions of the frame and the photo's own pixel size, this answers the `<img>`'s width,
 * height, left and top in pixels for a window `size` pixels across. The face is padded to a
 * square (`pad` times its longer side) so hair and chin are in the circle, the image is scaled so
 * that square fills the window, and the placement is then clamped so the window never shows
 * background beyond the photo's edge for a face near it.
 *
 * Null when there is nothing usable to place - no box, no size, an empty box - and the caller
 * falls back to the plain thumbnail.
 */
export function faceCropStyle(box, width, height, size, pad = 1.8) {
  if (!box || !(width > 0) || !(height > 0) || !(size > 0)) return null;
  const faceWidth = Number(box.w) * width;
  const faceHeight = Number(box.h) * height;
  if (!(faceWidth > 0) || !(faceHeight > 0)) return null;
  const side = Math.max(faceWidth, faceHeight) * pad;
  // Enough to fill the square, and never so little that the photo is smaller than the window.
  const scale = Math.max(size / side, size / width, size / height);
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const centerX = (Number(box.x) + Number(box.w) / 2) * width * scale;
  const centerY = (Number(box.y) + Number(box.h) / 2) * height * scale;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  return {
    width: round(scaledWidth),
    height: round(scaledHeight),
    left: round(clamp(size / 2 - centerX, size - scaledWidth, 0)),
    top: round(clamp(size / 2 - centerY, size - scaledHeight, 0)),
  };
}

function round(value) { return Math.round(value * 100) / 100; }
