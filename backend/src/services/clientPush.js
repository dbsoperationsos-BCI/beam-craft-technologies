const prisma = require("../config/db");
const { CLIENT_ROLE } = require("./loginCredentials");

/*
 * Push notifications to clients' phones (the Beam Craft app), through the Expo push service.
 *
 * The app registers each phone's Expo push token against the client's login (`ClientPushToken`).
 * When something happens on a project - a payment received, the gallery shared, the crew on the way,
 * the shoot started or completed, the studio receiving the selection - the code that saved it calls
 * `notifyProject` after its own save has committed. A client reaches a project through its own login
 * or through the project's Client Main Number (one person, several events), so both are asked.
 *
 * Never throws and never holds the caller up: a push that cannot be sent is logged and dropped, and the
 * work that triggered it stands. Expo answering that an app is gone from a phone removes that token.
 */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH = 100;

async function expoSend(messages) {
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Expo push answered ${response.status}`);
  return body?.data ?? [];
}

// Tests replace the sender; under `node --test` nothing reaches the network unless one does.
let send = process.env.NODE_ENV === "test" ? async () => [] : expoSend;
function setSender(sender) { send = sender || expoSend; }

const lastTen = (value) => String(value || "").replace(/\D/g, "").slice(-10);

/** The project's Event ID and the push tokens of every live client login that reaches it. */
async function tokensForProject(projectId) {
  const project = await prisma.salesProject.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, eventId: true, clientMainNumber: true } });
  if (!project) return { eventId: null, tokens: [] };
  const number = lastTen(project.clientMainNumber);
  const users = await prisma.user.findMany({
    where: {
      role: CLIENT_ROLE,
      status: "ACTIVE",
      OR: [{ clientProjectId: project.id }, ...(number.length === 10 ? [{ username: number }] : [])],
    },
    select: { clientPushTokens: { select: { token: true } } },
  });
  return { eventId: project.eventId, tokens: [...new Set(users.flatMap((user) => user.clientPushTokens.map((row) => row.token)))] };
}

/**
 * Sends `{ title, body, data }` to the client's phones for `projectId`. Resolves to the number of
 * phones it went to; never rejects.
 */
async function notifyProject(projectId, { title, body, data = {} }) {
  try {
    if (!projectId || !title) return 0;
    const { eventId, tokens } = await tokensForProject(projectId);
    if (!tokens.length) return 0;
    // The Event ID rides along so the app opens the right booking when the notification is tapped.
    const payload = { ...data, eventId };
    let sent = 0;
    for (let i = 0; i < tokens.length; i += BATCH) {
      const chunk = tokens.slice(i, i + BATCH);
      const tickets = await send(chunk.map((to) => ({ to, title, body, data: payload, sound: "default", badge: 1, channelId: "default", priority: "high" })));
      const gone = chunk.filter((_, n) => tickets[n]?.status === "error" && tickets[n]?.details?.error === "DeviceNotRegistered");
      if (gone.length) await prisma.clientPushToken.deleteMany({ where: { token: { in: gone } } });
      sent += chunk.length - gone.length;
    }
    return sent;
  } catch (error) {
    console.error("Client push could not be sent:", error.message);
    return 0;
  }
}

/*
 * Kept for the app's bell (`ClientNotification`) - only for pushes no other record stands for: the
 * project's own rows already say when a shoot moved, a payment came in or photos were first shared.
 * Saved before sending, so the client sees it in the app even with no phone registered.
 */
async function record({ salesProjectId = null, userId = null, title, body, data = {} }) {
  try {
    await prisma.clientNotification.create({ data: { salesProjectId, userId: userId == null ? null : Number(userId), type: String(data.type || "update").slice(0, 30), title: String(title).slice(0, 191), body: body ? String(body).slice(0, 500) : null } });
  } catch (error) {
    console.error("Client notification could not be saved:", error.message);
  }
}

/** Sends to the phones of one login - something about the account itself, not a project. */
async function notifyUser(userId, { title, body, data = {} }) {
  try {
    if (title) await record({ userId, title, body, data });
    const rows = await prisma.clientPushToken.findMany({ where: { userId: Number(userId) }, select: { token: true } });
    if (!rows.length || !title) return 0;
    const tokens = rows.map((row) => row.token);
    const tickets = await send(tokens.map((to) => ({ to, title, body, data, sound: "default", channelId: "default", priority: "high" })));
    const gone = tokens.filter((_, n) => tickets[n]?.status === "error" && tickets[n]?.details?.error === "DeviceNotRegistered");
    if (gone.length) await prisma.clientPushToken.deleteMany({ where: { token: { in: gone } } });
    return tokens.length - gone.length;
  } catch (error) {
    console.error("Client push could not be sent:", error.message);
    return 0;
  }
}

/** The same, looked up by the shoot (`ProjectShoot.id`) a production step belongs to. */
async function notifyShoot(shootId, message) {
  try {
    const shoot = await prisma.projectShoot.findFirst({ where: { id: shootId, deletedAt: null }, select: { id: true, projectId: true, shoot: true, shootId: true } });
    if (!shoot) return 0;
    const built = message(shoot);
    return notifyProject(shoot.projectId, { ...built, data: { ...built.data, shootId: shoot.id } });
  } catch (error) {
    console.error("Client push could not be sent:", error.message);
    return 0;
  }
}

/*
 * The same, for an Image Selection project (a gallery or its Signature Album), through the booking it
 * belongs to. The team often sends a gallery to the client and to the group one after the other; the
 * same message for the same project inside ten minutes goes once.
 */
const GALLERY_REPEAT_MS = 10 * 60 * 1000;
const lastGalleryPush = new Map();
async function notifyGallery(imageSelectionProjectId, message) {
  try {
    const project = await prisma.imageSelectionProject.findFirst({ where: { id: imageSelectionProjectId, deletedAt: null }, select: { salesProjectId: true } });
    if (!project?.salesProjectId) return 0;
    const key = `${imageSelectionProjectId}:${message.title}`;
    if (Date.now() - (lastGalleryPush.get(key) || 0) < GALLERY_REPEAT_MS) return 0;
    lastGalleryPush.set(key, Date.now());
    await record({ salesProjectId: project.salesProjectId, ...message });
    return notifyProject(project.salesProjectId, message);
  } catch (error) {
    console.error("Client push could not be sent:", error.message);
    return 0;
  }
}

/**
 * A push for a project that no other record stands for (the CRD link sent, say): kept for the app's
 * bell and sent, once per project and message within ten minutes - a button pressed twice is one push.
 */
async function notifyProjectRecorded(salesProjectId, message) {
  try {
    if (!salesProjectId || !message?.title) return 0;
    const key = `project:${salesProjectId}:${message.title}`;
    if (Date.now() - (lastGalleryPush.get(key) || 0) < GALLERY_REPEAT_MS) return 0;
    lastGalleryPush.set(key, Date.now());
    await record({ salesProjectId, ...message });
    return notifyProject(salesProjectId, message);
  } catch (error) {
    console.error("Client push could not be sent:", error.message);
    return 0;
  }
}

const inr = (amount) => `₹${Number(amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** A payment recorded against a project: the client hears of money received, never money spent. */
function notifyPaymentReceived(entry) {
  if (!entry || entry.entryType !== "Received" || !entry.projectId) return Promise.resolve(0);
  return notifyProject(entry.projectId, {
    title: `Payment of ${inr(entry.amount)} received`,
    body: [entry.category, "Thank you!"].filter(Boolean).join(" · "),
    data: { type: "payment", entryId: entry.entryId },
  });
}

/**
 * A team member's bell, on their phone: what DBS just put in the bell of these logins (a task, a
 * request waiting on them, an event) is pushed to every phone they are signed in on in the app. Not
 * kept anywhere else - the bell row is the record. Never throws.
 */
async function pushToStaff(userIds, { title, body = null, link = null }) {
  try {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).map(Number).filter(Boolean))];
    if (!ids.length || !title) return 0;
    const rows = await prisma.clientPushToken.findMany({ where: { userId: { in: ids }, user: { role: { not: CLIENT_ROLE }, status: "ACTIVE" } }, select: { token: true } });
    const tokens = [...new Set(rows.map((row) => row.token))];
    let sent = 0;
    for (let i = 0; i < tokens.length; i += BATCH) {
      const chunk = tokens.slice(i, i + BATCH);
      const tickets = await send(chunk.map((to) => ({ to, title: String(title).slice(0, 200), body: body ? String(body).slice(0, 300) : undefined, data: { type: "staff", link }, sound: "default", channelId: "default", priority: "high" })));
      const gone = chunk.filter((_, n) => tickets[n]?.status === "error" && tickets[n]?.details?.error === "DeviceNotRegistered");
      if (gone.length) await prisma.clientPushToken.deleteMany({ where: { token: { in: gone } } });
      sent += chunk.length - gone.length;
    }
    return sent;
  } catch (error) {
    console.error("Staff push could not be sent:", error.message);
    return 0;
  }
}

module.exports = { record, pushToStaff, notifyProject, notifyProjectRecorded, notifyUser, notifyShoot, notifyGallery, notifyPaymentReceived, tokensForProject, setSender, EXPO_PUSH_URL };
