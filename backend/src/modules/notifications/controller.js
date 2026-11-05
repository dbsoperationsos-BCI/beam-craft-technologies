const prisma = require("../../config/db");
const iamService = require("../../services/iam.service");
const dataScope = require("../../services/dataScope.service");
const notifications = require("../../services/notifications");
const { SOURCES } = require("./sources");

/*
 * ── The bell, for the whole application ───────────────────────────────────────────────────────
 *
 * One endpoint, two kinds of notice, gated one source at a time.
 *
 * **Stored** notices are rows in `notification`, written by the module that raised them: Tasks,
 * telling somebody they have been given one or that one they set has been answered, and the CRM,
 * telling somebody a lead is now theirs. Being told something is a fact about the studio, so it is a
 * row with a `read_at` on it and it stays until it is read. Each kind answers for its own module's
 * permission - see `TYPE_PERMISSIONS` in ../../services/notifications.js - so a module that starts
 * writing rows is carried by this endpoint without it being edited.
 *
 * **Derived** notices are computed on read: a follow-up booked for this morning, a client who
 * replied on WhatsApp an hour ago, a call nobody has read yet, an approval sitting in a queue.
 * Nothing writes those down anywhere, and nothing should - they stop being true when the work is
 * done, and a table of them would need something to go back and delete each one.
 *
 * The two arrive together because the reader has one bell to look at, and they keep their own
 * shapes because they are unread in genuinely different ways.
 *
 * ── Who is told what ──
 *
 * The router has established only that the caller is signed in. Every source names the module and
 * feature it belongs to and is read only for a viewer who holds that module's own Read permission,
 * so the bell can never become a way around the guard on the module a notice is about. Somebody who
 * holds only the CRM gets the CRM's notices and an honest count; somebody who holds only Tasks gets
 * the task rows; somebody who holds neither gets an empty bell rather than a 403 on the topbar of
 * every screen.
 *
 * That is the same shape the Contacts directory uses, for the same reason, and the two should stay
 * the same shape: they are both "one screen, many modules, one permission each".
 *
 * ── How wide the answer is ──
 *
 * Every derived source answers about the reader's own work, which is what makes a bell worth
 * glancing at. For a reader the data scope does not confine - a Super Admin, or anybody whose branch
 * reach is not narrowed - it answers about the studio's, because that is already what their screens
 * show them and a bell narrower than the board beneath it would be the one place their view stopped.
 *
 * Asked through `dataScope.seesEverything`, which is the same rule that decides whose *rows* anybody
 * gets, rather than through a role test written here. A role test in a controller is a second answer
 * to a question this application answers in one place, and one that no role could ever be granted.
 */

function sendError(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(fallback, error?.message || error);
  return res.status(500).json({ message: fallback });
}

/**
 * How the derived notices are ordered: soonest first, and the ones already late above them.
 *
 * `at` is when the thing is *about* - the day a follow-up was due, the moment a client replied -
 * rather than when it was noticed, so a follow-up from last Tuesday stays at the top where it
 * belongs instead of sinking as newer notices arrive.
 *
 * Anything without a moment sorts last rather than first: a notice that cannot say when is not more
 * urgent than one that can.
 */
function byUrgency(first, second) {
  if (!first.at) return second.at ? 1 : 0;
  if (!second.at) return -1;
  return new Date(first.at) - new Date(second.at);
}

async function list(req, res) {
  try {
    /*
     * The signed-in person, by both the things the sources need.
     *
     * `id` is what the WhatsApp session and the approvals are keyed on. `name` is what a lead
     * records as the CRM working it - a name rather than an id, which is the CRM's own compromise
     * and is noted in `sources.js`.
     */
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, name: true } });

    const allowed = [];
    for (const source of SOURCES) {
      // Asked one at a time rather than in parallel: `hasPermission` reads a cache per user, and
      // the first call is what fills it.
      if (await iamService.hasPermission(req.user.id, source.module, source.feature, "READ")) allowed.push(source);
    }

    /*
     * Which kinds of stored notice this reader may be told about, by the module each belongs to.
     *
     * One permission check per distinct module rather than one per type - the four task types share
     * a permission - and the result is applied inside the query, so the badge counts exactly what
     * the panel lists.
     */
    const heldForStored = [];
    for (const permission of notifications.permissionsForTypes()) {
      if (await iamService.hasPermission(req.user.id, permission.module, permission.feature, "READ")) heldForStored.push(permission);
    }
    const storedTypes = notifications.typesFor(heldForStored);

    /*
     * How wide the derived half answers. Read against the sources' own modules rather than once for
     * the reader: somebody unconfined in Sales and confined elsewhere gets the studio's CRM notices
     * and their own of everything else, which is the same line their screens draw.
     */
    const everyone = new Map();
    for (const source of allowed) {
      const key = `${source.module}:${source.feature}`;
      if (!everyone.has(key)) everyone.set(key, await dataScope.seesEverything(req.user.id, source).catch(() => false));
    }
    const viewerFor = (source) => ({
      userId: req.user.id,
      userName: String(user?.name || "").trim(),
      everyone: Boolean(everyone.get(`${source.module}:${source.feature}`)),
    });

    const [collected, stored] = await Promise.all([
      Promise.all(allowed.map((source) => source.load(viewerFor(source)))),
      // Not read at all when no permission reaches any kind, rather than read and filtered: a role
      // that holds neither module has nothing that could have put a row here, and asking is a query
      // for a guaranteed nothing.
      storedTypes.length ? notifications.listForUser(req.user.id, { types: storedTypes }) : Promise.resolve({ notifications: [], unreadCount: 0 }),
    ]);

    return res.json({
      data: {
        // The stored rows, newest first, each with its own read state.
        notifications: stored.notifications,
        // The derived ones, soonest first. Sorted here rather than merged into the list above
        // because the two are read differently and the panel draws them as separate halves.
        notices: collected.flat().sort(byUrgency),
        // Which sources actually answered, so the bell can tell "nothing is waiting" from "you
        // cannot see any of this" - two very different empty states. `stored` stands for every
        // module that writes a row, which is no longer only Tasks; `tasks` is kept beside it
        // because the panel's own half is still named that.
        sources: [...allowed.map((source) => source.key), ...(storedTypes.length ? ["stored", "tasks"] : [])],
      },
      meta: { unreadCount: stored.unreadCount },
    });
  } catch (error) {
    return sendError(res, error, "Unable to load your notifications.");
  }
}

/*
 * Marking read applies to the stored rows only, and that is not an omission.
 *
 * A derived notice has nothing to mark: it is a follow-up that is due or a reply that is unanswered,
 * and it stops being listed when the work is done rather than when somebody has looked at it. The
 * bell remembers which of those a reader has *glanced* at in their own browser, which is the right
 * place for that - it is one person's reading of a list that is already on screen elsewhere.
 */
async function markRead(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "That is not a valid notification id." });
  try {
    // Scoped to the caller in the query itself, so there is no request shape that clears somebody
    // else's bell - the id in the URL is never trusted to be one they may touch.
    const found = await notifications.markRead(req.user.id, id);
    if (!found) return res.status(404).json({ message: "That notification could not be found." });
    return res.json({ data: { id, read: true } });
  } catch (error) {
    return sendError(res, error, "Unable to mark that notification read.");
  }
}

/** What opening the bell does: everything stored in it has now been seen. */
async function markAllRead(req, res) {
  try {
    return res.json({ data: { read: await notifications.markAllRead(req.user.id) } });
  } catch (error) {
    return sendError(res, error, "Unable to mark your notifications read.");
  }
}

module.exports = { list, markRead, markAllRead };
