const prisma = require("../../../config/db");
const { readableProject } = require("../../../services/projectScope");
const { projectClientNames, clientNameOf } = require("../../../services/projectClientNames");

/*
 * The two gifts a project owes its client, and the three places one can be.
 *
 * Both gifts are the same journey - somebody is named for it, it goes out, the client confirms it
 * arrived - so they are one shape read twice rather than two near-identical modules. `GIFTS` is
 * the only place the column names live: a screen asks for a gift by key and everything else here
 * is derived from that row.
 */
/*
 * The three places a gift can be.
 *
 * The first was "Yet To Receive", which named the wrong end of the journey: a gift sitting in this
 * state has not been *sent* yet, and "yet to receive" reads as the studio waiting on something
 * rather than as the studio owing something. It is "Yet To Sent" - the words the people chasing
 * these use.
 *
 * `LEGACY_PENDING` is the old spelling, and it is still in the database: this is a plain text column
 * on `sales_project` and the rows written before the rename hold it. Rather than a migration that
 * rewrites them, it is folded on read - see `readStatus` - so an untouched row reads as the state it
 * has always been in and the next write puts the new spelling on it. A gift's status is written by
 * exactly one function, so there is no second place for the old word to come back from.
 */
const GIFT_STATUSES = ["Yet To Sent", "Sent", "Received by Client"];
const GIFT_STATUS_PENDING = GIFT_STATUSES[0];
const LEGACY_PENDING = "Yet To Receive";

/** The stored status as this module names it now. Blank and the old spelling both mean pending. */
function readStatus(value) {
  const stored = String(value || "").trim();
  if (!stored || stored === LEGACY_PENDING) return GIFT_STATUS_PENDING;
  return stored;
}

const GIFTS = {
  welcome: {
    key: "welcome",
    label: "Welcome Gift",
    gift: "welcomeGift",
    status: "welcomeGiftStatus",
    sentAt: "welcomeGiftSentAt",
    receivedAt: "welcomeGiftReceivedAt",
    assignee: "welcomeGiftAssignee",
    employeeId: "welcomeGiftEmployeeId",
  },
  "shoot-completed": {
    key: "shoot-completed",
    label: "Shoot Completed Gift",
    gift: "shootCompletedGift",
    status: "shootCompletedGiftStatus",
    sentAt: "shootCompletedGiftSentAt",
    receivedAt: "shootCompletedGiftReceivedAt",
    assignee: "shootCompletedGiftAssignee",
    employeeId: "shootCompletedGiftEmployeeId",
  },
};

const GIFT_KEYS = Object.keys(GIFTS);

function giftOrThrow(key) {
  const gift = GIFTS[key];
  if (!gift) {
    const error = new Error(`Unknown gift. Expected one of: ${GIFT_KEYS.join(", ")}.`);
    error.status = 400;
    throw error;
  }
  return gift;
}

const projectSelect = {
  id: true,
  eventId: true,
  enquiryId: true,
  whatsappGroupName: true,
  whatsappGroupNameId: true,
  clientMainNumber: true,
  sourceBranch: true,
  vertical: true,
  groupType: true,
  crmName: true,
  projectStatus: true,
  projectManager: true,
  createdAt: true,
};

/**
 * One gift's rows: the projects that owe it, whoever they are owed by.
 *
 * A project appears here only once the gift has been marked Applicable, which is also when it is
 * given its first status - so "Not Applicable" and "never answered" both mean the same thing to
 * this screen, which is that there is nothing to chase. The row carries the gift's own fields
 * under neutral names (`status`, `assignee`, `sentAt`) so the table does not have to know which
 * gift it is drawing.
 */
async function listGiftProjects(giftKey, { where: extraWhere } = {}) {
  const gift = giftOrThrow(giftKey);
  const projects = await prisma.salesProject.findMany({
    // `AND` rather than a spread: the caller's fragment is the visibility rule and carries its own
    // `OR`, which a spread beside another `OR` would silently replace.
    where: {
      deletedAt: null,
      [gift.gift]: "Applicable",
      AND: [extraWhere || {}],
    },
    select: {
      ...projectSelect,
      [gift.status]: true,
      [gift.sentAt]: true,
      [gift.receivedAt]: true,
      [gift.assignee]: true,
      [gift.employeeId]: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // The client's name is not a column on the project - it is read off the lead the project came
  // from, the same way every other project screen reads it.
  const names = await projectClientNames(projects);
  return projects.map((project) => ({
    ...project,
    gift: gift.key,
    giftLabel: gift.label,
    clientName: clientNameOf(project, names) || "",
    status: readStatus(project[gift.status]),
    assignee: project[gift.assignee] || "",
    assigneeEmployeeId: project[gift.employeeId] || null,
    sentAt: project[gift.sentAt],
    receivedAt: project[gift.receivedAt],
  }));
}

/**
 * Moves one gift along, and stamps the date the move happened.
 *
 * The timestamps are set here rather than being sent by the screen: "Sent" means sent now, and a
 * client cannot have confirmed a gift that never went out, so marking one Received stamps a send
 * date it is missing rather than storing a row that says it arrived before it left. Walking a row
 * back to an earlier tab clears the dates it is no longer entitled to.
 */
async function updateGiftStatus(giftKey, projectId, status, { userId, permissions } = {}) {
  const gift = giftOrThrow(giftKey);
  if (!GIFT_STATUSES.includes(status)) {
    const error = new Error(`Unknown status. Expected one of: ${GIFT_STATUSES.join(", ")}.`);
    error.status = 400;
    throw error;
  }

  // Scoped through the project, the same way the list is: a gift on a project this person may not
  // see is not theirs to move along, and answers "not found" rather than admitting it exists.
  const project = await readableProject({
    userId,
    projectId,
    permissions,
    select: { id: true, [gift.gift]: true, [gift.sentAt]: true },
  });
  if (!project) {
    const error = new Error("Project not found.");
    error.status = 404;
    throw error;
  }
  if (project[gift.gift] !== "Applicable") {
    const error = new Error(`${gift.label} is not applicable for this project.`);
    error.status = 409;
    throw error;
  }

  const now = new Date();
  const data = { [gift.status]: status };
  if (status === GIFT_STATUS_PENDING) {
    data[gift.sentAt] = null;
    data[gift.receivedAt] = null;
  }
  if (status === "Sent") {
    data[gift.sentAt] = now;
    data[gift.receivedAt] = null;
  }
  if (status === "Received by Client") {
    data[gift.sentAt] = project[gift.sentAt] || now;
    data[gift.receivedAt] = now;
  }

  await prisma.salesProject.update({ where: { id: project.id }, data });
  const [row] = await listGiftProjects(giftKey, { where: { id: project.id } });
  return row || null;
}

module.exports = { GIFTS, GIFT_KEYS, GIFT_STATUSES, GIFT_STATUS_PENDING, LEGACY_PENDING, readStatus, listGiftProjects, updateGiftStatus };
