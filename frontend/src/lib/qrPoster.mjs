/**
 * QR posters for an AI Feature event: ten designs drawn on a canvas from the event's live guest
 * link, its own name and the studio's logo - the Share dialog's QR Template, web and desktop.
 *
 * Framework-free and mirrored word for word by the desktop (`modules/ai-curation/lib/qrPoster.js`):
 * both clients draw the same poster from the same kit (`GET /events/:id/share/poster`), so the
 * templates, the text, the QR, the logo rule and the export sizes are one definition. Only saving
 * the file differs (the browser's download; a folder and a Rust write on the desktop).
 *
 * - The QR is drawn from the server's module grid (`kit.qr`), never from a picture: every module
 *   is a whole number of device pixels with a four-module quiet zone, black on a white card on
 *   every design, so it scans from print. It encodes `kit.url`, the link the dialog shows.
 * - The logo is the studio's Global Logo as the server read it (`kit.logos`), light or dark as the
 *   design's background asks (`logoFor` in studioBranding), else the app's own fallback mark; a
 *   mark that will not load is the fallback too, and with neither the studio's name is written.
 * - Only Montserrat, and only Material icons (the camera and the face are MUI's own paths).
 */

/**
 * Every design is one page size: A1 portrait, 594 × 841 mm. The layout is drawn in half-millimetre
 * units (1188 × 1682), so a number in it is a distance on the printed sheet, and the page is
 * exported at 300 dpi - 7016 × 9933 px - or, only where a device cannot hold a canvas that large,
 * at 150 dpi (3508 × 4967 px), still a true A1 page. The previews are the same page, smaller.
 */
export const PAGE_MM = Object.freeze({ width: 594, height: 841 });
export const POSTER_SIZE = Object.freeze({ width: PAGE_MM.width * 2, height: PAGE_MM.height * 2 });
export const EXPORT_DPI = 300;
export const FALLBACK_DPI = 150;
/** Device pixels per layout unit at `dpi`: half a millimetre at that resolution. */
export const scaleForDpi = (dpi) => ((PAGE_MM.width / 25.4) * dpi) / POSTER_SIZE.width;
export const EXPORT_SCALE = scaleForDpi(EXPORT_DPI);
/** A1 in PDF points (1/72 in), to two decimals. */
export const PAGE_POINTS = Object.freeze({ width: Math.round((PAGE_MM.width / 25.4) * 72 * 100) / 100, height: Math.round((PAGE_MM.height / 25.4) * 72 * 100) / 100 });
export const FALLBACK_MARKS = Object.freeze({ onLight: "/brand/beam-craft-black-text.svg", onDark: "/brand/beam-craft-white-text.svg" });

export const DEFAULT_TEXT = Object.freeze({
  heading: "GET YOUR PHOTOS",
  subheading: "FROM THE EVENT",
  instruction: "REGISTER YOUR FACE",
  note: "GET YOUR IMAGES USING AI & FACE RECOGNITION",
});
export const TEXT_LIMITS = Object.freeze({ heading: 32, subheading: 36, instruction: 32, note: 90, footer: 60 });
export const TEXT_FIELDS = Object.freeze([
  { key: "heading", label: "Heading" },
  { key: "subheading", label: "Under the heading" },
  { key: "instruction", label: "Instruction" },
  { key: "note", label: "Supporting line" },
  { key: "footer", label: "Event name line" },
]);

// MUI's PhotoCameraOutlined and FaceOutlined, on their 24-unit grid.
const ICON_PATHS = {
  camera: "m14.12 4 1.83 2H20v12H4V6h4.05l1.83-2zM15 2H9L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17zm-3 7c1.65 0 3 1.35 3 3s-1.35 3-3 3-3-1.35-3-3 1.35-3 3-3m0-2c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5",
  face: "M10.25 13c0 .69-.56 1.25-1.25 1.25S7.75 13.69 7.75 13s.56-1.25 1.25-1.25 1.25.56 1.25 1.25M15 11.75c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25m7 .25c0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2s10 4.48 10 10M10.66 4.12C12.06 6.44 14.6 8 17.5 8c.46 0 .91-.05 1.34-.12C17.44 5.56 14.9 4 12 4c-.46 0-.91.05-1.34.12M4.42 9.47c1.71-.97 3.03-2.55 3.66-4.44C6.37 6 5.05 7.58 4.42 9.47M20 12c0-.78-.12-1.53-.33-2.24-.7.15-1.42.24-2.17.24-3.13 0-5.92-1.44-7.76-3.69C8.69 8.87 6.6 10.88 4 11.86c.01.04 0 .09 0 .14 0 4.41 3.59 8 8 8s8-3.59 8-8",
};

// ── Decorations ─────────────────────────────────────────────────────────────────────────────
function leaf(ctx, x, y, length, angle, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(length * 0.3, -length * 0.32, length * 0.75, -length * 0.3, length, 0);
  ctx.bezierCurveTo(length * 0.75, length * 0.3, length * 0.3, length * 0.32, 0, 0);
  ctx.fill(); ctx.restore();
}
function sprig(ctx, x, y, length, angle, colors) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.strokeStyle = colors[0]; ctx.lineWidth = 4; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(length * 0.5, -length * 0.08, length, 0); ctx.stroke();
  for (let i = 1; i <= 6; i += 1) {
    const at = (length * i) / 7;
    const size = length * (0.3 - i * 0.025);
    leaf(ctx, at, -2, size, -0.75, colors[i % colors.length]);
    leaf(ctx, at, 2, size, 0.75, colors[(i + 1) % colors.length]);
  }
  leaf(ctx, length, 0, length * 0.18, 0, colors[1 % colors.length]);
  ctx.restore();
}
function flower(ctx, x, y, radius, petal, centre) {
  ctx.save(); ctx.translate(x, y);
  for (let i = 0; i < 5; i += 1) {
    ctx.rotate((Math.PI * 2) / 5); ctx.fillStyle = petal;
    ctx.beginPath(); ctx.ellipse(0, -radius * 0.62, radius * 0.42, radius * 0.62, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = centre; ctx.beginPath(); ctx.arc(0, 0, radius * 0.24, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function frame(ctx, inset, color, width, { W, H }) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
}
function waves(ctx, { W, H }, color, from, count, amplitude) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2;
  for (let i = 0; i < count; i += 1) {
    ctx.globalAlpha = 0.18 + (i / count) * 0.5;
    ctx.beginPath();
    for (let x = -20; x <= W + 20; x += 20) {
      const y = from + i * 9 + Math.sin(x / 210 + i * 0.22) * amplitude + Math.cos(x / 97) * amplitude * 0.25;
      if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
function glow(ctx, x, y, radius, color) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color); gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}
function linear(ctx, { W, H }, stops) {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  stops.forEach(([at, color]) => gradient.addColorStop(at, color));
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
}

/**
 * The ten designs. `dark` picks the logo drawn for a dark background; `palette` colours the words;
 * `decorate` draws behind them; `icon` is the mark over Register your face.
 */
export const QR_TEMPLATES = Object.freeze([
  {
    id: "ivory", name: "Ivory Classic", dark: false, icon: "camera",
    palette: { background: "#F8F4EC", ink: "#1F2328", accent: "#8B6F47", muted: "#5B5B5B", rule: "#B9A27F" },
    decorate: (ctx, box) => frame(ctx, 46, "#C9B79C", 3, box),
  },
  {
    id: "botanical", name: "Botanical Green", dark: false, icon: "camera",
    palette: { background: "#F6F4EE", ink: "#2F4A3A", accent: "#4E7A5A", muted: "#5D6B61", rule: "#8FAA92" },
    decorate: (ctx, box) => {
      sprig(ctx, -20, 110, 230, 0.95, ["#7C9B83", "#A9C2AE", "#5F806A"]);
      sprig(ctx, -30, 30, 200, 0.35, ["#A9C2AE", "#7C9B83"]);
      sprig(ctx, box.W + 20, box.H - 120, 280, Math.PI + 0.9, ["#7C9B83", "#A9C2AE", "#5F806A"]);
      sprig(ctx, box.W - 90, box.H + 30, 240, -Math.PI / 2 - 0.25, ["#A9C2AE", "#7C9B83"]);
      flower(ctx, 70, 90, 22, "#FFFFFF", "#E7D7A8"); flower(ctx, box.W - 100, box.H - 210, 26, "#FFFFFF", "#E7D7A8");
    },
  },
  {
    id: "black-gold", name: "Black & Gold", dark: true, icon: "camera",
    palette: { background: "#0D0D0D", ink: "#F3EEE2", accent: "#D4AF6A", muted: "#CFC7B5", rule: "#B8924B", heading: "#D9B56E" },
    decorate: (ctx, box) => { frame(ctx, 40, "#B8924B", 3, box); frame(ctx, 58, "#B8924B", 1.5, box); },
  },
  {
    id: "geometric", name: "Soft Geometric", dark: false, icon: "face",
    palette: { background: "#FBFAF7", ink: "#1F2328", accent: "#5E8576", muted: "#5B5B5B", rule: "#9DB3A9" },
    decorate: (ctx, box) => {
      ctx.fillStyle = "#F2DCC8"; ctx.beginPath(); ctx.ellipse(box.W - 60, 90, 330, 240, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#C9D9CF"; ctx.beginPath(); ctx.ellipse(-40, 300, 190, 260, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#E9C9AE"; ctx.beginPath(); ctx.ellipse(-60, box.H - 50, 250, 170, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#B9CEC2"; ctx.beginPath(); ctx.arc(box.W + 10, box.H - 620, 170, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#1F2328"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(box.W - 250, box.H - 30); ctx.quadraticCurveTo(box.W - 90, box.H - 110, box.W - 10, box.H - 270); ctx.stroke();
    },
  },
  {
    id: "modern", name: "Modern Type", dark: false, icon: "camera", headingWeight: 800, headingScale: 1.05,
    palette: { background: "#EFEFEF", ink: "#111111", accent: "#111111", muted: "#3A3A3A", rule: "#8A8A8A" },
    decorate: (ctx, box) => {
      linear(ctx, box, [[0, "#FAFAFA"], [0.6, "#E6E6E6"], [1, "#BDBDBD"]]);
      ctx.save(); ctx.globalAlpha = 0.9;
      for (let i = 0; i < 6; i += 1) { ctx.strokeStyle = i % 2 ? "#2A2A2A" : "#4A4A4A"; ctx.lineWidth = 18 - i * 2; ctx.beginPath(); ctx.arc(box.W + 40, box.H + 40, 200 - i * 28, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    },
  },
  {
    id: "blush", name: "Blush Floral", dark: false, icon: "camera",
    palette: { background: "#FBEFEF", ink: "#7A2E3E", accent: "#B4566B", muted: "#6E5459", rule: "#D9A5A5" },
    decorate: (ctx, box) => {
      frame(ctx, 46, "#D9A5A5", 3, box);
      sprig(ctx, -10, 40, 300, 0.7, ["#B9CFB4", "#9DB99A"]);
      flower(ctx, 90, 90, 64, "#F2B8C0", "#E7C27A"); flower(ctx, 210, 50, 44, "#F7CBD1", "#E7C27A"); flower(ctx, 60, 230, 38, "#F7CBD1", "#E7C27A");
      sprig(ctx, box.W + 10, box.H - 40, 220, Math.PI + 0.75, ["#B9CFB4", "#9DB99A"]);
      flower(ctx, box.W - 90, box.H - 100, 66, "#F2B8C0", "#E7C27A"); flower(ctx, box.W - 220, box.H - 60, 42, "#F7CBD1", "#E7C27A");
    },
  },
  {
    id: "navy", name: "Navy & Cyan", dark: true, icon: "face",
    palette: { background: "#0B1D38", ink: "#FFFFFF", accent: "#3FD0E8", muted: "#C7D4E6", rule: "#3FD0E8" },
    decorate: (ctx, box) => {
      linear(ctx, box, [[0, "#0D2244"], [1, "#081631"]]);
      waves(ctx, box, "#5B6CFF", 40, 14, 60);
      waves(ctx, box, "#3FD0E8", box.H - 260, 12, 70);
    },
  },
  {
    id: "editorial", name: "Warm Editorial", dark: false, icon: "camera",
    palette: { background: "#EFE6DA", ink: "#3B3127", accent: "#8C7A66", muted: "#5E5246", rule: "#A8957F" },
    decorate: (ctx, box) => {
      glow(ctx, 120, 120, 420, "rgba(190,160,120,0.35)");
      ctx.save(); ctx.translate(box.W - 250, box.H - 50); ctx.rotate(-0.38);
      ctx.fillStyle = "#4A4038"; ctx.fillRect(0, 0, 500, 110);
      ctx.fillStyle = "#EFE6DA"; for (let x = 16; x < 500; x += 40) { ctx.fillRect(x, 10, 19, 14); ctx.fillRect(x, 86, 19, 14); }
      ctx.fillStyle = "#7A6B5D"; for (let x = 20; x < 500; x += 128) ctx.fillRect(x, 32, 102, 46);
      ctx.restore();
    },
  },
  {
    id: "sage", name: "Sage Minimal", dark: false, icon: "face",
    palette: { background: "#F2F6EC", ink: "#2F4A2A", accent: "#4F7A45", muted: "#56654F", rule: "#9DB58A" },
    decorate: (ctx, box) => {
      frame(ctx, 46, "#9DB58A", 3, box);
      sprig(ctx, box.W + 30, 30, 300, Math.PI - 0.95, ["#6E9B60", "#8FB57F", "#557F49"]);
      sprig(ctx, -20, box.H - 50, 250, -0.6, ["#6E9B60", "#8FB57F", "#557F49"]);
    },
  },
  {
    id: "midnight", name: "Midnight Glow", dark: true, icon: "face", headingSplit: true,
    palette: { background: "#05070F", ink: "#FFFFFF", accent: "#38BDF8", muted: "#CBD5E1", rule: "#38BDF8" },
    decorate: (ctx, box) => {
      glow(ctx, box.W, 0, 700, "rgba(59,130,246,0.40)");
      glow(ctx, 0, box.H, 760, "rgba(124,58,237,0.38)");
      ctx.save(); ctx.lineWidth = 3;
      for (let i = 0; i < 5; i += 1) { ctx.strokeStyle = `rgba(56,189,248,${0.55 - i * 0.09})`; ctx.beginPath(); ctx.ellipse(box.W / 2, box.H + 380 - i * 22, 1100 - i * 40, 640, 0, Math.PI, Math.PI * 2); ctx.stroke(); }
      for (let i = 0; i < 4; i += 1) { ctx.strokeStyle = `rgba(139,92,246,${0.5 - i * 0.1})`; ctx.beginPath(); ctx.ellipse(box.W / 2, -360 + i * 20, 1000 - i * 40, 560, 0, 0, Math.PI); ctx.stroke(); }
      ctx.restore();
    },
  },
]);

export const templateById = (id) => QR_TEMPLATES.find((template) => template.id === id) || QR_TEMPLATES[0];

// ── Content ────────────────────────────────────────────────────────────────────────────────
const clean = (value, limit) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

/**
 * The words a poster carries: the defaults, then what the studio typed, each trimmed to its
 * limit. The event name line starts as the event's own name; a line emptied is left off the
 * poster, never drawn as a blank. The PIN is printed only when the link has one and it is wanted.
 */
export function posterText(kit, edits = {}) {
  const out = {};
  for (const { key } of TEXT_FIELDS) {
    const typed = edits[key];
    const fallback = key === "footer" ? kit?.event?.name || "" : DEFAULT_TEXT[key];
    out[key] = clean(typed === undefined ? fallback : typed, TEXT_LIMITS[key]);
  }
  out.pin = kit?.pin && edits.showPin !== false ? String(kit.pin) : "";
  out.link = String(kit?.url || "").replace(/^https?:\/\//i, "");
  return out;
}

/** The server's grid as a lookup: `dark(x, y)` for 0 ≤ x, y < size. */
export function qrMatrix(qr) {
  const size = Number(qr?.size) || 0;
  const bits = String(qr?.modules || "");
  if (!size || bits.length !== size * size || /[^01]/.test(bits)) throw new Error("The QR code for this link is not available.");
  return { size, dark: (x, y) => bits.charCodeAt(y * size + x) === 49 };
}

/** `wedding-shoot-qr-poster-ivory.png` - lower-case, dashes, nothing a file system refuses. */
export function posterFileName(eventName, templateId, extension) {
  const slug = (value) => String(value || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const name = slug(eventName).slice(0, 60).replace(/-+$/g, "") || "event";
  return `${name}-qr-poster-${slug(templateId) || "design"}.${extension === "pdf" ? "pdf" : "png"}`;
}

// ── Drawing ────────────────────────────────────────────────────────────────────────────────
function setFont(ctx, family, weight, size, tracking = 0) {
  ctx.font = `${weight} ${size}px ${family}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${tracking}px`;
}
/** Lines of `text` no wider than `max`, at most `limit` of them (the last one shortened). */
function wrap(ctx, text, max, limit) {
  const words = String(text).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length > limit) { const kept = lines.slice(0, limit); kept[limit - 1] = `${kept[limit - 1]}…`; return kept; }
  return lines;
}
/** The largest size up to `size` at which `text` fits `max` in `limit` lines; never below 60%. */
function fit(ctx, family, weight, size, tracking, text, max, limit) {
  let current = size;
  for (;;) {
    setFont(ctx, family, weight, current, tracking);
    const lines = wrap(ctx, text, max, 99);
    if ((lines.length <= limit && lines.every((line) => ctx.measureText(line).width <= max)) || current <= size * 0.6) return { size: current, lines: wrap(ctx, text, max, limit) };
    current -= 2;
  }
}
function centred(ctx, text, x, y) { ctx.textAlign = "center"; ctx.fillText(text, x, y); }
function drawIcon(ctx, name, cx, cy, size, color) {
  if (typeof Path2D === "undefined") return;
  ctx.save(); ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color; ctx.fill(new Path2D(ICON_PATHS[name])); ctx.restore();
}
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/** An image fitted into a box, centred, never stretched. Returns false when there is nothing to draw. */
function drawContained(ctx, image, x, y, w, h) {
  const iw = image?.naturalWidth || image?.width; const ih = image?.naturalHeight || image?.height;
  if (!iw || !ih) return false;
  const ratio = Math.min(w / iw, h / ih);
  ctx.drawImage(image, x + (w - iw * ratio) / 2, y + (h - ih * ratio) / 2, iw * ratio, ih * ratio);
  return true;
}

/** The quiet zone the QR standard asks for, in modules, on every side. */
export const QR_QUIET_MODULES = 4;
/**
 * At print size a module is this many device pixels or more and is kept to a whole number of them;
 * smaller (the previews) it keeps its exact fraction, edges snapped to pixels, so a preview fills
 * its card exactly as the print does instead of losing a pixel of every module to rounding.
 */
const WHOLE_PIXEL_MODULE = 30;

/**
 * Where the code sits on its card, in device pixels. The white card IS the quiet zone: the grid
 * plus its four modules of white on every side is fitted to the card's whole width, centred, so
 * the code fills the card (over 80% of it is modules for any link) and nothing is white twice.
 * Print sizes keep every module a whole number of device pixels - the rounding left over is
 * split evenly to both sides - while a small preview, where a module is only a few pixels, uses
 * the exact fraction so it fills its card the same way the print does.
 */
export function qrLayout(matrixSize, card, scale) {
  const span = matrixSize + QR_QUIET_MODULES * 2;
  const cardPx = card.size * scale;
  const exact = cardPx / span;
  const cell = exact >= WHOLE_PIXEL_MODULE ? Math.floor(exact) : exact;
  const total = cell * span;
  const left = card.x * scale + (cardPx - total) / 2;
  const top = card.y * scale + (cardPx - total) / 2;
  const whole = cell === Math.floor(cell);
  return { span, cell, total, left: whole ? Math.round(left) : left, top: whole ? Math.round(top) : top, whole };
}

/**
 * The QR on its white card, drawn in device pixels (`qrLayout`). A whole-pixel cell is a
 * whole-pixel square; a fractional one has its edges snapped to the pixel grid, so neighbouring
 * modules meet with no seam and none blurs. The studio's mark sits in the centre on a white
 * square no wider than a fifth of the code, which High error correction reads straight through.
 */
function drawQr(ctx, matrix, card, scale, centreLogo) {
  const { cell, left, top } = qrLayout(matrix.size, card, scale);
  const edge = (index, origin) => Math.round(origin + (index + QR_QUIET_MODULES) * cell);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  for (let row = 0; row < matrix.size; row += 1) {
    const y0 = edge(row, top); const y1 = edge(row + 1, top);
    for (let column = 0; column < matrix.size; column += 1) {
      if (!matrix.dark(column, row)) continue;
      const x0 = edge(column, left);
      ctx.rect(x0, y0, edge(column + 1, left) - x0, y1 - y0);
    }
  }
  ctx.fill();
  if (centreLogo) {
    const modules = Math.max(5, Math.floor(matrix.size * 0.2) | 1);
    const first = (matrix.size - modules) / 2;
    const bx = edge(first, left); const by = edge(first, top);
    const box = edge(first + modules, left) - bx;
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(bx, by, box, box);
    const pad = Math.round(box * 0.1);
    drawContained(ctx, centreLogo, bx + pad, by + pad, box - pad * 2, box - pad * 2);
  }
  ctx.restore();
}

/**
 * Draws one poster on `ctx`, whose canvas is `POSTER_SIZE × scale` pixels.
 * `assets` is `{ matrix, logos: { onLight, onDark } (images or null), fontFamily, studioName }`.
 */
export function drawPoster(ctx, template, text, assets, scale = 1) {
  const W = POSTER_SIZE.width; const H = POSTER_SIZE.height; const box = { W, H };
  const p = template.palette;
  const family = assets.fontFamily || "Montserrat, Arial, sans-serif";
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = p.background; ctx.fillRect(0, 0, W, H);
  template.decorate?.(ctx, box);
  ctx.textBaseline = "alphabetic";
  const cx = W / 2;

  // The studio's mark, or its name when there is no mark to draw.
  const logo = template.dark ? assets.logos?.onDark : assets.logos?.onLight;
  ctx.save();
  const drewLogo = drawContained(ctx, logo, cx - 250, 96, 500, 150);
  ctx.restore();
  if (!drewLogo && assets.studioName) { ctx.fillStyle = p.ink; setFont(ctx, family, 600, 50, 2); centred(ctx, clean(assets.studioName, 40), cx, 190); }

  let y = 340;
  if (text.heading) {
    const weight = template.headingWeight || 500;
    const fitted = fit(ctx, family, weight, Math.round(74 * (template.headingScale || 1)), 3, text.heading, W - 200, 2);
    fitted.lines.forEach((line, index) => {
      const lineY = y + index * fitted.size * 1.08;
      if (template.headingSplit && index === 0 && line.includes(" ")) {
        // "GET" in the ink, the rest of the line in the accent - the Midnight design's two-tone title.
        const [first, ...rest] = line.split(" ");
        const restText = ` ${rest.join(" ")}`;
        const firstWidth = ctx.measureText(first).width; const restWidth = ctx.measureText(restText).width;
        const start = cx - (firstWidth + restWidth) / 2;
        ctx.textAlign = "left"; ctx.fillStyle = p.ink; ctx.fillText(first, start, lineY);
        ctx.fillStyle = p.accent; ctx.fillText(restText, start + firstWidth, lineY);
      } else { ctx.fillStyle = p.heading || p.ink; centred(ctx, line, cx, lineY); }
    });
    y += (fitted.lines.length - 1) * fitted.size * 1.08;
  }
  if (text.subheading) {
    y += 72;
    const fitted = fit(ctx, family, 500, 31, 7, text.subheading, W - 400, 1);
    const width = ctx.measureText(fitted.lines[0]).width;
    ctx.fillStyle = p.accent === p.ink ? p.muted : p.accent; centred(ctx, fitted.lines[0], cx, y);
    ctx.strokeStyle = p.rule; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - width / 2 - 90, y - 10); ctx.lineTo(cx - width / 2 - 24, y - 10);
    ctx.moveTo(cx + width / 2 + 24, y - 10); ctx.lineTo(cx + width / 2 + 90, y - 10); ctx.stroke();
  }

  // The code: a white card, the same on every design, so it reads the same under any light. The
  // card is the quiet zone - the code is fitted to the card itself (`qrLayout`), not inset in it.
  const card = { size: 620, x: cx - 310, y: Math.max(y + 56, 470) };
  ctx.save();
  ctx.shadowColor = template.dark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.12)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
  ctx.fillStyle = "#FFFFFF"; roundedRect(ctx, card.x, card.y, card.size, card.size, 20); ctx.fill();
  ctx.restore();
  drawQr(ctx, assets.matrix, card, scale, assets.logos?.onLight || null);
  y = card.y + card.size;

  y += 84;
  drawIcon(ctx, template.icon || "camera", cx, y, 70, p.accent);
  y += 96;
  if (text.instruction) {
    const fitted = fit(ctx, family, 500, 46, 4, text.instruction, W - 200, 1);
    ctx.fillStyle = template.dark ? p.accent : p.ink; centred(ctx, fitted.lines[0], cx, y);
  }
  if (text.note) {
    const fitted = fit(ctx, family, 500, 26, 2.5, text.note, 800, 2);
    ctx.fillStyle = p.muted;
    fitted.lines.forEach((line, index) => centred(ctx, line, cx, y + 60 + index * fitted.size * 1.45));
    y += 60 + (fitted.lines.length - 1) * fitted.size * 1.45;
  }
  if (text.pin) {
    y += 92;
    setFont(ctx, family, 700, 36, 5);
    const label = `PIN  ${text.pin}`;
    const width = ctx.measureText(label).width + 70;
    ctx.strokeStyle = p.rule; ctx.lineWidth = 2.5; roundedRect(ctx, cx - width / 2, y - 48, width, 70, 35); ctx.stroke();
    ctx.fillStyle = p.ink; centred(ctx, label, cx, y);
  }

  // The event, and the link written out for anyone whose camera will not read the code - kept
  // below whatever the words above came to, however long the studio made them.
  const footerY = Math.min(H - 170, Math.max(H - 230, y + 130));
  if (text.footer) {
    const fitted = fit(ctx, family, 600, 34, 6, text.footer.toUpperCase(), W - 420, 2);
    ctx.fillStyle = p.ink;
    const first = footerY - (fitted.lines.length - 1) * fitted.size * 1.25;
    fitted.lines.forEach((line, index) => centred(ctx, line, cx, first + index * fitted.size * 1.25));
    ctx.strokeStyle = p.rule; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 56, footerY + 38); ctx.lineTo(cx + 56, footerY + 38); ctx.stroke();
  }
  if (text.link) {
    const fitted = fit(ctx, family, 500, 22, 1, text.link, W - 420, 1);
    ctx.fillStyle = p.muted; centred(ctx, fitted.lines[0], cx, footerY + 80);
  }
  ctx.restore();
}

// ── Browser helpers (both clients run in a web view) ───────────────────────────────────────
/** Resolves to the loaded image, or null - a logo that fails is a fallback, never an error. */
export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src || typeof Image === "undefined") { resolve(null); return; }
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image.naturalWidth ? image : null);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/**
 * The marks a poster draws, by the app's own rule: the studio's Global Logo for the background
 * (the light one on a light design, the dark one on a dark design, each borrowing the other when
 * only one was uploaded), else the bundled fallback mark for that background.
 */
export async function resolvePosterLogos(kit, fallbacks = FALLBACK_MARKS) {
  const light = kit?.logos?.light || null; const dark = kit?.logos?.dark || null;
  const [ownLight, ownDark] = await Promise.all([loadImage(light || dark), loadImage(dark || light)]);
  const [fallbackLight, fallbackDark] = await Promise.all([ownLight ? null : loadImage(fallbacks.onLight), ownDark ? null : loadImage(fallbacks.onDark)]);
  return { onLight: ownLight || fallbackLight, onDark: ownDark || fallbackDark, own: Boolean(ownLight || ownDark) };
}

/** Waits for the weights the poster uses, so the first draw is not in a fallback face. */
export async function ensurePosterFonts(fontFamily) {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  await Promise.all([400, 500, 600, 700, 800].map((weight) => document.fonts.load(`${weight} 40px ${fontFamily}`).catch(() => null)));
}

/** The page's own font stack, so the poster is set in the Montserrat the app has loaded. */
export function pageFontFamily() {
  if (typeof document === "undefined") return "Montserrat, Arial, sans-serif";
  return getComputedStyle(document.body).fontFamily || "Montserrat, Arial, sans-serif";
}

/** One poster on a fresh canvas at `scale`. */
export function renderPoster(template, text, assets, scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(POSTER_SIZE.width * scale);
  canvas.height = Math.round(POSTER_SIZE.height * scale);
  const ctx = canvas.getContext("2d");
  // A canvas the device could not allocate answers no context: say so, so the export can step
  // down to a smaller resolution rather than hand over an empty page.
  if (!ctx) throw new Error("This device could not draw a poster that large.");
  drawPoster(ctx, template, text, assets, scale);
  return canvas;
}

const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The poster could not be drawn."))), type, quality));

/**
 * The finished A1 poster as `{ blob, fileName, dpi }`: a PNG, or a one-page A1 PDF holding it.
 * Drawn straight at print resolution - never a preview enlarged. 300 dpi is a 7016 × 9933 canvas
 * (about 280 MB while it is drawn); a device that cannot allocate one gets the same page at
 * 150 dpi instead, and `dpi` says which. The canvas is released as soon as the file is made.
 */
export async function exportPoster(template, text, assets, { format = "png", eventName } = {}) {
  const fileName = posterFileName(eventName, template.id, format);
  let lastError = null;
  for (const dpi of [EXPORT_DPI, FALLBACK_DPI]) {
    let canvas = null;
    try {
      canvas = renderPoster(template, text, assets, scaleForDpi(dpi));
      if (format !== "pdf") return { blob: await toBlob(canvas, "image/png"), fileName, dpi };
      const jpeg = new Uint8Array(await (await toBlob(canvas, "image/jpeg", 0.92)).arrayBuffer());
      return { blob: new Blob([pdfFromJpeg(jpeg, canvas.width, canvas.height)], { type: "application/pdf" }), fileName, dpi };
    } catch (error) {
      lastError = error;
    } finally {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
  }
  throw lastError || new Error("The poster could not be drawn.");
}

/**
 * A one-page PDF of one JPEG on an A1 portrait page (`points`) - written by hand because it is
 * six objects and a cross-reference table; no library is needed for that. The image is embedded
 * as it is (DCTDecode) and fills the page edge to edge: no margin, no rescaling, one page.
 */
export function pdfFromJpeg(jpeg, pixelWidth, pixelHeight, points = PAGE_POINTS) {
  const encoder = new TextEncoder();
  const width = points.width; const height = points.height;
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => { const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk; parts.push(bytes); length += bytes.length; };
  const object = (number, body) => { offsets[number] = length; push(`${number} 0 obj\n${body}\nendobj\n`); };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push("\nendstream\nendobj\n");
  object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
