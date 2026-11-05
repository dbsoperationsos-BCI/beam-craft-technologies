"use client";

import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import { normalizeVertical } from "@/lib/crmOptions";

/*
 * One number, one enquiry — within a vertical.
 *
 * The CRM's idea of "the same client" is the last ten digits of their phone number. It is what the
 * Callyzer webhook matches a delivered call on, what the Call Logs tab gathers a client's history
 * by, and what the popup header counts when it says "Enquired : 2 times". Two leads on one number
 * inside one vertical are therefore the same person entered twice, with their calls, their remarks
 * and their follow-ups split across two records that neither knows about - and nothing on either
 * screen says so.
 *
 * ── Refused inside a vertical, allowed across them ──
 *
 * Those are two different situations wearing the same shape, and this dialog is where the
 * difference is said out loud.
 *
 * Inside one vertical there is no reading of a repeated number that is anything but a mistake, so
 * the save does not go through: the dialog offers the enquiry that already exists and nothing else.
 * Across verticals it is not a mistake at all - a wedding client who later books a corporate shoot
 * is one number and two enquiries *on purpose*, different work with a different pipeline and a
 * different team - so the other vertical's enquiry is named and the save goes on.
 *
 * The heading names the vertical the number is *already in*, which is the fact the reader is missing:
 * "already an enquiry" on its own tells them nothing they cannot see, and "in Corp" is what says
 * whether this is a note about another pipeline or a wall in their own.
 */

/** The enquiries in this vertical, and the enquiries elsewhere. */
function splitByVertical(leads, vertical) {
  const here = normalizeVertical(vertical);
  const rows = Array.isArray(leads) ? leads.filter((entry) => entry?.enquiryId) : [];
  // With no vertical to compare against, nothing can be said to clash: every enquiry is "elsewhere"
  // and the dialog warns rather than refuses. The server holds the same rule and is the authority.
  if (!here) return { blocking: [], elsewhere: rows };
  return {
    blocking: rows.filter((entry) => normalizeVertical(entry.vertical) === here),
    elsewhere: rows.filter((entry) => normalizeVertical(entry.vertical) !== here),
  };
}

export default function DuplicateEnquiryDialog({
  phone,
  leads = [],
  /*
   * The vertical the form is about to write into.
   *
   * It decides whether this refuses or only warns - and nothing else. The heading names the vertical
   * that *holds* the number, which is a different question and, on a cross-vertical clash, a
   * different answer.
   */
  vertical = "",
  // What the form is about to do, which is the difference in wording between the two.
  intent = "add",
  onOpenEnquiry,
  onContinue,
  onClose,
}) {
  const { blocking, elsewhere } = splitByVertical(leads, vertical);
  const enquiries = blocking.length ? blocking : elsewhere;
  if (!enquiries.length) return null;

  const single = enquiries.length === 1;
  const first = enquiries[0];
  const blocked = blocking.length > 0;

  /*
   * The vertical named in the heading is the one that *holds* the number, not the one being written
   * into.
   *
   * It was the latter, and on the case this rule exists to distinguish it said the wrong thing
   * outright: editing a Dum Dum lead onto a number that a Corp enquiry has, the heading read "already
   * an enquiry in Dum Dum" over a row plainly labelled Corp. Which is the one fact the reader needs
   * and the one the heading got wrong - Dum Dum is where they are, and where the number already is
   * is the answer to why they are being stopped, or not.
   *
   * Only when the enquiries agree on it. Two of them in different verticals have no single answer,
   * and a heading that picked the first would be making the same mistake again, quietly; the rows
   * below say it per enquiry, which is where it belongs when they differ.
   */
  const verticals = [...new Set(enquiries.map((entry) => normalizeVertical(entry.vertical)).filter(Boolean))];
  const holder = verticals.length === 1 ? verticals[0] : "";

  return <Dialog
    // "This number is already an enquiry in Corp": what was found, and where it already is.
    title={`This number is already an enquiry${holder ? ` in ${holder}` : ""}`}
    /*
     * One line.
     *
     * This used to run to three, explaining what "one number, one enquiry" means and why the CRM
     * gathers a client's history by number. All of it true, none of it what somebody stopped
     * mid-save is reading for: they want the enquiry id, and they want to know whether they may go
     * on. The reasoning belongs in the code, which is where it now is.
     */
    description={
      single
        ? `${phone || "That number"} is on ${first.enquiryId}.`
        : `${phone || "That number"} is on ${enquiries.length} enquiries.`
    }
    size="md"
    /*
     * Above the panel that opened it. Add Lead and the lead popup are both full-screen surfaces of
     * their own, and a dialog raised from inside one has to clear it - `dialog` alone would put this
     * behind the form it is warning about.
     */
    layer="dialogOverPanel"
    onClose={onClose}
    footer={<>
      {/*
        * Going on is offered only when the clash is in another vertical.
        *
        * Inside this one the save is refused, and the button is *absent* rather than present and
        * failing: the server answers 409 either way, and offering a button whose only outcome is an
        * error is worse than not offering it - it reads as a choice the reader has, which it is not.
        *
        * Even across verticals it is the quiet half of the pair. The enquiry that exists is what
        * somebody almost always wants, so it is the primary and it is named - a button reading
        * "Open" says nothing about where it goes, and this one goes to a record they have not seen.
        */}
      {!blocked && onContinue && (
        <Button type="button" onClick={onContinue}>
          {intent === "edit" ? "Save anyway" : "Add anyway"}
        </Button> 
      )}
      <Button type="button" variant="primary" onClick={() => onOpenEnquiry?.(first.enquiryId)}>
        Open {first.enquiryId}
      </Button>
    </>}
  >
    <ul className="space-y-2 pb-1">
      {enquiries.map((entry) => (
        <li key={entry.enquiryId}>
          {/*
            * One row per enquiry, and every field on it is one the reader needs to tell "this is
            * the same client" from "this is somebody else on a shared line": who it is filed
            * under, which vertical works it, where it has got to, who it is assigned to, and when it
            * came in.
            */}
          <button
            type="button"
            onClick={() => onOpenEnquiry?.(entry.enquiryId)}
            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50/60"
          >
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-medium text-slate-800">{entry.enquiryId}</span>
              {entry.name && <span className="text-sm text-slate-600">· {entry.name}</span>}
            </span>
            <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              {entry.vertical && <span>{entry.vertical}</span>}
              {entry.status && <span>{entry.status}</span>}
              {/* Who to talk to before touching it - and "Not assigned" says it is free to pick up. */}
              <span className="font-medium text-slate-700">
                {entry.assignedTo ? `Assigned to ${entry.assignedTo}` : "Not assigned"}
              </span>
              {entry.enquiryDate && <span>Enquired {entry.enquiryDate}</span>}
              {entry.nextFollowUpDate && <span>Follow-up {entry.nextFollowUpDate}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  </Dialog>;
}

export { splitByVertical };
