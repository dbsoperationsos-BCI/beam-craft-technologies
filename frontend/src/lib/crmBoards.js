/**
 * The boards the CRM is read through, and the rule that decides what a row on the fourth may do.
 *
 * Three of the four are the studio's verticals, and they are the lead table. The fourth is Calls,
 * and it is not: it is every call Callyzer has delivered, read out of the call log, one row per
 * call, each under a Call ID of its own.
 *
 * It began as a queue of leads. The webhook turned every delivered call into one and
 * `verticalForCall` refused to guess a vertical for it - "a guessed vertical is worse than an
 * unassigned one: a wedding lead sitting in Qua Qua is invisible to the people who would have
 * called it back" - so the board was the leads with no vertical on them. That cost the studio its
 * enquiry numbering, which ended up counting misdials and wrong numbers, and it meant the board
 * could only ever show the calls nobody had dealt with. A call is now a call: it keeps its Call ID
 * for life, and an Enquiry ID appears against it only when somebody reads the caller and adds them.
 *
 * Here rather than in CRMPage so the rule can be held to account by `node --test`, and so the one
 * place that decides whether a row opens Add Lead or opens a lead is a place a test can read.
 */

import { verticalOptions } from "./crmOptions.js";

export const CALLS_BOARD = "Calls";

/**
 * What that board is called on screen.
 *
 * The value stays `Calls` and the label does not. The board's name is a string three other things
 * are keyed by - `CRM_TABLES` in CRMPage, `BOARD_TABS`, and the `board` parameter the page endpoint
 * takes, which the backend compares against its own spelled-out `"Calls"` - so renaming the value
 * would be renaming a wire format to change a heading. A label is the thing that was actually
 * asked for, and it is the only half a reader ever sees.
 */
export const CALLS_BOARD_LABEL = "Call Box";

/*
 * The boards the header switch offers, in the order they are read.
 *
 * Built here rather than added to `verticalOptions`, which is the canonical list of the studio's
 * three verticals and is read as exactly that by the Meetings table and by the lead form's Vertical
 * radio. Calls is a board, not a vertical: adding it there would offer it as a vertical to assign a
 * lead to, which is the one thing it must never be.
 *
 * The order is the studio's own - Dum Dum, Qua Qua, Corp, then Call Box - and it is the list's
 * meaning rather than an accident of it, so the switch is drawn with `sorted={false}`. Alphabetised,
 * as every other dropdown in the application is, it read Call Box, Corp, Dum Dum, Qua Qua: the
 * queue that feeds the three verticals sat above them, and the vertical most of the studio works
 * was third.
 */
export const boardOptions = [...verticalOptions, { value: CALLS_BOARD, label: CALLS_BOARD_LABEL }];

/**
 * Whether this record is a call nobody has turned into an enquiry yet.
 *
 * It decides one thing: what a double click on a Calls row does. True, and the row opens the Add
 * Lead form on what the call knows, because being read and given a vertical is the only thing left
 * to do to it. False, and it is a lead, and it opens the lead popup.
 *
 * Every call on the board is one of these. The board is the queue of callers nobody has added yet -
 * a call leaves it for the caller's own vertical the moment somebody does, and is read there under
 * that vertical's enquiry id. So this and `isCallRecord` answer the same thing about a Calls row,
 * and are kept apart only because they are asked of different things: this of a row on the Calls
 * board, that of any record anywhere.
 *
 * There was a third state for a while, when the board held every call ever delivered and a row
 * could be a call whose caller had since been added. `leadEnquiryId` on the record is what told
 * them apart. The board is a queue again, so there is nothing left for that field to distinguish.
 *
 * Two fields, and it deliberately does **not** go through `resolveLeadBranch`, which reads
 * `assignedBranch`, the group name and more besides on its way to a Dum Dum fallback - a row is on
 * this board because the server said so, and anything looser here would disagree with it.
 *
 * Takes the record's two halves rather than the flattened row the table draws: by the time a row
 * exists its `vertical` has already been folded onto Dum Dum, which is right for the cell and
 * destroys the very fact this asks about.
 */
export function isUnassignedCall(lead = {}, details = {}) {
  return isCallRecord(lead, details);
}

/**
 * Whether this record is a call at all, rather than a lead.
 *
 * Asked where the question is "which board's fields does this row read under" rather than "what
 * does opening it do" - the info panel, which must not put a wedding's groom and bride over a
 * caller nobody has asked those questions of.
 *
 * A record with no vertical on it and Callyzer as its source. Read off the record's raw halves, not
 * off a table row, because `resolveLeadBranch` has folded a blank vertical onto Dum Dum by then.
 */
export function isCallRecord(lead = {}, details = {}) {
  const source = String(details.source ?? lead.source ?? "").trim().toLowerCase();
  const vertical = String(details.vertical ?? lead.vertical ?? "").trim();
  return source === "callyzer" && !vertical;
}
