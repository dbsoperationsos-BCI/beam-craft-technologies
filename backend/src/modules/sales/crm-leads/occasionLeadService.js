const { toIsoDay } = require("./leadDates");

const prisma = require("../../../config/db");

/*
 * ── A Qua Qua lead comes round again ──────────────────────────────────────────────────────────
 *
 * Qua Qua shoots children, and the same client is worth calling more than once. Two occasions say
 * so, and the studio works both the same way:
 *
 *   * **Newborns** - the baby is due, or has just arrived. From 30 days before the estimated
 *     delivery date to 5 days after it.
 *   * **Birthdays** - the child born last year turns one. From 45 days before the birthday up to
 *     and including the day itself, and only that first one: a second or fifth birthday is not a
 *     reason to ring.
 *
 * Both are read off the one field that holds either, "Date of Birth (or) EDOD", and both are a
 * fresh reason to ring the family rather than a continuation of whatever was sold before. So the
 * board puts a lead back into **Yet to connect** when either window opens, and the status somebody
 * sets from there is stored against *the occasion*, not against the lead. Two reasons, and both of
 * them are bugs if it is done the other way round:
 *
 *   * the lead's own status is the record of the last shoot - overwriting a Converted with this
 *     year's Followup loses it;
 *   * a status written onto the lead never expires, so next year's birthday would arrive with this
 *     year's status already against it and the lead would never return to Yet to connect.
 *
 * An occasion is therefore `(lead, which occasion, which year)`, held in `sales_crm_lead_occasion`.
 * A year with no row is an occasion nobody has connected about, which means nothing has to be
 * written in advance for one to show up - the window opening is enough.
 *
 * ── The two windows never overlap ──
 *
 * Worth knowing, because it is what lets a lead have exactly one occasion open at a time and the
 * board read one status. A birthday needs the stored date to be in the past, its next recurrence
 * 0-45 days off *and* the child turning one; a date inside the newborn window is at most 5 days
 * past, whose next birthday is therefore some 360 days off. The two cannot both be true, and
 * `crm-lead-occasions.test.js` says so out loud.
 *
 * ── One module ──
 *
 * The rule is stated twice on purpose - in SQL, for the board that filters and counts, and in
 * JavaScript, for the write path that decides where a status belongs - and the two have to answer
 * the same for the same lead on the same day. Keeping both here is what makes that checkable.
 */

/*
 * The vertical that works these occasions.
 *
 * Dum Dum shoots weddings and Corp shoots companies; neither has a client whose date of birth is a
 * reason to call, and neither fills in the field this reads. Naming the vertical rather than testing
 * for a filled-in date is what keeps a stray date on a wedding lead from putting it into Yet to
 * connect a year later.
 *
 * The spelling test mirrors `VERTICAL_SQL` in leadQueryService.js: trimmed, spaces removed,
 * lowercased.
 */
const OCCASION_BRANCH = "Qua Qua";

function isOccasionVertical(vertical) {
  return String(vertical || "").trim().replace(/\s+/g, "").toLowerCase() === "quaqua";
}

/**
 * The studio's day. A call logged just after midnight IST happened today, not yesterday as a UTC
 * server's own clock would have it.
 */
function studioToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/**
 * A stored date folded to `YYYY-MM-DD`, or "" when it is not a day at all.
 *
 * `toIsoDay` in [leadDates.js](./leadDates.js), which is also what `isoDaySql` in
 * leadQueryService.js builds the SQL half from. The board decides an occasion in MySQL and the write
 * path decides the same occasion here, so the two have to agree about what "12/08/2026" means - and
 * about what "09-Sep-26" means, which until that module existed was "not a date" on both sides.
 * Day-first, which is what `toLocaleDateString("en-GB")` writes and what this module produces
 * everywhere it formats a date itself.
 */
const isoDay = toIsoDay;

/**
 * The day the client is treating as today, as `YYYY-MM-DD`.
 *
 * Every tab on the board is dated against the browser's day rather than the server's, so that what a
 * tab lists agrees with the label the browser prints beside it. A caller that sends nothing, or
 * something that is not a day, gets the studio's own.
 */
function todayKey(today) {
  return isoDay(today) || studioToday();
}

function pad(number) {
  return String(number).padStart(2, "0");
}

/**
 * A birthday's occurrence in one calendar year, as `YYYY-MM-DD`.
 *
 * 29 February is clamped back to the 28th in a year that has none. That is not a preference - it is
 * what MySQL's `DATE_ADD(date, INTERVAL n YEAR)` does, and that is the expression the board's SQL
 * uses. A leap-year baby has to land on the same day on both sides, or it would be listed in Yet to
 * connect and then refused a status by the write path, which reads as a row that cannot be worked.
 */
function occurrenceOn(bornIso, year) {
  const month = Number(bornIso.slice(5, 7));
  const dayOfMonth = Number(bornIso.slice(8, 10));
  // Day 0 of the next month is the last day of this one.
  const lastOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(dayOfMonth, lastOfMonth))}`;
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

/*
 * ── The two occasions ─────────────────────────────────────────────────────────────────────────
 *
 * Each states its window twice - `match` for the write path, `windowSql` for the board - plus the
 * year its occurrence is filed under. They are listed newborn-first, which is also the order they
 * are tested in: a delivery is the nearer event, and naming an order means the two can never both
 * claim a lead even if the windows were later widened into each other.
 */

// How far either side of an estimated delivery date a lead counts as a newborn enquiry.
const NEWBORN_DAYS_BEFORE = 30;
const NEWBORN_DAYS_AFTER = 5;
/*
 * The run-up in which an upcoming birthday is worth calling about, counted back from the day.
 *
 * `FROM` is 0 rather than a day or two: the birthday itself is still worth a call, and a floor above
 * zero empties the tab exactly as the date arrives - which reads as the lead having been dealt with
 * rather than as having run out of time.
 */
const BIRTHDAY_DAYS_FROM = 0;
const BIRTHDAY_DAYS_TO = 45;
/*
 * And which birthday it is: the first, the one the child born last year is turning.
 *
 * Counted against the occurrence being worked rather than against today's year, and the two are not
 * the same thing in the fortnight either side of new year. On 20 December the birthdays in the
 * window are mostly January's, so the child turning one at one of them was born *this* year, not
 * last - reading the birth year off today's would call the wrong families for six weeks a year and
 * miss the right ones.
 */
const BIRTHDAY_AGE = 1;

const OCCASIONS = {
  /*
   * Newborns: the estimated delivery date itself, from 30 days before it to 5 days after.
   *
   * Expressed as a range on the column rather than on today - "today is between (edod - 30) and
   * (edod + 5)" and "edod is between (today - 5) and (today + 30)" say the same thing, and only the
   * second can be answered from an index. The first wraps the column in two date offsets, which
   * MySQL must compute for every row.
   *
   * The occurrence is filed under the year of the delivery: one window per pregnancy.
   */
  NEWBORN: {
    key: "NEWBORN",
    label: "Newborn",
    match(dateIso, todayIso) {
      const days = daysBetween(todayIso, dateIso);
      if (days < -NEWBORN_DAYS_AFTER || days > NEWBORN_DAYS_BEFORE) return null;
      return { year: Number(dateIso.slice(0, 4)), on: dateIso, days };
    },
    windowSql: (day) => `(\`dob_edod_day\` IS NOT NULL AND \`dob_edod_day\`
      BETWEEN DATE_SUB(${day}, INTERVAL ${NEWBORN_DAYS_AFTER} DAY)
          AND DATE_ADD(${day}, INTERVAL ${NEWBORN_DAYS_BEFORE} DAY))`,
    yearSql: () => "YEAR(`dob_edod_day`)",
    onSql: () => "`dob_edod_day`",
  },

  /*
   * Birthdays: the *recurrence* of the stored date, 0 to 45 days out - the day itself included.
   *
   * A date of birth is in the past, so comparing it to a forward window would never match anything;
   * what recurs is its day and month, and a window opening in December runs into January - which is
   * why the year is worked out rather than assumed.
   *
   * The `< today` bound is what keeps a pregnancy out. The column holds either a date of birth or an
   * expected delivery date, and only one already passed is a birth.
   */
  BIRTHDAY: {
    key: "BIRTHDAY",
    label: "Birthday",
    match(dateIso, todayIso) {
      if (dateIso >= todayIso) return null;
      const thisYear = Number(todayIso.slice(0, 4));
      let year = thisYear;
      let on = occurrenceOn(dateIso, year);
      // This year's has gone by, so the one being worked is next year's - which is what makes a
      // window opening in December run into January without any special case.
      if (on < todayIso) {
        year = thisYear + 1;
        on = occurrenceOn(dateIso, year);
      }
      // The first birthday and no other. Asked of the occurrence's year, so the December window
      // running into January still picks the child turning one rather than the one turning two.
      if (year - Number(dateIso.slice(0, 4)) !== BIRTHDAY_AGE) return null;
      const days = daysBetween(todayIso, on);
      if (days < BIRTHDAY_DAYS_FROM || days > BIRTHDAY_DAYS_TO) return null;
      return { year, on, days };
    },
    windowSql: (day, year) => `(\`dob_edod_day\` IS NOT NULL AND \`dob_edod_day\` < ${day}
      AND ${birthdayAgeSql(day, year)} = ${BIRTHDAY_AGE}
      AND ${birthdayNextSql(day, year)} BETWEEN DATE_ADD(${day}, INTERVAL ${BIRTHDAY_DAYS_FROM} DAY)
                                            AND DATE_ADD(${day}, INTERVAL ${BIRTHDAY_DAYS_TO} DAY))`,
    yearSql: (day, year) => birthdayYearSql(day, year),
    onSql: (day, year) => birthdayNextSql(day, year),
  },
};

// Newborn first: a delivery is the nearer event, and testing in a stated order means the two can
// never both claim a lead even if the windows were later widened into each other.
const OCCASION_ORDER = ["NEWBORN", "BIRTHDAY"];

/**
 * The occasion this lead is currently being worked for, if any.
 *
 * `null` when there is none - no date stored, or a date that falls in neither window. Otherwise
 * `{ occasion, year, on, days }`: which of the two it is, the year its occurrence is filed under,
 * the day itself, and how many days off it is.
 */
function occasionOccurrence(dateOfBirthOrEdod, today) {
  const stored = isoDay(dateOfBirthOrEdod);
  const day = todayKey(today);
  if (!stored) return null;
  for (const key of OCCASION_ORDER) {
    const matched = OCCASIONS[key].match(stored, day);
    if (matched) return { occasion: key, ...matched };
  }
  return null;
}

/**
 * Which occasion, if any, a status written against this lead belongs to.
 *
 * The single question the write path asks: is this a Qua Qua lead with an occasion open? If it is,
 * the status goes to that occurrence and the lead's own status columns are left exactly as they are.
 */
function occasionContextFor(lead = {}, details = {}, today) {
  const vertical = lead.vertical || details.vertical || "";
  if (!isOccasionVertical(vertical)) return null;
  return occasionOccurrence(lead.dateOfBirthOrEdod || details.dateOfBirthOrEdod, today);
}

/* ────────────────────────────────────────────────────────────── the occurrence row itself ── */

// Held exactly as `sales_crm_lead.status_key` holds it - trimmed and lowercased - so the board can
// compare an occurrence and a lead with the same clause.
function statusKeyOf(status) {
  return String(status || "").trim().toLowerCase();
}

// The follow-up date as a real date, or null. The tabs compare days, and a free-text date they
// cannot parse must not match one rather than match the wrong one.
function followUpDayOf(nextFollowUpDate) {
  const day = isoDay(nextFollowUpDate);
  return day ? new Date(`${day}T00:00:00.000Z`) : null;
}

const occurrenceWhere = (enquiryId, occasion, year) => ({
  enquiryId_occasion_occasionYear: { enquiryId, occasion, occasionYear: year },
});

async function readOccurrence(enquiryId, occasion, year) {
  const id = String(enquiryId || "").trim();
  if (!id || !occasion || !Number.isInteger(year)) return null;
  try {
    return await prisma.salesCrmLeadOccasion.findUnique({ where: occurrenceWhere(id, occasion, year) });
  } catch (error) {
    console.warn("Unable to read the occasion status for a CRM lead:", error?.message || error);
    return null;
  }
}

/**
 * Writes this occasion's status, creating the occurrence the first time one is set.
 *
 * Only the fields the caller named are written, for the same reason `setCrmLeadStatus` works that
 * way: a status change and a follow-up date are offered together but sent independently, and an
 * unnamed field means "leave this as it is" rather than "clear it".
 *
 * Deliberately not pushed to Google Sheets. The sheet's Status column is the lead's status - the
 * record of the last shoot - and writing an occasion's status into it would overwrite that on the
 * one copy this application does not own.
 */
async function writeOccurrence(enquiryId, occasion, year, changes = {}, actor = {}) {
  const id = String(enquiryId || "").trim();
  if (!id || !occasion || !Number.isInteger(year)) return null;

  const patch = {};
  if (changes.status !== undefined) {
    patch.status = String(changes.status || "").trim() || null;
    patch.statusKey = statusKeyOf(changes.status);
  }
  if (changes.cnaSequence !== undefined) {
    patch.cnaSequence = Number(changes.cnaSequence) > 0 ? Math.trunc(Number(changes.cnaSequence)) : 0;
  }
  if (changes.nextFollowUpDate !== undefined) {
    patch.nextFollowUpDate = String(changes.nextFollowUpDate || "").trim() || null;
    patch.followUpDay = followUpDayOf(changes.nextFollowUpDate);
  }
  if (changes.nextFollowUpTime !== undefined) {
    patch.nextFollowUpTime = String(changes.nextFollowUpTime || "").trim() || null;
  }
  if (!Object.keys(patch).length) return readOccurrence(id, occasion, year);

  const actorId = Number(actor?.actorId ?? actor?.userId);
  patch.updatedByUserId = Number.isInteger(actorId) ? actorId : null;

  return prisma.salesCrmLeadOccasion.upsert({
    where: occurrenceWhere(id, occasion, year),
    create: { enquiryId: id, occasion, occasionYear: year, ...patch },
    update: patch,
  });
}

/**
 * What a lead with no occasion open carries.
 *
 * Named, and always sent, so that "this lead is not on an occasion" is a value the client reads
 * rather than an absence it has to infer - a missing key and a false one look the same in a merge,
 * and the board merges a freshly saved lead over the row it already had.
 */
const NO_OCCASION = Object.freeze({
  occasionWindow: false,
  occasionKind: "",
  occasionYear: 0,
  occasionOn: "",
  occasionStatus: "",
  occasionCnaSequence: 0,
  occasionNextFollowUpDate: "",
  occasionNextFollowUpTime: "",
});

// A DATE column comes back from MySQL as a Date; the board works in `YYYY-MM-DD` strings.
function occasionOnText(value) {
  if (!value) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return isoDay(value);
}

/**
 * The occasion fields for one lead, read one lead at a time.
 *
 * For the single-lead paths - opening a lead, saving one - where a round trip is nothing. The board
 * does not use this: it reads the same values as part of its page query, because one lookup per row
 * per page is not the same proposition at all.
 */
async function occasionFieldsFor(lead = {}, details = {}, today) {
  const context = occasionContextFor(lead, details, today);
  if (!context) return { ...NO_OCCASION };
  const row = await readOccurrence(lead.id || details.id || lead.enquiryId, context.occasion, context.year);
  return {
    occasionWindow: true,
    occasionKind: context.occasion,
    occasionYear: context.year,
    occasionOn: context.on,
    occasionStatus: row?.status || "",
    occasionCnaSequence: Number(row?.cnaSequence) > 0 ? Number(row.cnaSequence) : 0,
    occasionNextFollowUpDate: row?.nextFollowUpDate || "",
    occasionNextFollowUpTime: row?.nextFollowUpTime || "",
  };
}

/** The same fields, read off a board row that already selected them. */
function occasionFieldsFromRow(row = {}) {
  if (!Number(row.occasionWindow)) return { ...NO_OCCASION };
  return {
    occasionWindow: true,
    occasionKind: row.occasionKind || "",
    occasionYear: Number(row.occasionYear) || 0,
    occasionOn: occasionOnText(row.occasionOn),
    occasionStatus: row.occasionStatus || "",
    occasionCnaSequence: Number(row.occasionCnaSequence) > 0 ? Number(row.occasionCnaSequence) : 0,
    occasionNextFollowUpDate: row.occasionNextFollowUpDate || "",
    occasionNextFollowUpTime: row.occasionNextFollowUpTime || "",
  };
}

/* ────────────────────────────────────────────────────────────── a whole selection at once ── */

// Ids per statement, matching `STATUS_UPDATE_SLICE` in crmLeadService.js - a bulk status change can
// cover a whole board, and neither the read nor the write may become one statement per lead.
const BULK_SLICE = 1000;

/**
 * Which of these leads have an occasion open, and which one.
 *
 * The question a bulk status change has to ask before it writes: a selection covering a whole board
 * holds occasion leads and ordinary ones together, and the two halves are stored in different
 * places. Answered in slices from the generated `dob_edod_day` column, so it is a handful of
 * statements rather than one per lead.
 */
async function occasionsBeingWorked(enquiryIds, today) {
  const ids = (Array.isArray(enquiryIds) ? enquiryIds : []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!ids.length) return new Map();

  const working = new Map();
  for (let offset = 0; offset < ids.length; offset += BULK_SLICE) {
    const slice = ids.slice(offset, offset + BULK_SLICE);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT \`enquiry_id\` AS \`enquiryId\`, \`vertical\`, \`dob_edod_day\` AS \`dobEdodDay\`
         FROM \`sales_crm_lead\`
        WHERE \`deleted_at\` IS NULL AND \`enquiry_id\` IN (${slice.map(() => "?").join(", ")})`,
      ...slice,
    );
    for (const row of rows) {
      if (!isOccasionVertical(row?.vertical)) continue;
      const stored = row?.dobEdodDay instanceof Date ? row.dobEdodDay.toISOString().slice(0, 10) : row?.dobEdodDay;
      const occurrence = occasionOccurrence(stored, today);
      if (occurrence) working.set(String(row.enquiryId), occurrence);
    }
  }
  return working;
}

/**
 * One change applied to many occasions, a slice per statement.
 *
 * Only the fields a bulk change offers - a status and a next follow-up date - because that is all
 * `setCrmLeadStatus` sends. `writeOccurrence` is the single-lead path and takes the rest.
 *
 * A field the caller did not name is left out of the statement altogether rather than written as
 * null, the same rule `writeOccurrence` follows: Update Details treats a blank field as "leave this
 * as it is", so naming it would clear it across every occurrence in the selection.
 */
async function writeOccurrences(occurrences, changes = {}, actor = {}) {
  const rows = [...(occurrences instanceof Map ? occurrences : new Map(occurrences))];
  if (!rows.length) return 0;

  // Column names are this file's own literals, never anything the caller sent; only the values
  // below them are bound.
  const columns = [];
  if (changes.status !== undefined) {
    const status = String(changes.status || "").trim();
    columns.push({ name: "status", value: status || null });
    columns.push({ name: "status_key", value: statusKeyOf(status) });
  }
  if (changes.nextFollowUpDate !== undefined) {
    const nextFollowUpDate = String(changes.nextFollowUpDate || "").trim();
    columns.push({ name: "next_follow_up_date", value: nextFollowUpDate || null });
    // The occurrence's `follow_up_day` is written, not generated - unlike the lead's - and a date
    // that cannot be parsed stays NULL so the follow-up tabs never match it on a guess.
    columns.push({ name: "follow_up_day", value: isoDay(nextFollowUpDate) || null });
  }
  if (!columns.length) return 0;

  const actorId = Number(actor?.actorId ?? actor?.userId);
  const updatedBy = Number.isInteger(actorId) ? actorId : null;

  const names = columns.map((column) => `\`${column.name}\``).join(", ");
  const assignments = columns.map((column) => `\`${column.name}\` = VALUES(\`${column.name}\`)`).join(",\n         ");
  const placeholders = `(?, ?, ?, ${columns.map(() => "?").join(", ")}, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`;

  let written = 0;
  for (let offset = 0; offset < rows.length; offset += BULK_SLICE) {
    const slice = rows.slice(offset, offset + BULK_SLICE);
    const affected = await prisma.$executeRawUnsafe(
      `INSERT INTO \`sales_crm_lead_occasion\`
         (\`enquiry_id\`, \`occasion\`, \`occasion_year\`, ${names}, \`updated_by_user_id\`, \`created_at\`, \`updated_at\`)
       VALUES ${slice.map(() => placeholders).join(", ")}
       ON DUPLICATE KEY UPDATE
         ${assignments},
         \`updated_by_user_id\` = VALUES(\`updated_by_user_id\`),
         \`updated_at\` = CURRENT_TIMESTAMP(3)`,
      ...slice.flatMap(([enquiryId, occurrence]) => [
        enquiryId, occurrence.occasion, occurrence.year, ...columns.map((column) => column.value), updatedBy,
      ]),
    );
    written += Number(affected || 0);
  }
  return written;
}

/* ───────────────────────────────────────────────────── the same rule, for the board's SQL ── */

/*
 * Written into the statement as literals rather than bound as parameters, and that is a requirement
 * rather than a shortcut: these expressions appear in the SELECT list as well as in the WHERE, and
 * `$queryRawUnsafe` binds by position - a SELECT that pushed a parameter would renumber every one
 * the WHERE clause pushes after it. `todayKey` is what makes that safe: it answers a `YYYY-MM-DD`
 * day or the studio's own, and never the caller's text.
 */
function todaySql(today) {
  return `STR_TO_DATE('${todayKey(today)}', '%Y-%m-%d')`;
}

const todayYear = (today) => Number(todayKey(today).slice(0, 4));

/**
 * The stored birthday moved to a given year.
 *
 * `DATE_ADD ... INTERVAL n YEAR` rather than rebuilding the date from its month and day, because
 * rebuilding turns 29 February into `STR_TO_DATE('2027-02-29')`, which is NULL - and a NULL there
 * drops a leap-year baby out of the tab entirely. `DATE_ADD` lands it on the 28th, which is what
 * `occurrenceOn` above does too.
 */
function birthdayOnSql(year) {
  return `DATE_ADD(\`dob_edod_day\`, INTERVAL (${year} - YEAR(\`dob_edod_day\`)) YEAR)`;
}

// Whether this year's birthday has gone by, which decides whether the one being worked is this
// year's or next year's.
const birthdayPassedSql = (day, year) => `${birthdayOnSql(year)} < ${day}`;

// The date of the birthday being worked.
const birthdayNextSql = (day, year) => `IF(${birthdayPassedSql(day, year)}, ${birthdayOnSql(year + 1)}, ${birthdayOnSql(year)})`;

// The year that birthday falls in - this year's if it is still to come, next year's if it has gone.
const birthdayYearSql = (day, year) => `IF(${birthdayPassedSql(day, year)}, ${year + 1}, ${year})`;

/*
 * Which birthday it is, as a number of years.
 *
 * Off the occurrence's year rather than today's, so that it agrees with `match` above through the
 * December window. `YEAR()` of the stored date rather than of `birthdayNextSql`, because the two
 * differ by nothing but the offset `DATE_ADD` applied and the column is the cheaper of the pair.
 */
const birthdayAgeSql = (day, year) => `(${birthdayYearSql(day, year)} - YEAR(\`dob_edod_day\`))`;

/** Whether this lead is inside one occasion's window - the SQL half of that occasion's `match`. */
function occasionWindowSql(occasion, today) {
  return OCCASIONS[occasion].windowSql(todaySql(today), todayYear(today));
}

/** The year that occasion's occurrence is filed under. */
function occasionYearSql(occasion, today) {
  return OCCASIONS[occasion].yearSql(todaySql(today), todayYear(today));
}

/** The date the occasion falls on. */
function occasionOnSql(occasion, today) {
  return OCCASIONS[occasion].onSql(todaySql(today), todayYear(today));
}

/**
 * One column of this lead's current occurrence of one occasion, or NULL when it has none.
 *
 * A correlated lookup rather than a join. Joining `sales_crm_lead_occasion` would be one pass
 * instead of one lookup per row, but the two tables share `status`, `status_key`, `enquiry_id`,
 * `next_follow_up_date`, `follow_up_day`, `created_at` and `updated_at` between them, so every bare
 * column reference in the board's query - and there are dozens - would become ambiguous at once.
 *
 * The cost is bounded by where it is used: every caller wraps it in the occasion's window, MySQL
 * does not evaluate the false branch of an `IF`, and the lookup itself is a hit on
 * `sales_crm_lead_occasion_lead_key`. So it runs for the leads with an occasion open and no others.
 */
function occasionColumnSql(occasion, today, column) {
  return `(SELECT \`oc\`.\`${column}\` FROM \`sales_crm_lead_occasion\` \`oc\`
            WHERE \`oc\`.\`enquiry_id\` = \`sales_crm_lead\`.\`enquiry_id\`
              AND \`oc\`.\`occasion\` = '${occasion}'
              AND \`oc\`.\`occasion_year\` = ${occasionYearSql(occasion, today)} LIMIT 1)`;
}

/** Whether this lead has *any* occasion open - what puts it back into Yet to connect. */
function anyOccasionWindowSql(today) {
  return `(${OCCASION_ORDER.map((key) => occasionWindowSql(key, today)).join(" OR ")})`;
}

/**
 * `whenWorking(occasion)` for a lead with an occasion open, `otherwise` for every other lead.
 *
 * The shape every override in the board's query takes, named once so that "a lead on an occasion
 * reads its occurrence and nothing else does" is one statement rather than a pattern repeated eight
 * times. The occasions are tested in `OCCASION_ORDER`, so a lead that somehow satisfied both would
 * still read exactly one - and `board` is asked first, so on Dum Dum and Corp this collapses to
 * `otherwise` and no occasion SQL is generated at all.
 */
function occasionOverrideSql(board, today, whenWorking, otherwise) {
  if (!isOccasionVertical(board)) return otherwise;
  return OCCASION_ORDER.reduceRight(
    (fallback, key) => `IF(${occasionWindowSql(key, today)}, ${whenWorking(key)}, ${fallback})`,
    otherwise,
  );
}

module.exports = {
  OCCASION_BRANCH,
  OCCASIONS,
  OCCASION_ORDER,
  NO_OCCASION,
  NEWBORN_DAYS_BEFORE,
  NEWBORN_DAYS_AFTER,
  BIRTHDAY_DAYS_FROM,
  BIRTHDAY_DAYS_TO,
  BIRTHDAY_AGE,
  isOccasionVertical,
  isoDay,
  todayKey,
  studioToday,
  occurrenceOn,
  occasionOccurrence,
  occasionContextFor,
  occasionFieldsFor,
  occasionFieldsFromRow,
  occasionsBeingWorked,
  readOccurrence,
  writeOccurrence,
  writeOccurrences,
  occasionWindowSql,
  occasionYearSql,
  occasionOnSql,
  occasionColumnSql,
  anyOccasionWindowSql,
  occasionOverrideSql,
};
