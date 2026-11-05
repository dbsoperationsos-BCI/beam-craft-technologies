/**
 * Photo Selling's pure helpers, shared by the staff screens and the guest store, and tested on their
 * own. Nothing here prices anything: every total the screens show comes from the server
 * (`backend/src/modules/photo-selling/pricing/pricing.js`); this only formats and parses amounts and
 * keeps the guest's cart and sessions in the browser.
 */

/** Paise as the studio reads money: 150000 → "₹1,500", 12345 → "₹123.45". */
export function formatMoney(paise, currency = "INR") {
  const value = Number(paise);
  if (!Number.isFinite(value)) return "—";
  const rupees = value / 100;
  const whole = Number.isInteger(rupees);
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(rupees);
  } catch {
    return `₹${rupees.toFixed(whole ? 0 : 2)}`;
  }
}

/** What a staff member typed as rupees ("1,500", "99.5") → paise, or null when it is not an amount. */
export function rupeesToPaise(input) {
  const text = String(input ?? "").replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Paise back to the text a price field shows: 150000 → "1500", 9950 → "99.50". */
export function paiseToRupeesText(paise) {
  if (paise == null || !Number.isFinite(Number(paise))) return "";
  const value = Number(paise);
  return value % 100 === 0 ? String(value / 100) : (value / 100).toFixed(2);
}

/** A date as `YYYY-MM-DD` in the viewer's own day (not UTC), for date fields and "today" checks. */
export function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Basis points as a percent field shows them, and back: 1800 ↔ "18". */
export const bpsToPercentText = (bps) => (bps ? String(Number(bps) / 100) : "0");
export function percentToBps(input) {
  const text = String(input ?? "").trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

export const ORDER_STATUS_LABELS = Object.freeze({ PENDING: "Awaiting payment", PAID: "Paid", FAILED: "Payment failed", CANCELLED: "Cancelled" });
export const ORDER_STATUS_TONES = Object.freeze({ PENDING: "amber", PAID: "green", FAILED: "red", CANCELLED: "slate" });
// AWAITING_STUDIO and DELIVERED are only on orders made while originals were delivered by hand.
export const FULFILMENT_LABELS = Object.freeze({ PENDING_PAYMENT: "Awaiting payment", READY: "Ready to download", AWAITING_STUDIO: "Being prepared by the studio", DELIVERED: "Delivered", UNAVAILABLE: "Unavailable" });
export const PAYMENT_STATUS_LABELS = Object.freeze({ CREATED: "Checkout opened", PENDING: "Being confirmed", SUCCESS: "Succeeded", FAILED: "Failed", CANCELLED: "Cancelled", EXPIRED: "Expired", MISMATCH: "Amount mismatch" });
// What a buyer gets is the photo's original; DIGITAL (a web-size copy) is only on earlier orders.
export const KIND_LABELS = Object.freeze({ ORIGINAL: "Original photo", DIGITAL: "Web-size copy" });

/** What a store's state means to the studio, for its status chip. */
export function galleryStatus(gallery) {
  if (!gallery) return { label: "", tone: "slate" };
  if (gallery.archivedAt) return { label: "Archived", tone: "slate" };
  if (gallery.live) return { label: "Live", tone: "green" };
  if (gallery.status === "PUBLISHED") return { label: gallery.liveReason || "Not live", tone: "amber" };
  if (gallery.status === "UNPUBLISHED") return { label: "Unpublished", tone: "slate" };
  return { label: "Draft", tone: "blue" };
}

/* --------------------------------------------------------------- guest store */

const CART_PREFIX = "dbs_photo_store_cart_";
const SESSION_PREFIX = "dbs_photo_store_session_";
const ORDERS_PREFIX = "dbs_photo_store_orders_";
const MAX_CART = 200;

function storage() {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}
function readJson(key, fallback) {
  try { const raw = storage()?.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function writeJson(key, value) {
  try { storage()?.setItem(key, JSON.stringify(value)); } catch { /* private window: the cart lasts this visit only */ }
}
const codeKey = (code) => String(code || "").toUpperCase();

/** A cart line is `{ photoId }` - one thing is sold, the photo's original - so a photo is in a cart once. */
export const cartKey = (line) => String(line?.photoId ?? "");
export function normalizeCart(lines) {
  const seen = new Set();
  const out = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!line || typeof line.photoId !== "string" || !line.photoId) continue;
    const key = cartKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    // The watermarked tile's address travels with the line so the cart can show what is in it; it
    // is never what decides a price or a purchase.
    out.push({ photoId: line.photoId, ...(typeof line.thumbnailUrl === "string" ? { thumbnailUrl: line.thumbnailUrl } : {}) });
    if (out.length >= MAX_CART) break;
  }
  return out;
}
export function toggleInCart(lines, line) {
  const key = cartKey(line);
  return lines.some((item) => cartKey(item) === key) ? lines.filter((item) => cartKey(item) !== key) : normalizeCart([...lines, line]);
}
export const loadCart = (code) => normalizeCart(readJson(`${CART_PREFIX}${codeKey(code)}`, []));
export const saveCart = (code, lines) => writeJson(`${CART_PREFIX}${codeKey(code)}`, normalizeCart(lines));

export const loadStoreSession = (code) => { const value = readJson(`${SESSION_PREFIX}${codeKey(code)}`, null); return typeof value === "string" ? value : null; };
export const saveStoreSession = (code, session) => writeJson(`${SESSION_PREFIX}${codeKey(code)}`, session);
export const clearStoreSession = (code) => { try { storage()?.removeItem(`${SESSION_PREFIX}${codeKey(code)}`); } catch { /* nothing kept */ } };

/** Order keys this browser holds, by reference - what opens an order without the session. */
export const loadOrderKeys = (code) => { const value = readJson(`${ORDERS_PREFIX}${codeKey(code)}`, {}); return value && typeof value === "object" ? value : {}; };
export function saveOrderKey(code, orderRef, key) {
  if (!orderRef || !key) return;
  const all = loadOrderKeys(code);
  all[String(orderRef).toUpperCase()] = key;
  writeJson(`${ORDERS_PREFIX}${codeKey(code)}`, all);
}

/** The order key a re-issued link carries in its fragment (`#k=...`), which never reaches a server log. */
export function orderKeyFromHash(hash) {
  const match = /(?:^#|&)k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(String(hash || ""));
  return match ? match[1] : null;
}

/** Whether a phone number is a 10-digit Indian mobile the way the server will accept it. */
export function isIndianMobile(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits);
}
