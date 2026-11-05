// Branches are no longer a hardcoded code list: the generator loads the `locations` master data,
// which the server narrows to the branches the caller's roles reach.
export const quaQuaEvents = ["Medical Record Imaging", "Monthly Baby Growth Tracking", "First Smile, First Steps", "Birthday", "Report Card / Achievement Documentation", "Graduation / Convocation", "Social Media Profile Photos", "Headshots", "Branding", "Family Portraits", "School Events", "Car Purchase", "Maternity", "Baby Shower", "Newborn", "Fresh 24", "Toddler", "Matrimony", "Naming Ceremony", "Milestone", "Tonsure", "Ear Piercing", "Pre-Birthday", "Baptism", "Annaprasanam", "Cradle Ceremony", "Housewarming", "Puberty", "Cake Smash", "Milk Bath", "Portfolio", "Property Documentation", "Funeral", "Legal Proof", "Insurance Claims", "Medical Records", "Fashion", "Advertisement", "E-commerce", "Real Estate"];

export function formatGroupDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date).replaceAll(" ", "-");
}

export function derivedVertical(groupType) {
  return groupType === "Dum Dum" ? "WED" : groupType === "Qua Qua" ? "QQ" : "CORP";
}

// The names on the screens, against the codes stored on a project. Same pairing as
// `backend/src/services/salesVertical.js`, which is what writes the codes down.
export const VERTICAL_LABELS = { WED: "Dum Dum", QQ: "Qua Qua", CORP: "Corp" };

/*
 * The **short** code a person reads, against the code stored on a project.
 *
 * Dum Dum is stored as `WED`, and that spelling belongs to one place: the WhatsApp group name,
 * which is what the studio types into WhatsApp and has to keep reading "WED". Everywhere the
 * vertical is shown as a fact *about* a project it is **DD**, which is what the studio calls it -
 * "WED" in a Vertical column is an internal code leaking onto a screen.
 *
 * Kept beside `VERTICAL_LABELS` because it is the same pairing at a different length: the long name
 * for a picker and a record, the short one for a column that has to stay narrow.
 */
export const VERTICAL_CODES = { WED: "DD", QQ: "QQ", CORP: "Corp" };

/** The short code a person reads, from a stored code. Blank when there is no vertical at all. */
export function verticalCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return VERTICAL_CODES[raw.toUpperCase()] || raw;
}

/** The vertical a person reads, from a code or a name. Blank when there is no vertical at all. */
export function verticalLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return VERTICAL_LABELS[raw.toUpperCase()] || raw;
}

/*
 * The date is asked for only when the studio says it knows it.
 *
 * A group is often opened before the couple have fixed the day, and the generator used to insist on
 * a date anyway - the field told people to "enter approximate date if not known", which put a made-up
 * day into a group name that then travelled to WhatsApp as fact. Main Event Date Known off means the name
 * simply carries no date, and there is nothing to require.
 */
export function groupNameRequirements(form) {
  const eventDate = form.mainEventDateKnown ? [["mainEventDate", "Main Event Date"]] : [];
  if (form.groupType === "Dum Dum") return [["enquiryId", "Enquiry ID"], ["tier", "Tier"], ["branch", "Branch"], ["groomName", "Groom Name"], ["brideName", "Bride Name"], ["socialMediaPosting", "Social Media Posting"], ["place", "Place"], ...eventDate];
  if (form.groupType === "Qua Qua") return [["enquiryId", "Enquiry ID"], ["branch", "Branch"], ["clientName", "Client Name"], ["eventName", "Event"], ["socialMediaPosting", "Social Media Posting"], ["houseType", "House Type"], ["gou", "GOU"], ["place", "Place"], ...eventDate];
  return [["enquiryId", "Enquiry ID"], ["branch", "Branch"], ["clientName", "Client Name"], ["place", "Place"], ...eventDate];
}

export function hasValue(value) {
  return value === true || value === false || String(value || "").trim().length > 0;
}

export function buildGroupName(form) {
  if (groupNameRequirements(form).some(([field]) => !hasValue(form[field]))) return "";
  // An unknown date is no date: every format drops the segment rather than leaving an empty one,
  // so a name never ends in a dangling separator.
  const date = form.mainEventDateKnown ? formatGroupDate(form.mainEventDate) : "";
  if (form.groupType === "Dum Dum") {
    const head = ["WED", form.tier.trim(), form.branch, form.offerName?.trim(), `${form.groomName.trim()} & ${form.brideName.trim()}`].filter(Boolean).join(" ");
    return [head, form.socialMediaPosting, form.place.trim(), date].filter(Boolean).join(" | ");
  }
  if (form.groupType === "Qua Qua") {
    const details = [`QQ${form.branch}`, form.offerName?.trim(), form.clientName.trim()].filter(Boolean).join(" ");
    return [details, form.eventName, form.socialMediaPosting, form.houseType, form.gou === "Yes" ? "GOU" : null, form.place.trim(), date].filter(Boolean).join(" | ");
  }
  return [["CORP", form.branch, form.offerName?.trim(), form.clientName.trim()].filter(Boolean).join(" "), form.place.trim(), date].filter(Boolean).join(" | ");
}

export function toInputDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
