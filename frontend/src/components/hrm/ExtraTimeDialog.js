"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import TextAreaField from "@/components/shared/TextAreaField";
import Dialog from "@/components/ui/Dialog";
import { getMyAttendanceApprovers, sendExtraTime } from "@/services/hrm/attendance.service";

/**
 * **Log out late**: the logout for a day whose login passed its 18 hours.
 *
 * The 18 hours used to refuse the logout, which lost the time worked past them and left the person
 * to go and raise a correction by hand. Pressing it here sends the request itself - the day, the
 * time it is pressed and the words typed below - so nothing further is asked of them.
 *
 * What it says before they send is the point of the dialog: the day **stays Absent** until the
 * approver answers, and reads **Present** once they do. The approver is named where the server
 * knows one (`GET /requests/approvers`), because "sent for approval" without a name is the part
 * people come back and ask about.
 *
 * `day` is the row the "needs attention" banner drew (`{ date, loginAt }`); `dayLabel` and
 * `loginLabel` are that banner's own words for them, so the two say the same thing.
 */
export default function ExtraTimeDialog({ day, dayLabel, loginLabel, onClose, onSent, onError }) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  const [approver, setApprover] = useState({ name: "", read: false });

  useEffect(() => {
    let current = true;
    getMyAttendanceApprovers()
      .then((response) => {
        if (!current) return;
        const [first] = response?.data?.EXTRA_TIME || [];
        setApprover({ name: first?.employeeName || "", read: true });
      })
      .catch(() => { if (current) setApprover({ name: "", read: true }); });
    return () => { current = false; };
  }, []);

  async function send(event) {
    event.preventDefault();
    const words = reason.trim();
    // Asked for rather than optional: the approver is being asked to accept a day's worth of hours
    // nobody captured a logout for, and "no reason given" is not something to decide on.
    if (!words) { setProblem("Say why you are logging out late."); return; }
    setSaving(true);
    setProblem("");
    try {
      const response = await sendExtraTime({ date: day.date, reason: words });
      onSent?.(response?.message || "Your extra time is with your approver.");
      onClose();
    } catch (error) {
      const said = error?.data?.message || error?.message || "Unable to send your extra time for approval.";
      // An approver nobody has set, or a day already asked about: the panel says it rather than the page.
      setProblem(said);
      onError?.(said);
    } finally {
      setSaving(false);
    }
  }

  return <Dialog
    title="Log out late"
    description={`${dayLabel} - you logged in at ${loginLabel} and did not log out within 18 hours.`}
    onClose={onClose}
    busy={saving}
    onSubmit={send}
    footer={<>
      <Button type="button" size="lg" onClick={onClose} className="font-semibold">Cancel</Button>
      <Button type="submit" variant="primary" size="lg" disabled={saving} className="font-semibold">
        {saving ? "Sending..." : "Log out and send"}
      </Button>
    </>}
  >
    <div className="space-y-3 pb-2">
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:text-sm">
        Logging out now sends the extra time you worked to {approver.name ? <span className="font-semibold">{approver.name}</span> : "your Permission Approver"} for approval.
        This day stays <span className="font-semibold">Absent</span> until it is approved, and then reads <span className="font-semibold">Present</span>.
      </p>
      {approver.read && !approver.name && <p className="text-xs text-amber-700">
        No Permission Approver is set on your employee record, so there is nobody to answer this. Ask HR to set one.
      </p>}
      <TextAreaField
        label="Why are you logging out late?"
        required
        rows={4}
        value={reason}
        onChange={(event) => { setReason(event.target.value); setProblem(""); }}
        error={problem}
        helperText="Your approver reads this before deciding, so say what kept you past your hours."
        disabled={saving}
      />
    </div>
  </Dialog>;
}
