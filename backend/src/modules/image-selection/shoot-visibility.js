// A Project Management shoot joins the Image Selection workspace only after its day: there are no
// photos to work with before the shoot has happened, so a Wedding dated 20 Aug appears — root
// folder and selection items alike — from 21 Aug, while a Pre Wedding already shot is not held
// back waiting on it. "After the shoot date" is the calendar day following the day the date was
// stored as (the Add Shoot form stores its Date field at midnight UTC). A shoot with no date, or
// an unreadable one, is never held back — hiding work over a missing field would be worse than
// showing it a day early.
function shootDayHasPassed(dateValue, now = new Date()) {
  /*
   * No date means the shoot has not been scheduled, so its day cannot have passed.
   *
   * This used to answer `true`, back when a shoot could not be saved without a date and an empty
   * value only ever meant "the shoot relation was not loaded". A shoot may now be added before its
   * date is fixed, and answering `true` would open its folders and selection items the moment it
   * was created - months before the shoot. Callers that ask about a *possibly absent shoot* have to
   * say so themselves rather than leaning on this; see `buildSources` in `deliverables/service.js`.
   */
  if (!dateValue) return false;
  const date = new Date(dateValue);
  // A date nobody can parse is different: that is broken data rather than an unscheduled shoot, and
  // holding the folder back for ever would leave no way to reach it.
  if (Number.isNaN(date.getTime())) return true;
  const nextDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return now.getTime() >= nextDay;
}

module.exports = { shootDayHasPassed };
