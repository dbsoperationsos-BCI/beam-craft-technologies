"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import TextAreaField from "@/components/shared/TextAreaField";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import useFormErrors from "@/components/shared/useFormErrors";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { ISSUE_REVIEWS } from "@/constants/feedbackConfig";
import { personOption } from "@/lib/employeeAvatar.mjs";
import { getFeedbackAssignees, getProjectFeedbackOptions } from "@/services/project-management/feedback.service";

/*
 * Customer Issues and Feedback → the ticked rows → Give Feedback: one review and one feedback, given
 * to every ticked project or shoot waiting for it - the same as Give Feedback on each in turn, and
 * saved that way, one at a time, so each keeps its own checks, version and task (`onSubmit`).
 *
 * What a single feedback asks that belongs to one shoot alone - who was appreciated and who was not -
 * is not asked here; give a shoot's feedback on its own to name them. Average or Poor asks who sorts
 * it out, as the single form does, and every one of them becomes a task for that person.
 */

export default function FeedbackBulkDialog({ count, busy = false, progress = null, onClose, onSubmit }) {
  const [values, setValues] = useState({ review: "", assignee: "", feedback: "" });
  const [options, setOptions] = useState({ reviews: [], assignees: [], loading: true });
  const [error, setError] = useState("");
  const fields = useFormErrors();
  const change = (name, value) => { setValues((current) => ({ ...current, [name]: value })); setError(""); fields.clear(name); };
  const issue = ISSUE_REVIEWS.includes(values.review);
  // Typed and not given yet: leaving asks first.
  const dirty = Boolean(values.review || values.assignee || values.feedback.trim());
  const { guard, confirmProps } = useUnsavedGuard(dirty, { message: "Go back if you want to give this feedback." });
  const close = () => { if (!busy) guard(onClose); };

  useEffect(() => {
    let live = true;
    Promise.all([getProjectFeedbackOptions(), getFeedbackAssignees().catch(() => null)])
      .then(([optionsResponse, assigneesResponse]) => {
        if (!live) return;
        const reviews = Array.isArray(optionsResponse?.data?.reviews) ? optionsResponse.data.reviews : [];
        const assignees = (Array.isArray(assigneesResponse?.data) ? assigneesResponse.data : [])
          .map((user) => personOption({ ...user, employeeName: user.name }, user.name, String(user.id)));
        setOptions({ reviews, assignees, loading: false });
      })
      .catch((requestError) => {
        if (!live) return;
        setOptions({ reviews: [], assignees: [], loading: false });
        setError(`${requestError?.data?.message || requestError?.message || "Unable to load the form."} Close this and try again.`);
      });
    return () => { live = false; };
  }, []);

  function submit(event) {
    event?.preventDefault?.();
    if (!fields.check({
      review: values.review ? "" : "Choose the review.",
      assignee: issue && !values.assignee ? "Choose who sorts it out." : "",
      feedback: values.feedback.trim() ? "" : "Write the feedback.",
    })) return;
    // Rows refused come back as an error, said here; what was typed stays, for the rows still ticked.
    Promise.resolve(onSubmit({ review: values.review, feedback: values.feedback.trim(), ...(issue ? { assignees: { REVIEW: Number(values.assignee) } } : { assignees: {} }) }))
      .catch((requestError) => setError(requestError?.message || "Unable to give the feedback."));
  }

  const reviewOptions = options.reviews.map((review) => (typeof review === "object" ? review : { value: review, label: review }));

  return <><Dialog
    title={`Give Feedback - ${count} ${count === 1 ? "item" : "items"}`}
    description="The same review and feedback, given to each ticked project or shoot."
    busy={busy}
    onClose={close}
    onSubmit={submit}
    footer={<>
      <Button type="button" variant="secondary" onClick={close} disabled={busy}>Discard</Button>
      {/* Nothing to choose a review from, nothing to give - closed and opened again, it reloads. */}
      <Button type="submit" variant="primary" busy={busy} busyLabel={progress ? `Saving ${progress.done} of ${progress.of}...` : "Saving..."} disabled={options.loading || !options.reviews.length || !count}>Give Feedback</Button>
    </>}
  >
    <div className="flex flex-col gap-4">
      <Dropdown
        label="Review"
        required
        helperText="How the client rated it; Average or Poor opens an issue to sort out."
        ariaLabel="Review"
        placeholder={options.loading ? "Loading..." : "Select a review"}
        options={reviewOptions}
        value={values.review}
        onChange={(value) => change("review", value)}
        error={fields.errors.review}
        sorted={false}
        searchable={false}
      />
      {/* Average or Poor is an issue: somebody sorts it out, and gets each one as a task. */}
      {issue && <Dropdown
        label="Assign to"
        required
        helperText="The person who gets a task to sort out each issue."
        ariaLabel="Assign to"
        placeholder="Who sorts this out?"
        options={options.assignees}
        value={values.assignee}
        onChange={(value) => change("assignee", value)}
        error={fields.errors.assignee}
      />}
      <TextAreaField
        label="Feedback"
        required
        helperText="What the client said, saved against every ticked project or shoot."
        rows={5}
        maxLength={5000}
        value={values.feedback}
        onChange={(event) => change("feedback", event.target.value)}
        error={fields.errors.feedback}
      />
      <p className="text-xs text-slate-500 sm:text-sm">Who was appreciated or not on a shoot is not asked here - give that shoot&rsquo;s feedback on its own to name them.</p>
      {(error || fields.summary) && <p role="alert" className="text-sm text-red-600">{error || fields.summary}</p>}
    </div>
  </Dialog>
  <ConfirmDialog {...confirmProps} layer="confirmOverDialog" /></>;
}
