  const jwt = require("jsonwebtoken");
const prisma = require("../config/db");
const { CLIENT_ROLE } = require("../services/loginCredentials");
const { tokenStillStands } = require("../services/passwordSessions");

/*
 * Why a sign-in was refused, in the words the person needs. Both guards answer `""` when the
 * sign-in stands and the message when it does not: a closed account and a changed password both
 * end a session, but one is HR's to undo and the other is simply "sign in again".
 */
const PASSWORD_CHANGED = "This password was changed, so every device was signed out. Sign in again with the new password.";

/*
 * What a client's sign-in may reach: its own profile, its own project (the client portal,
 * `modules/client/portal`), and nothing of the studio's.
 *
 * A client account (`role` "CLIENT", made from Create Project → Client Credentials) holds no IAM
 * role, so every permission-guarded route already refuses it. But several routes ask only that the
 * caller be signed in - the `/api/user` account routes, master-data reads, the release note - and
 * those were written for studio staff. So a client is refused here, before any router runs, unless
 * the route is on this list. A new client portal route joins it.
 *
 * Not the password change: a client signs in with the password the studio gave them and keeps it -
 * the studio decides it, so a client cannot change it (nor reset it, `authController`).
 */
const CLIENT_ROUTES = new Set([
  "GET /api/user/profile",
  // A client sets their own password in place of the studio's (first sign-in, or Profile).
  "POST /api/user/change-password",
  "GET /api/client/projects",
  "GET /api/client/project",
  "GET /api/client/payments",
  // What the booking includes, shoot by shoot: its services and deliverables.
  "GET /api/client/package",
  "GET /api/client/quotation/pdf",
  "GET /api/client/quotation/view",
  // The studio's offers on the Home page of the app (Sales -> Client Offers).
  "GET /api/client/offers",
  // Chat with the studio: their chats, and a new one on a topic.
  "GET /api/client/chats",
  "POST /api/client/chats",
  // Refer a friend: the client's referrals, and a new one (a CRM lead with them as its reference).
  "GET /api/client/referrals",
  "POST /api/client/referrals",
  "GET /api/client/coins",
  "GET /api/client/receipt",
  "GET /api/client/reviews",
  "GET /api/client/notifications",
  "GET /api/client/crd",
  "GET /api/client/pre-production",
  "POST /api/client/push-token",
  "DELETE /api/client/push-token",
  // Invitation Cards: the shoots with designs and the client's invitations, one shoot's designs, a new one.
  "GET /api/client/invitations",
  "GET /api/client/invitations/designs",
  "POST /api/client/invitations",
  // Requests about the booking's services and deliverables.
  "GET /api/client/requests",
  "POST /api/client/requests",
]);
// Routes that name one record of the client's own - held to it again by the handler. The id is a
// plain identifier, so nothing else of the API can be spelled into it.
const CLIENT_ROUTE_PATTERNS = [
  /^PATCH \/api\/client\/pre-production\/[A-Za-z0-9]{1,64}$/,
  // One chat of the client's own, and a message in it (held to their project again by the handler).
  /^GET \/api\/client\/chats\/\d{1,10}$/,
  /^POST \/api\/client\/chats\/\d{1,10}\/messages$/,
  // One invitation of the client's own: read, saved, deleted (held to their bookings by the handler).
  /^(GET|PUT|DELETE) \/api\/client\/invitations\/\d{1,10}$/,
  // Asking the studio to unlock one (to share it, and edit past the free edits).
  /^POST \/api\/client\/invitations\/\d{1,10}\/unlock$/,
  // Deleting one of their own requests while it still waits for the studio.
  /^DELETE \/api\/client\/requests\/\d{1,10}$/,
];
const clientMayReach = (req) => {
  const route = `${req.method} ${String(req.originalUrl || "").split("?")[0].replace(/\/+$/, "")}`;
  return CLIENT_ROUTES.has(route) || CLIENT_ROUTE_PATTERNS.some((pattern) => pattern.test(route));
};

/*
 * Whether a client's sign-in still stands: active, still a client, and its project not deleted.
 *
 * Read on every client request, unlike a studio token, which is trusted until it expires. A client
 * account is switched off when its project is deleted, and a token already issued must stop with it
 * rather than run on for the days it has left. Clients reach only the routes listed above, so this is
 * one indexed read on a handful of requests.
 */
async function clientLoginStands(userId, issuedAt) {
  const id = Number(userId);
  // These answer a message, not a boolean: an id that is no id at all is a refusal, not a pass.
  if (!Number.isInteger(id) || id <= 0) return "This sign-in is not valid. Sign in again.";
  const account = await prisma.user.findUnique({ where: { id }, select: { status: true, role: true, passwordChangedAt: true, clientProject: { select: { deletedAt: true } } } });
  if (!tokenStillStands(issuedAt, account?.passwordChangedAt)) return PASSWORD_CHANGED;
  const stands = Boolean(account && account.status === "ACTIVE" && account.role === CLIENT_ROLE && account.clientProject && !account.clientProject.deletedAt);
  return stands ? "" : "This client login is no longer active.";
}

/*
 * Whether a staff sign-in still stands: the account exists and is ACTIVE.
 *
 * A token is good for days (JWT_EXPIRES_IN), but an account can be closed long before that -
 * offboarding marks somebody Relieved, Fired or Absconded and sets their login INACTIVE, and so does
 * deleting an employee. Without this check a closed account kept working until its token ran out;
 * asked here, on every request, the next thing an offboarded person's browser asks for is refused
 * with a 401, and the app signs them out (`AUTH_EXPIRED_EVENT` in the frontend's API client).
 * One primary-key read per request, the same read client accounts have always had.
 */
async function staffLoginStands(userId, issuedAt) {
  const id = Number(userId);
  // These answer a message, not a boolean: an id that is no id at all is a refusal, not a pass.
  if (!Number.isInteger(id) || id <= 0) return "This sign-in is not valid. Sign in again.";
  const account = await prisma.user.findUnique({ where: { id }, select: { status: true, passwordChangedAt: true } });
  // A token minted before the password was last changed is no longer this account's: changing a
  // password signs it out of every device, and this is what ends the sessions already open. Said
  // apart from a closed account, because they are different things to do something about.
  if (!tokenStillStands(issuedAt, account?.passwordChangedAt)) return PASSWORD_CHANGED;
  return account?.status === "ACTIVE" ? "" : "This account is no longer active. Contact HR if you think this is a mistake.";
}

const protect = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Not authorized" });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;

    if (decoded?.role === CLIENT_ROLE) {
      if (!clientMayReach(req)) return res.status(403).json({ message: "A client account cannot use this." });
      return clientLoginStands(decoded.id, decoded.iat)
        .then((refusal) => (refusal ? res.status(401).json({ message: refusal }) : next()))
        .catch(() => res.status(401).json({ message: "This client login could not be checked. Sign in again." }));
    }

    return staffLoginStands(decoded.id, decoded.iat)
      .then((refusal) => (refusal ? res.status(401).json({ message: refusal }) : next()))
      .catch(() => res.status(401).json({ message: "This sign-in could not be checked. Sign in again." }));
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

module.exports = {
  protect,
  CLIENT_ROUTES,
  clientLoginStands,
  staffLoginStands,
};
