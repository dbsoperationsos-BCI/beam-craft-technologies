const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../../../config/db");
const { storeImage, discardUploads } = require("../../../services/imageStorage");
const { storeArtwork, discardArtwork } = require("./artwork");
const { uploadObject, deleteObject } = require("../../../services/objectStorage");
const { isConfigured } = require("../../../config/r2");
const { frontendOrigin } = require("../../../services/quotationPdfService");
const referrals = require("../portal/referrals");
const { clientOwnName } = require("../../accounts/cash-entries/receipt");
const iamService = require("../../../services/iam.service");
const { TYPES } = require("../../../services/notifications");
const clientPush = require("../../../services/clientPush");
const { STYLES, STYLE_KEYS, FONTS, FONT_KEYS } = require("./styles");

/*
 * Invitation Cards (Client Management -> Invitation Cards).
 *
 * The studio adds **designs** - its artwork, the shoot names it is for (Settings -> Fields -> Shoot
 * Types) and the animated theme it plays in (`./styles.js`) - and **songs**, each for some shoots or
 * all of them. A client picks one of their shoots in the app, then a design for it, writes their
 * invitation (names, date, venue, events - filled in from their booking to start with), sets a song,
 * and shares the link: guests open `/inv/<token>`, which plays the design with ten seconds of the song
 * from the second the client chose, on a loop.
 *
 * A design or song the studio removes is withdrawn from the list, not erased: an invitation already
 * made from it keeps playing as it was shared.
 */

// How much of the song an invitation plays, from `songStart`, on a loop.
const SONG_SECONDS = 10;
// A whole song is uploaded and ten seconds of it chosen by the client, so room for a long one.
const MAX_SONG_BYTES = 8 * 1024 * 1024;
const MAX_SONG_START = 600;
// The audio a song may be, and its first bytes: an MP3 (an ID3 tag, or straight into a frame) or an
// M4A / AAC (an `ftyp` box). What the bucket is told the file is comes from this list, never the name.
const AUDIO_TYPES = {
  "audio/mpeg": { extension: "mp3", matches: (b) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  "audio/mp4": { extension: "m4a", matches: (b) => b.slice(4, 8).toString("latin1") === "ftyp" },
};
const AUDIO_ALIASES = { "audio/mp3": "audio/mpeg", "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4", "audio/aac": "audio/mp4" };
const PHOTO_MAX_DIMENSION = 1600;
const PHOTO_MAX_BYTES = 450 * 1024;
const MAX_EVENTS = 8;
const MAX_FAMILIES = 3;
const MAX_GALLERY = 8;
// A priced design's invitation: how many saves are free before sharing and further edits wait on
// payment, and how long a link that shows it unpaid (the client's own Preview, a download) lasts.
const FREE_EDITS = 2;
// What the studio charges for a design, in rupees - its own price within this, set on the design.
const PRICE_MIN = 100;
const PRICE_MAX = 200;
const PREVIEW_SECONDS = 3 * 60 * 60;

const fail = (status, message) => Object.assign(new Error(message), { status });
const norm = (value) => String(value || "").trim().toLowerCase();
const isHttpUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value.trim());
const dayOf = (value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : null);
const asList = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : []);
// A "Haldi + Mehandi" shoot is one shoot named for both; an invitation may be for either.
const shootNamesOf = (shoot) => String(shoot || "").split("+").map((name) => name.trim()).filter(Boolean);
const forShoot = (shootTypes, shoot) => asList(shootTypes).some((name) => norm(name) === norm(shoot));
// A song for no shoot in particular is for every shoot.
const songForShoot = (shootTypes, shoot) => !asList(shootTypes).length || forShoot(shootTypes, shoot);

// ── What the team writes ──

const shootTypesSchema = z.array(z.string().trim().min(1).max(120)).max(60);
const templateSchema = z.object({
  title: z.string().trim().min(1, "Give the design a name.").max(120),
  shootTypes: shootTypesSchema.min(1, "Choose at least one shoot this design is for."),
  style: z.enum(STYLE_KEYS, { message: "Choose how the invitation moves." }),
  accent: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour.").or(z.literal("")).optional().default(""),
  // Rupees, whole, within the studio's range; free only when marked free.
  price: z.coerce.number().int("Enter the price in whole rupees.").min(0, "The price cannot be negative.").max(100000).optional().default(0),
  isFree: z.boolean().optional().default(false),
  font: z.enum(FONT_KEYS).optional().default("script"),
  ink: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour.").or(z.literal("")).optional().default(""),
  // The see-through pieces along the top and the bottom, as the artwork is: a data URI, the URL it
  // has, or "" for none.
  top: z.string().optional(),
  bottom: z.string().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(0),
  isActive: z.boolean().optional().default(true),
  // A new picture as a data URI, the one it already has (its URL), or "" to take it off.
  cover: z.string().optional(),
}).refine((design) => design.isFree || (design.price >= PRICE_MIN && design.price <= PRICE_MAX), {
  message: `Enter a price between Rs ${PRICE_MIN} and Rs ${PRICE_MAX}, or mark the design free.`,
  path: ["price"],
});
const songSchema = z.object({
  title: z.string().trim().min(1, "Give the song a name.").max(120),
  artist: z.string().trim().max(120).optional().default(""),
  // None is every shoot.
  shootTypes: shootTypesSchema.optional().default([]),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(0),
  isActive: z.boolean().optional().default(true),
  // A new file as a data URI, or the one it already has (its URL).
  audio: z.string().optional(),
});

function serializeTemplate(row, uses = 0) {
  return {
    id: row.id,
    title: row.title,
    shootTypes: asList(row.shootTypes),
    style: STYLE_KEYS.includes(row.style) ? row.style : "royal",
    accent: row.accent || "",
    price: Number(row.price) || 0,
    isFree: Boolean(row.isFree),
    font: FONT_KEYS.includes(row.font) ? row.font : "script",
    ink: row.ink || "",
    coverUrl: row.coverUrl || null,
    coverType: row.coverType === "video" ? "video" : "image",
    posterUrl: row.posterUrl || null,
    topUrl: row.topUrl || null,
    bottomUrl: row.bottomUrl || null,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    uses,
    updatedAt: row.updatedAt,
  };
}

function serializeSong(row, uses = 0) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist || "",
    audioUrl: row.audioUrl,
    shootTypes: asList(row.shootTypes),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    uses,
    updatedAt: row.updatedAt,
  };
}

/** How many client invitations use each design or song: `{ [id]: count }`. */
async function usesBy(field) {
  const rows = await prisma.clientInvitation.groupBy({ by: [field], where: { deletedAt: null }, _count: { _all: true } });
  return Object.fromEntries(rows.filter((row) => row[field] != null).map((row) => [row[field], row._count._all]));
}

/** The studio's shoot names, by kind, for the team's picker: `[{ key, label, shoots }]`. */
async function shootGroups() {
  const choices = await referrals.shootChoices();
  return Object.entries(referrals.KINDS).map(([key, kind]) => ({ key, label: kind.short || kind.label, shoots: choices[key] || [] }));
}

async function teamOverview() {
  const [templates, songs, templateUses, songUses, groups] = await Promise.all([
    prisma.invitationTemplate.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] }),
    prisma.invitationSong.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] }),
    usesBy("templateId"),
    usesBy("songId"),
    shootGroups(),
  ]);
  return {
    templates: templates.map((row) => serializeTemplate(row, templateUses[row.id] || 0)),
    songs: songs.map((row) => serializeSong(row, songUses[row.id] || 0)),
    styles: STYLES,
    fonts: FONTS,
    priceRange: [PRICE_MIN, PRICE_MAX],
    shootGroups: groups,
    songSeconds: SONG_SECONDS,
  };
}

/**
 * One of the design's pictures to keep - `field` is "cover", "top" or "bottom": a new upload stored,
 * the existing one kept, or none. `{ [field]Url, [field]Key, stored }`, and for the cover (which may be
 * a video) its type and poster too.
 */
async function pictureFor(field, value, existing) {
  const url = `${field}Url`;
  const key = `${field}Key`;
  const cover = field === "cover";
  const kept = {
    [url]: existing?.[url] ?? null,
    [key]: existing?.[key] ?? null,
    ...(cover ? { coverType: existing?.coverType || "image", posterUrl: existing?.posterUrl ?? null, posterKey: existing?.posterKey ?? null } : {}),
    stored: null,
  };
  if (value === undefined) return kept;
  if (!value) return { [url]: null, [key]: null, ...(cover ? { coverType: "image", posterUrl: null, posterKey: null } : {}), stored: null };
  if (existing?.[url] && value === existing[url]) return kept;
  // A link the design already has is kept; anything new must be an upload of the artwork itself.
  if (isHttpUrl(value)) return kept;
  const stored = await storeArtwork(value, { video: cover });
  return {
    [url]: stored.url,
    [key]: stored.key,
    ...(cover ? { coverType: stored.type, posterUrl: stored.posterUrl, posterKey: stored.posterKey } : {}),
    stored,
  };
}

async function saveTemplate(input, actorId, id = null) {
  const existing = id ? await prisma.invitationTemplate.findFirst({ where: { id, deletedAt: null } }) : null;
  if (id && !existing) return null;
  const pictures = [];
  const keep = async (field, value) => {
    const picture = await pictureFor(field, value, existing);
    if (picture.stored) pictures.push(picture.stored);
    const { stored: _stored, ...columns } = picture;
    return columns;
  };
  let columns;
  try {
    columns = { ...(await keep("cover", input.cover)), ...(await keep("top", input.top)), ...(await keep("bottom", input.bottom)) };
  } catch (error) {
    if (pictures.length) await discardArtwork(pictures);
    throw error;
  }
  if (!columns.coverUrl) {
    if (pictures.length) await discardArtwork(pictures);
    throw fail(400, "Upload the design's artwork.");
  }
  const data = {
    title: input.title,
    shootTypes: [...new Set(input.shootTypes)],
    style: input.style,
    accent: input.accent || null,
    price: input.isFree ? 0 : input.price,
    isFree: input.isFree,
    font: input.font,
    ink: input.ink || null,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
    ...columns,
    updatedBy: actorId,
  };
  try {
    const row = existing
      ? await prisma.invitationTemplate.update({ where: { id }, data })
      : await prisma.invitationTemplate.create({ data: { ...data, createdBy: actorId } });
    return serializeTemplate(row);
  } catch (error) {
    if (pictures.length) await discardArtwork(pictures);
    throw error;
  }
}

async function removeTemplate(id, actorId) {
  const existing = await prisma.invitationTemplate.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return false;
  await prisma.invitationTemplate.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: actorId } });
  return true;
}

/** Stores an uploaded song in the studio's bucket: `{ url, key }`. The bytes must be the audio they claim. */
async function storeSong(dataUri) {
  const match = String(dataUri || "").match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) throw fail(400, "The song could not be read. Upload an MP3 or M4A file.");
  const mimeType = AUDIO_ALIASES[match[1]] || match[1];
  const type = AUDIO_TYPES[mimeType];
  if (!type) throw fail(400, "Upload the song as an MP3 or M4A file.");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) throw fail(400, "The song could not be read.");
  if (buffer.length > MAX_SONG_BYTES) throw fail(400, "The song must be 8 MB or smaller.");
  if (!type.matches(buffer)) throw fail(400, `This file is not really an ${type.extension.toUpperCase()} song.`);
  if (!isConfigured) throw fail(500, "File storage is not configured on this server.");
  return uploadObject(buffer, { folder: "client/invitations/songs", extension: type.extension, contentType: mimeType });
}

async function saveSong(input, actorId, id = null) {
  const existing = id ? await prisma.invitationSong.findFirst({ where: { id, deletedAt: null } }) : null;
  if (id && !existing) return null;
  let audio = { audioUrl: existing?.audioUrl ?? null, audioKey: existing?.audioKey ?? null };
  let stored = null;
  if (input.audio && input.audio !== existing?.audioUrl) {
    stored = await storeSong(input.audio);
    audio = { audioUrl: stored.url, audioKey: stored.key };
  }
  if (!audio.audioUrl) throw fail(400, "Upload the song.");
  const data = {
    title: input.title,
    artist: input.artist || null,
    shootTypes: [...new Set(input.shootTypes)],
    sortOrder: input.sortOrder,
    isActive: input.isActive,
    ...audio,
    updatedBy: actorId,
  };
  try {
    const row = existing
      ? await prisma.invitationSong.update({ where: { id }, data })
      : await prisma.invitationSong.create({ data: { ...data, createdBy: actorId } });
    return serializeSong(row);
  } catch (error) {
    if (stored) await deleteObject(stored.key).catch(() => {});
    throw error;
  }
}

async function removeSong(id, actorId) {
  const existing = await prisma.invitationSong.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return false;
  await prisma.invitationSong.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: actorId } });
  return true;
}

// ── What the client reads and writes ──

const LIVE = { deletedAt: null, isActive: true };
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.").or(z.literal("")).optional().default("");
const hhmm = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time.").or(z.literal("")).optional().default("");
const text = (max) => z.string().trim().max(max).optional().default("");
// A link a guest taps - a map, mostly - so it may only be a web address, never script.
const link = z.string().trim().max(500).refine((value) => !value || isHttpUrl(value), "Paste a web link (https://...).").optional().default("");
const eventSchema = z.object({ name: text(80), date: day, time: hhmm, venue: text(160), mapUrl: link });
// A photo on the invitation: a link to one already stored, or (being saved) a new one as a data URI.
const photoRef = z.string().max(12 * 1024 * 1024).refine((value) => isHttpUrl(value) || /^data:image\/(jpeg|png|webp|heic|heif);base64,/.test(value), "Choose the photo from your phone.");
const familySchema = z.object({ names: text(120), line: text(160), photos: z.array(photoRef).max(2).optional().default([]) });
const contentSchema = z.object({
  heading: text(120),
  names: text(120),
  message: text(500),
  date: day,
  time: hhmm,
  venue: text(160),
  address: text(300),
  mapUrl: link,
  hosts: text(200),
  rsvpPhone: z.string().trim().max(20).refine((value) => !value || value.replace(/\D/g, "").length >= 10, "Enter the number with its country code.").optional().default(""),
  events: z.array(eventSchema).max(MAX_EVENTS, `Up to ${MAX_EVENTS} events.`).optional().default([]),
  // The families' cards (the couple, each side's parents): names, a line, and two photos each.
  families: z.array(familySchema).max(MAX_FAMILIES, `Up to ${MAX_FAMILIES} family cards.`).optional().default([]),
  // A row of the couple's photos.
  gallery: z.array(photoRef).max(MAX_GALLERY, `Up to ${MAX_GALLERY} photos.`).optional().default([]),
});
const invitationSchema = z.object({
  content: contentSchema.optional(),
  songId: z.coerce.number().int().positive().nullable().optional(),
  songStart: z.coerce.number().int().min(0).max(MAX_SONG_START).optional(),
  // A new photo as a data URI, the one it already has (its URL), or "" to take it off.
  photo: z.string().optional(),
});

/** Which kind (wedding, baby, corporate) a shoot name is, by the studio's own lists. */
function kindOf(shoot, groups) {
  return groups.find((group) => group.shoots.some((name) => norm(name) === norm(shoot)))?.key || "other";
}

/** The client's shoots across their bookings, by name: `[{ name, projectId, shoot }]`. */
async function clientShoots(projectIds) {
  if (!projectIds.length) return [];
  const rows = await prisma.projectShoot.findMany({
    where: { projectId: { in: projectIds }, deletedAt: null, project: { deletedAt: null } },
    select: { id: true, projectId: true, shoot: true, dateCreated: true, eventStartTime: true, shootPlace: true, district: true, isMainEvent: true },
    orderBy: [{ dateCreated: "asc" }, { createdAt: "asc" }],
  });
  return rows.flatMap((shoot) => shootNamesOf(shoot.shoot).map((name) => ({ name, projectId: shoot.projectId, shoot })));
}

/**
 * What the client may do with an invitation: one from a design the studio marked free, everything;
 * any other, a few free edits, then sharing and further edits wait until the studio records it paid -
 * at the design's price, or (none set yet, `price: 0`) the price the studio tells them.
 */
function accessOf(row) {
  // The client's own terms when the studio set them (Payments -> Edit), else the design's and the usual.
  const price = Number(row.price ?? row.template?.price) || 0;
  const limit = row.editLimit ?? FREE_EDITS;
  // `INVITATION_PAYWALL=off` (a local .env, while testing) lets every invitation edit and share freely.
  const free = Boolean(row.template?.isFree) || process.env.INVITATION_PAYWALL === "off";
  const paid = free || Boolean(row.paidAt);
  const used = Number(row.editCount) || 0;
  return {
    price,
    free,
    paid,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    requestedAt: row.unlockRequestedAt ? row.unlockRequestedAt.toISOString() : null,
    // The studio's range, shown while a design saved before prices has none of its own.
    priceRange: [PRICE_MIN, PRICE_MAX],
    freeEdits: limit,
    freeEditsLeft: paid ? null : Math.max(0, limit - used),
    canEdit: paid || used < limit,
    canShare: paid,
  };
}

/*
 * A key that opens an invitation not yet paid for - the client's own Preview, and the pictures and
 * videos the server draws for Download - for a few hours: `<expires>.<signature>`. A guest with only
 * the link sees that it is not shared yet. Signed with the server's own secret, never stored.
 */
function previewKeyFor(token, now = Date.now()) {
  const expires = Math.floor(now / 1000) + PREVIEW_SECONDS;
  const signature = crypto.createHmac("sha256", String(process.env.JWT_SECRET || "")).update(`invitation-preview:${token}:${expires}`).digest("base64url").slice(0, 32);
  return `${expires}.${signature}`;
}

function previewKeyOpens(token, key, now = Date.now()) {
  const [expires, signature] = String(key || "").split(".");
  if (!/^\d{9,11}$/.test(expires || "") || !signature || Number(expires) * 1000 < now) return false;
  const expected = crypto.createHmac("sha256", String(process.env.JWT_SECRET || "")).update(`invitation-preview:${token}:${expires}`).digest("base64url").slice(0, 32);
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function serializeClientInvitation(row) {
  const access = accessOf(row);
  return {
    id: row.id,
    token: row.token,
    link: `${frontendOrigin()}/inv/${row.token}`,
    // The client's own way to see it before it is paid for: the link with a few hours' key.
    previewKey: access.paid ? null : previewKeyFor(row.token),
    access,
    shootName: row.shootName,
    design: row.template ? {
      id: row.template.id,
      title: row.template.title,
      style: STYLE_KEYS.includes(row.template.style) ? row.template.style : "royal",
      accent: row.template.accent || "",
      price: Number(row.template.price) || 0,
      isFree: Boolean(row.template.isFree),
      font: FONT_KEYS.includes(row.template.font) ? row.template.font : "script",
      ink: row.template.ink || "",
      coverUrl: row.template.coverUrl || null,
      coverType: row.template.coverType === "video" ? "video" : "image",
      posterUrl: row.template.posterUrl || null,
      topUrl: row.template.topUrl || null,
      bottomUrl: row.template.bottomUrl || null,
    } : null,
    content: contentSchema.parse(row.content || {}),
    photoUrl: row.photoUrl || null,
    songId: row.songId ?? null,
    songStart: row.songStart || 0,
    songSeconds: SONG_SECONDS,
    updatedAt: row.updatedAt,
  };
}

const INVITATION_INCLUDE = { template: { select: { id: true, title: true, style: true, accent: true, price: true, isFree: true, font: true, ink: true, coverUrl: true, coverType: true, posterUrl: true, topUrl: true, bottomUrl: true } } };

/**
 * What the client's Invitation Cards page shows: every shoot the studio has a design for - the
 * client's own booked shoots first - and the invitations they have made.
 */
async function clientOverview(projectIds) {
  const [templates, groups, mine, invitations] = await Promise.all([
    prisma.invitationTemplate.findMany({ where: LIVE, select: { shootTypes: true, coverUrl: true, coverType: true, posterUrl: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] }),
    shootGroups(),
    clientShoots(projectIds),
    projectIds.length
      ? prisma.clientInvitation.findMany({ where: { projectId: { in: projectIds }, deletedAt: null }, include: INVITATION_INCLUDE, orderBy: { updatedAt: "desc" } })
      : [],
  ]);
  const counts = new Map();
  for (const template of templates) {
    for (const name of new Set(asList(template.shootTypes).map((value) => value.trim()))) {
      const key = norm(name);
      // The shoot's first design is its picture in the client's list (a video's first frame).
      const still = template.coverType === "video" ? template.posterUrl : template.coverUrl;
      counts.set(key, { name: counts.get(key)?.name || name, designs: (counts.get(key)?.designs || 0) + 1, coverUrl: counts.get(key)?.coverUrl || still || null });
    }
  }
  const booked = new Set(mine.map((entry) => norm(entry.name)));
  // The studio's own order of shoot names, kind by kind, so the list reads as Settings does.
  const order = groups.flatMap((group) => group.shoots.map(norm));
  const rank = (name) => (order.indexOf(norm(name)) + 1) || order.length + 1;
  const kinds = Object.fromEntries(groups.map((group) => [group.key, group.label]));
  const shoots = [...counts.values()]
    .map((entry) => ({ ...entry, mine: booked.has(norm(entry.name)), kind: kindOf(entry.name, groups) }))
    .map((entry) => ({ ...entry, kindLabel: kinds[entry.kind] || "Other" }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  return { shoots, invitations: invitations.map(serializeClientInvitation), songSeconds: SONG_SECONDS };
}

/** The designs and songs for one shoot, in the studio's order. */
async function designsFor(shoot) {
  const name = String(shoot || "").trim();
  if (!name) throw fail(400, "Choose a shoot.");
  const [templates, songs] = await Promise.all([
    prisma.invitationTemplate.findMany({ where: LIVE, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] }),
    prisma.invitationSong.findMany({ where: LIVE, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] }),
  ]);
  return {
    shoot: name,
    designs: templates.filter((row) => forShoot(row.shootTypes, name)).map((row) => ({
      id: row.id,
      title: row.title,
      style: STYLE_KEYS.includes(row.style) ? row.style : "royal",
      about: STYLES.find((style) => style.key === row.style)?.about || "",
      accent: row.accent || "",
      price: Number(row.price) || 0,
      isFree: Boolean(row.isFree),
    isFree: Boolean(row.isFree),
      font: FONT_KEYS.includes(row.font) ? row.font : "script",
      ink: row.ink || "",
      coverUrl: row.coverUrl || null,
      coverType: row.coverType === "video" ? "video" : "image",
      posterUrl: row.posterUrl || null,
      topUrl: row.topUrl || null,
      bottomUrl: row.bottomUrl || null,
    })),
    // Every song the studio offers: those for this shoot first (`suggested`), then the rest, so a client
    // always has a choice even before the studio has tied songs to their shoot.
    songs: [...songs.filter((row) => songForShoot(row.shootTypes, name)), ...songs.filter((row) => !songForShoot(row.shootTypes, name))]
      .map((row) => ({ id: row.id, title: row.title, artist: row.artist || "", audioUrl: row.audioUrl, suggested: songForShoot(row.shootTypes, name) })),
    songSeconds: SONG_SECONDS,
  };
}

const OPENING = {
  wedding: { heading: "Together with their families", message: "We joyfully invite you to celebrate our wedding with us. Your presence will make our day complete." },
  baby: { heading: "You are invited to celebrate", message: "Join us as we celebrate this little joy with the people we love most." },
  corporate: { heading: "You are cordially invited", message: "We would be delighted to have you join us for this occasion." },
  other: { heading: "You are invited", message: "We would love you to be there with us." },
};

const placeOf = (shoot) => [shoot.shootPlace, shoot.district].map((value) => (value || "").trim()).filter(Boolean).join(", ");

/** A new invitation's words, from the client's booking: their names, and the shoot's day and place. */
function startingContent({ clientName, shootName, kind, shoots }) {
  const opening = OPENING[kind] || OPENING.other;
  const theShoot = shoots.find((entry) => norm(entry.name) === norm(shootName))?.shoot;
  // A wedding invitation lists the whole celebration; anything else, the one occasion.
  const listed = kind === "wedding"
    ? [...new Map(shoots.map((entry) => [entry.shoot.id, entry.shoot])).values()]
    : theShoot ? [theShoot] : [];
  return contentSchema.parse({
    heading: opening.heading,
    names: String(clientName || "").slice(0, 120),
    message: opening.message,
    date: dayOf(theShoot?.dateCreated) || "",
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(theShoot?.eventStartTime || "") ? theShoot.eventStartTime : "",
    venue: theShoot ? placeOf(theShoot).slice(0, 160) : "",
    events: listed.slice(0, MAX_EVENTS).map((shoot) => ({
      name: String(shoot.shoot).slice(0, 80),
      date: dayOf(shoot.dateCreated) || "",
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(shoot.eventStartTime || "") ? shoot.eventStartTime : "",
      venue: placeOf(shoot).slice(0, 160),
    })),
  });
}

const newToken = () => crypto.randomBytes(12).toString("base64url");

/**
 * The client's own names for a booking - "Sanjay & Deepa" - as their receipts and the app's greeting
 * name them (the enquiry's, then the group name generator's); never the WhatsApp group name, which
 * is the studio's working code. Empty when neither holds one.
 */
async function ownNames(projectId) {
  const project = await prisma.salesProject.findUnique({ where: { id: projectId }, select: { enquiryId: true, groupNameGeneratorJson: true } });
  if (!project) return "";
  const lead = project.enquiryId
    ? await prisma.salesCrmLead.findFirst({
      where: { enquiryId: project.enquiryId, deletedAt: null },
      select: { name: true, groomName: true, brideName: true, companyName: true, primaryDecisionMaker: true, babyOrMotherName: true },
    })
    : null;
  return (clientOwnName(project, lead) || "").replace(/\s+and\s+/i, " & ");
}

/**
 * What the designs are shown with while the client chooses: their own names, the shoot's date and
 * place, as a new invitation would start - nothing made up, nothing saved.
 */
async function previewFor(projectIds, shootName) {
  if (!projectIds.length) return null;
  const shoot = String(shootName || "").trim();
  const [groups, shoots] = await Promise.all([shootGroups(), clientShoots(projectIds)]);
  const projectId = shoots.find((entry) => norm(entry.name) === norm(shoot))?.projectId || projectIds[0];
  const content = startingContent({ clientName: await ownNames(projectId), shootName: shoot, kind: kindOf(shoot, groups), shoots: shoots.filter((entry) => entry.projectId === projectId) });
  return { heading: content.heading, names: content.names, date: content.date, venue: content.venue };
}

async function createInvitation({ projectIds, userId, templateId, shootName }) {
  if (!projectIds.length) throw fail(404, "Your booking could not be found. Please contact the studio.");
  const shoot = String(shootName || "").trim().slice(0, 191);
  const template = await prisma.invitationTemplate.findFirst({ where: { id: Number(templateId) || 0, ...LIVE } });
  if (!template || !forShoot(template.shootTypes, shoot)) throw fail(404, "This design is no longer available. Please choose another.");
  const [groups, shoots, songs] = await Promise.all([shootGroups(), clientShoots(projectIds), designsFor(shoot).then((found) => found.songs.filter((song) => song.suggested))]);
  // Filed with the booking the shoot is in, or the client's first.
  const projectId = shoots.find((entry) => norm(entry.name) === norm(shoot))?.projectId || projectIds[0];
  const row = await prisma.clientInvitation.create({
    data: {
      token: newToken(),
      projectId,
      templateId: template.id,
      shootName: shoot,
      songId: songs[0]?.id ?? null,
      content: startingContent({ clientName: await ownNames(projectId), shootName: shoot, kind: kindOf(shoot, groups), shoots: shoots.filter((entry) => entry.projectId === projectId) }),
      createdBy: userId || null,
    },
    include: INVITATION_INCLUDE,
  });
  return serializeClientInvitation(row);
}

const ownInvitation = (id, projectIds) => prisma.clientInvitation.findFirst({ where: { id: Number(id) || 0, projectId: { in: projectIds }, deletedAt: null }, include: INVITATION_INCLUDE });

async function clientInvitation(id, projectIds) {
  const row = projectIds.length ? await ownInvitation(id, projectIds) : null;
  if (!row) return null;
  const { songs } = await designsFor(row.shootName);
  // The song it has keeps showing even if the studio has since taken it off the list.
  const current = row.songId && !songs.some((song) => song.id === row.songId)
    ? await prisma.invitationSong.findUnique({ where: { id: row.songId }, select: { id: true, title: true, artist: true, audioUrl: true } })
    : null;
  return { ...serializeClientInvitation(row), songs: current ? [...songs, { ...current, artist: current.artist || "" }] : songs };
}

const paymentRequired = (row) => Object.assign(
  new Error(`You have used your ${accessOf(row).freeEdits} free edits. Unlock this invitation to keep editing and to share it.`),
  { status: 402, code: "PAYMENT_REQUIRED", access: accessOf(row) },
);

async function updateInvitation(id, projectIds, input) {
  const row = projectIds.length ? await ownInvitation(id, projectIds) : null;
  if (!row) return null;
  // Asked before anything is stored, so a photo is never uploaded for a save that is then refused.
  if (!accessOf(row).canEdit) throw paymentRequired(row);
  const data = {};
  if (input.content) data.content = input.content;
  if (input.songStart !== undefined) data.songStart = input.songStart;
  if (input.songId !== undefined) {
    if (input.songId === null) data.songId = null;
    else if (input.songId !== row.songId) {
      const song = await prisma.invitationSong.findFirst({ where: { id: input.songId, ...LIVE } });
      if (!song) throw fail(400, "This song is no longer available. Please choose another.");
      data.songId = song.id;
    }
  }
  // The families' and gallery photos: a new one stored, one the invitation already has kept, any other
  // link dropped - a client never points their invitation at a picture somewhere else.
  const storedPhotos = [];
  if (data.content) {
    const before = contentSchema.parse(row.content || {});
    const known = new Set([...before.gallery, ...before.families.flatMap((family) => family.photos)]);
    const keep = async (photo) => {
      if (isHttpUrl(photo)) return known.has(photo) ? photo : null;
      const stored = await storeImage(photo, { folder: "client/invitations/photos", maxBytes: PHOTO_MAX_BYTES, maxDimension: PHOTO_MAX_DIMENSION });
      if (stored) storedPhotos.push(stored);
      return stored?.url || null;
    };
    try {
      data.content = {
        ...data.content,
        families: await Promise.all(data.content.families.map(async (family) => ({ ...family, photos: (await Promise.all(family.photos.map(keep))).filter(Boolean) }))),
        gallery: (await Promise.all(data.content.gallery.map(keep))).filter(Boolean),
      };
    } catch (error) {
      if (storedPhotos.length) await discardUploads(storedPhotos);
      throw error;
    }
    if (JSON.stringify(data.content) === JSON.stringify(before)) delete data.content;
  }
  if (data.songStart === (row.songStart || 0)) delete data.songStart;
  let stored = null;
  if (input.photo !== undefined && input.photo !== row.photoUrl) {
    if (!input.photo) Object.assign(data, { photoUrl: null, photoKey: null });
    else {
      // The client's own photo, uploaded from their phone - never a link they name.
      if (isHttpUrl(input.photo)) throw fail(400, "Choose the photo from your phone.");
      stored = await storeImage(input.photo, { folder: "client/invitations/photos", maxBytes: PHOTO_MAX_BYTES, maxDimension: PHOTO_MAX_DIMENSION });
      Object.assign(data, { photoUrl: stored?.url ?? null, photoKey: stored?.key ?? null });
    }
  }
  // Nothing changed: not an edit, and not counted.
  if (!Object.keys(data).length) return clientInvitation(row.id, projectIds);
  try {
    if (accessOf(row).paid) {
      await prisma.clientInvitation.update({ where: { id: row.id }, data: { ...data, editCount: { increment: 1 } } });
    } else {
      // Counted as it is saved, in one step: two saves at once cannot both take the last free edit.
      const saved = await prisma.clientInvitation.updateMany({
        where: { id: row.id, OR: [{ paidAt: { not: null } }, { editCount: { lt: accessOf(row).freeEdits } }] },
        data: { ...data, editCount: { increment: 1 } },
      });
      if (!saved.count) throw paymentRequired(await ownInvitation(row.id, projectIds));
    }
  } catch (error) {
    if (stored) await discardUploads([stored]);
    if (storedPhotos.length) await discardUploads(storedPhotos);
    throw error;
  }
  return clientInvitation(row.id, projectIds);
}

/**
 * The client asks the studio to unlock an invitation - sharing, and edits past the free ones. The
 * studio is told (bell and phone) and records it paid on Client Management -> Invitation Cards.
 */
async function requestUnlock(id, projectIds) {
  const row = projectIds.length ? await ownInvitation(id, projectIds) : null;
  if (!row) return null;
  if (accessOf(row).paid) return clientInvitation(row.id, projectIds);
  await prisma.clientInvitation.update({ where: { id: row.id }, data: { unlockRequestedAt: new Date() } });
  await tellTeamOfUnlock(row).catch((error) => console.warn("Unable to tell the team of an invitation unlock request:", error?.message || error));
  return clientInvitation(row.id, projectIds);
}

/** Everybody who may record invitations paid hears of the request; one notice per invitation. */
async function tellTeamOfUnlock(row) {
  const project = await prisma.salesProject.findUnique({ where: { id: row.projectId }, select: { eventId: true } });
  const staff = await prisma.user.findMany({ where: { status: "ACTIVE", role: { not: "CLIENT" } }, select: { id: true } });
  const audience = [];
  for (const user of staff) {
    if (await iamService.hasPermission(user.id, "CLIENT", "Invitation Cards", "READ_WRITE").catch(() => false)) audience.push(user.id);
  }
  if (!audience.length) return;
  await prisma.notification.deleteMany({ where: { type: TYPES.INVITATION_UNLOCK, entityType: "CLIENT_INVITATION", entityId: String(row.id) } });
  const price = Number(row.price ?? row.template?.price) || 0;
  const amount = price ? `Rs ${price.toLocaleString("en-IN")}` : `Rs ${PRICE_MIN}-${PRICE_MAX}, price to confirm`;
  const notice = {
    type: TYPES.INVITATION_UNLOCK,
    title: `Invitation to unlock - ${row.shootName} (${project?.eventId || "booking"})`.slice(0, 200),
    body: `${contentSchema.parse(row.content || {}).names || "A client"} asked to share their invitation - ${amount}.`.slice(0, 180),
    entityType: "CLIENT_INVITATION",
    entityId: String(row.id),
    link: "/client-management/invitation-cards?tab=payments",
  };
  await prisma.notification.createMany({ data: audience.map((userId) => ({ userId, ...notice })) });
  clientPush.pushToStaff(audience, notice);
}

// ── What the team records ──

/** The clients' invitations from designs not marked free, newest request first: what waits on payment. */
async function teamInvitations() {
  const rows = await prisma.clientInvitation.findMany({
    where: { deletedAt: null, project: { deletedAt: null }, template: { isFree: false } },
    include: { template: { select: { id: true, title: true, price: true, coverUrl: true, coverType: true, posterUrl: true } }, project: { select: { eventId: true } } },
    orderBy: [{ updatedAt: "desc" }],
    take: 300,
  });
  const order = (row) => (row.paidAt ? 2 : row.unlockRequestedAt ? 0 : 1);
  return rows
    .sort((a, b) => order(a) - order(b) || (b.unlockRequestedAt?.getTime() || 0) - (a.unlockRequestedAt?.getTime() || 0))
    .map((row) => ({
      id: row.id,
      eventId: row.project?.eventId || "",
      names: contentSchema.parse(row.content || {}).names || "",
      shootName: row.shootName,
      design: { id: row.template.id, title: row.template.title, price: row.template.price || 0, picture: (row.template.coverType === "video" ? row.template.posterUrl : row.template.coverUrl) || null },
      // What this client pays: what they paid, else their own price, else the design's (0: not set yet).
      price: row.paidAt ? row.paidAmount ?? row.price ?? row.template.price : row.price ?? row.template.price,
      ownPrice: row.price ?? null,
      editLimit: row.editLimit ?? FREE_EDITS,
      ownEditLimit: row.editLimit ?? null,
      editCount: row.editCount,
      requestedAt: row.unlockRequestedAt ? row.unlockRequestedAt.toISOString() : null,
      paidAt: row.paidAt ? row.paidAt.toISOString() : null,
      status: row.paidAt ? "paid" : row.unlockRequestedAt ? "requested" : "unpaid",
      updatedAt: row.updatedAt,
    }));
}

/** Records an invitation paid (at the client's price today), or takes that back. */
async function markPaid(id, actorId, paid) {
  const row = await prisma.clientInvitation.findFirst({ where: { id: Number(id) || 0, deletedAt: null }, include: { template: { select: { price: true } } } });
  if (!row) return false;
  await prisma.clientInvitation.update({
    where: { id: row.id },
    data: paid
      ? { paidAt: row.paidAt || new Date(), paidBy: row.paidAt ? row.paidBy : actorId || null, paidAmount: row.paidAt ? row.paidAmount : Number(row.price ?? row.template?.price) || 0 }
      : { paidAt: null, paidBy: null, paidAmount: null },
  });
  // Recorded: the request is answered, so it leaves everybody's bell.
  if (paid) await prisma.notification.deleteMany({ where: { type: TYPES.INVITATION_UNLOCK, entityType: "CLIENT_INVITATION", entityId: String(row.id) } }).catch(() => {});
  return true;
}

/** Records several invitations paid (or takes it back) in one go: how many it changed. */
async function markPaidMany(ids, actorId, paid) {
  let changed = 0;
  for (const id of [...new Set(ids.map(Number).filter(Boolean))].slice(0, 300)) {
    if (await markPaid(id, actorId, paid)) changed += 1;
  }
  return changed;
}

/**
 * The studio deletes client invitations (test ones, or ones the client no longer wants): withdrawn,
 * not erased - the link stops opening and they leave the client's list and the bell. How many it took.
 */
async function removeInvitations(ids) {
  const wanted = [...new Set(ids.map(Number).filter(Boolean))].slice(0, 300);
  if (!wanted.length) return 0;
  const { count } = await prisma.clientInvitation.updateMany({ where: { id: { in: wanted }, deletedAt: null }, data: { deletedAt: new Date() } });
  await prisma.notification.deleteMany({ where: { type: TYPES.INVITATION_UNLOCK, entityType: "CLIENT_INVITATION", entityId: { in: wanted.map(String) } } }).catch(() => {});
  return count;
}

// One client's own terms: a price within the studio's range and a number of free edits; empty clears.
const termsSchema = z.object({
  price: z.union([z.literal(null), z.coerce.number().int().min(PRICE_MIN, `Between Rs ${PRICE_MIN} and Rs ${PRICE_MAX}.`).max(PRICE_MAX, `Between Rs ${PRICE_MIN} and Rs ${PRICE_MAX}.`)]).optional(),
  editLimit: z.union([z.literal(null), z.coerce.number().int().min(0, "Free edits cannot be negative.").max(20, "Up to 20 free edits.")]).optional(),
});

/** Sets one client's price and free edits for their invitation (Payments -> Edit). */
async function setTerms(id, input) {
  const row = await prisma.clientInvitation.findFirst({ where: { id: Number(id) || 0, deletedAt: null } });
  if (!row) return false;
  const data = {};
  if (input.price !== undefined) data.price = input.price;
  if (input.editLimit !== undefined) data.editLimit = input.editLimit;
  if (Object.keys(data).length) await prisma.clientInvitation.update({ where: { id: row.id }, data });
  return true;
}

async function removeInvitation(id, projectIds) {
  const row = projectIds.length ? await ownInvitation(id, projectIds) : null;
  if (!row) return false;
  await prisma.clientInvitation.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  return true;
}

// ── What a guest opens ──

/** The invitation's last save, or null for a link that opens nothing - what a downloaded picture is kept by. */
async function invitationVersion(token) {
  const value = String(token || "");
  if (!/^[A-Za-z0-9_-]{16}$/.test(value)) return null;
  const row = await prisma.clientInvitation.findFirst({ where: { token: value, deletedAt: null, project: { deletedAt: null } }, select: { updatedAt: true } });
  return row ? row.updatedAt.getTime() : null;
}

/**
 * The invitation at `/inv/<token>`, everything the page plays - or null for a link that opens nothing.
 * One from a priced design not yet paid for opens only with a preview key (`key`) - the client's own
 * Preview, a download; a guest with just the link is told it is not shared yet (`{ locked: true }`).
 */
async function publicInvitation(token, key = null) {
  const value = String(token || "");
  if (!/^[A-Za-z0-9_-]{16}$/.test(value)) return null;
  const row = await prisma.clientInvitation.findFirst({
    where: { token: value, deletedAt: null, project: { deletedAt: null } },
    include: { template: true, song: true },
  });
  if (!row) return null;
  const open = Boolean(row.template.isFree) || process.env.INVITATION_PAYWALL === "off" || Boolean(row.paidAt) || previewKeyOpens(row.token, key);
  if (!open) return { locked: true, shootName: row.shootName, names: contentSchema.parse(row.content || {}).names || "" };
  return {
    shootName: row.shootName,
    style: STYLE_KEYS.includes(row.template.style) ? row.template.style : "royal",
    accent: row.template.accent || "",
    font: FONT_KEYS.includes(row.template.font) ? row.template.font : "script",
    ink: row.template.ink || "",
    coverUrl: row.template.coverUrl || null,
    coverType: row.template.coverType === "video" ? "video" : "image",
    posterUrl: row.template.posterUrl || null,
    topUrl: row.template.topUrl || null,
    bottomUrl: row.template.bottomUrl || null,
    photoUrl: row.photoUrl || null,
    content: contentSchema.parse(row.content || {}),
    song: row.song ? { url: row.song.audioUrl, title: row.song.title, start: row.songStart || 0, seconds: SONG_SECONDS } : null,
  };
}

module.exports = {
  templateSchema,
  songSchema,
  invitationSchema,
  teamOverview,
  saveTemplate,
  removeTemplate,
  saveSong,
  removeSong,
  clientOverview,
  designsFor,
  previewFor,
  createInvitation,
  clientInvitation,
  updateInvitation,
  removeInvitation,
  requestUnlock,
  teamInvitations,
  markPaid,
  markPaidMany,
  removeInvitations,
  termsSchema,
  setTerms,
  previewKeyFor,
  previewKeyOpens,
  FREE_EDITS,
  PRICE_MIN,
  PRICE_MAX,
  publicInvitation,
  invitationVersion,
  storeArtwork,
  startingContent,
  SONG_SECONDS,
  AUDIO_TYPES,
};
