/**
 * Each vertical's own pre production questions, described once.
 *
 * The board's columns, the shoot cards, the info panel and the edit form all read these runs, so a
 * field added for a vertical appears in all four by being added here — and the four can never
 * disagree about what Dum Dum asks that Qua Qua does not. The shared questions (times, location,
 * travel, follow-ups) are not here: they are the base field set every vertical keeps.
 *
 * A field is `{ id, label, type }` where `id` is the row's own key (the API returns the superset on
 * every row) and `type` picks the input and the formatting:
 *   toggle    — yes/no
 *   yesno     — a question being chased (the intro calls), asked as a Yes / No radio pair: Yes saves
 *               "Completed" and No "Pending", the values those columns have always kept, and an
 *               unanswered one starts on No
 *   text / textarea / link / date / time — what they say
 */

import { YES_NO_OPTIONS, yesNoField } from "./yesNoField.js";

/** A `yesno` question's pair, kept on the Completed / Pending values so the record and its counting do not change. */
export const PRE_PRODUCTION_PROGRESS_YES_NO = [{ value: "Completed", label: "Yes" }, { value: "Pending", label: "No" }];

/** What a vertical's questions start on when a row has never answered them: a `yesno` starts on No. */
export function preProductionVerticalDefaults(product, row = {}) {
  const run = preProductionVerticalFieldRuns[preProductionVerticalOf(product)] || [];
  return Object.fromEntries(run.filter((field) => field.type === "yesno" && !row[field.id]).map((field) => [field.id, "Pending"]));
}

/*
 * A yes/no question here is the same shape as a yes/no question anywhere else in the application, so it
 * is defined once - in `yesNoField.js` - rather than in the field list of whichever form asked first.
 * These two names are kept as the pre production spelling of it.
 */
export const PRE_PRODUCTION_YES_NO = YES_NO_OPTIONS;
export const preProductionYesNoField = yesNoField;

/** Which field run a project's vertical answers to. Matched loosely — the same branch is written both ways in records of different ages. */
export function preProductionVerticalOf(product) {
  const value = String(product || "").trim().toUpperCase();
  if (["DUM DUM", "WED"].includes(value)) return "dumdum";
  if (["QUA QUA", "QQ"].includes(value)) return "quaqua";
  return "base";
}

/**
 * Read from the project's Client Storage record, never stored on the pre production row — the
 * disc's whereabouts keeps one source of truth. Shown wherever the vertical fields are, read-only.
 */
export const preProductionStorageFields = [
  { id: "receivedTheStorage", label: "Received The Storage", type: "toggle" },
  { id: "storageId", label: "Storage ID", type: "text" },
];

export const preProductionVerticalFieldRuns = {
  // A wedding has two sides, so the intro call is asked once per side.
  dumdum: [
    { id: "groomAddress", label: "Groom Address", type: "textarea", helperText: "The groom's full address, as the family gives it." },
    { id: "brideAddress", label: "Bride Address", type: "textarea", helperText: "The bride's full address, as the family gives it." },
    { id: "introCallGroom", label: "Intro Call - Groom", type: "yesno", helperText: "Yes once the introduction call with the groom's side is done." },
    { id: "introCallBride", label: "Intro Call - Bride", type: "yesno", helperText: "Yes once the introduction call with the bride's side is done." },
    { id: "introCallRemarks", label: "Intro Call Remarks", type: "textarea", helperText: "Anything learned on the intro call that the team should know." },
    { id: "eventScheduleMeeting", label: "Event Schedule Meeting", type: "toggle", helperText: "Yes when a schedule meeting is set; it then asks for its date, time and link." },
    { id: "meetingDate", label: "Meeting Date", type: "date", helperText: "The day of the event schedule meeting with the client." },
    { id: "meetingTime", label: "Meeting Time", type: "time", helperText: "The time the event schedule meeting starts." },
    { id: "meetingLink", label: "Meeting Link", type: "link", helperText: "The online meeting link, if the meeting is held online." },
    { id: "invitationSoftCopy", label: "Get Invitation Soft Copy", type: "toggle", helperText: "Yes when collecting the invitation's soft copy; it then asks for its link." },
    { id: "invitationLink", label: "Invitation Link", type: "link", helperText: "A link to the invitation's soft copy." },
    { id: "gettingDressesImages", label: "Getting Dresses Images", type: "toggle", helperText: "Whether photos of the outfits have been collected from the client." },
    { id: "gettingDecorImages", label: "Getting Decor Images", type: "toggle", helperText: "Whether photos of the decor have been collected." },
    { id: "siteVisit", label: "Site Visit", type: "toggle", helperText: "Whether the team has visited the venue before the shoot." },
    { id: "postWeddingGift", label: "Post Wedding Gift", type: "toggle", helperText: "Whether the post-wedding gift has been taken care of." },
  ],
  // One client, one intro call.
  quaqua: [
    { id: "introCall", label: "Intro Call", type: "yesno", helperText: "Yes once the introduction call with the client is done." },
    { id: "introCallRemarks", label: "Intro Call Remarks", type: "textarea", helperText: "Anything learned on the intro call that the team should know." },
    { id: "gettingDressesImages", label: "Getting Dresses Images", type: "toggle", helperText: "Whether photos of the outfits have been collected from the client." },
  ],
  base: [],
};

const verticalSectionTitles = { dumdum: "Dum Dum Checklist", quaqua: "Qua Qua Checklist" };

/** The vertical's questions as one schema-form section, or null when the vertical adds none. */
export function preProductionVerticalFormSection(product) {
  const vertical = preProductionVerticalOf(product);
  const run = preProductionVerticalFieldRuns[vertical];
  if (!run.length) return null;
  return {
    id: `${vertical}-checklist`,
    title: verticalSectionTitles[vertical],
    fields: run.map((field) => {
      if (field.type === "yesno") return { name: field.id, label: field.label, helperText: field.helperText, type: "radio", options: PRE_PRODUCTION_PROGRESS_YES_NO, props: { variant: "field" } };
      if (field.type === "toggle") return preProductionYesNoField(field.id, field.label, { helperText: field.helperText });
      if (field.type === "textarea") return { name: field.id, label: field.label, helperText: field.helperText, type: "textarea", colSpan: 2 };
      if (field.type === "link") return { name: field.id, label: field.label, helperText: field.helperText, colSpan: 2, placeholder: "https://…", props: { type: "url" } };
      if (field.type === "date" || field.type === "time") return { name: field.id, label: field.label, helperText: field.helperText, type: field.type };
      return { name: field.id, label: field.label, helperText: field.helperText };
    // The meeting details apply once a meeting is being scheduled, and the invitation link once the
    // soft copy is being collected — the same shape the accommodation fields already have.
    }).map((field) => ["meetingDate", "meetingTime", "meetingLink"].includes(field.name)
      ? { ...field, when: (values) => Boolean(values.eventScheduleMeeting) }
      : field.name === "invitationLink"
        ? { ...field, when: (values) => Boolean(values.invitationSoftCopy) }
        : field),
  };
}
