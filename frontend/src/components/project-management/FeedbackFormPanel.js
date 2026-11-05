"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import RecordSummaryCard from "@/components/shared/RecordSummaryCard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import useFormErrors from "@/components/shared/useFormErrors";
import { FEEDBACK_REVIEW_FIELDS, ISSUE_REVIEWS, feedbackSections, projectDescriptionRows, shootCompletionSections } from "@/constants/feedbackConfig";
import { personOption } from "@/lib/employeeAvatar.mjs";
import { getFeedbackAssignees, getFeedbackShootPeople, getProjectFeedbackOptions } from "@/services/project-management/feedback.service";

// The review, its Assign to (asked only for Average or Poor) and the feedback - and, for a shoot,
// the people the client appreciates or is not satisfied with.
const EMPTY = { review: "", reviewAssignee: "", feedback: "", appreciatedEmployeeIds: [], notSatisfiedEmployeeIds: [] };

/**
 * The shoot's people as one list of options: each person once, named with the areas they worked in
 * ("Mukesh K · Pre Production, Production"), with their face. The value is the employee's id as
 * text, which is what the multi-select holds; it goes back to a number when saved.
 */
function peopleOptions(areas) {
  const people = new Map();
  for (const { label, people: list } of Array.isArray(areas) ? areas : []) {
    for (const person of list || []) {
      const entry = people.get(person.id) || { person, areas: [] };
      entry.areas.push(label);
      people.set(person.id, entry);
    }
  }
  return [...people.values()]
    .sort((a, b) => a.person.employeeName.localeCompare(b.person.employeeName))
    .map(({ person, areas: worked }) => personOption(person, `${person.employeeName} · ${worked.join(", ")}`, String(person.id)));
}

/**
 * Project Management → Customer Issues and Feedback's **Give Feedback** form: one project waiting for
 * its New Project Feedback or its Overall Feedback, or one of its shoots waiting for its Shoot
 * Completion Feedback, stated in the card Cash Spent shows (`RecordSummaryCard`) rather than picked
 * from a list. It asks for a Review and the Feedback, and, for an Average or Poor review, who
 * to Assign it to as a task. A shoot's also asks for **Appreciation** and **Not Satisfied** -
 * multi-selects of the people who worked on that shoot (`GET /feedback/projects/:id/people`), never
 * the same person in both.
 *
 * The reviews, the shoot's people and the people who can be assigned come from the server, so what
 * is offered is what it accepts. `onSubmit` receives `{ projectId, stage, shootId?, review, feedback,
 * assignees, appreciatedEmployeeIds?, notSatisfiedEmployeeIds? }` and returns a promise; a
 * refusal is shown on this form, beside what it is about, rather than in a notice on the page underneath.
 */
export default function FeedbackFormPanel({ project, busy, onClose, onSubmit }) {
  const forShoot = project.stage === "SHOOT_COMPLETION" && Boolean(project.shootKey);
  const [values, setValues] = useState(EMPTY);
  // `failed` is a list that never arrived, which is not the same as one that came back empty.
  const [options, setOptions] = useState({ reviews: [], people: [], assignees: [], loading: true, failed: false });
  const [error, setError] = useState("");
  // Feedback of only spaces passes the panel's own required check, so it is marked here.
  const fields = useFormErrors();

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      Promise.all([
        getProjectFeedbackOptions(),
        forShoot ? getFeedbackShootPeople(project.projectKey, project.shootKey) : Promise.resolve(null),
        // Not fatal: a form whose reviews are all good needs nobody, so a list that fails to load leaves
        // Assign to empty (and says so) rather than blocking the whole form.
        getFeedbackAssignees().catch(() => null),
      ])
        .then(([optionsResponse, peopleResponse, assigneesResponse]) => {
          if (!live) return;
          const reviews = optionsResponse?.data?.reviews;
          // Who an Average or Poor review can be given to, by login, with their faces.
          const assignees = (Array.isArray(assigneesResponse?.data) ? assigneesResponse.data : [])
            .map((user) => personOption({ ...user, employeeName: user.name }, user.name, String(user.id)));
          setOptions({ reviews: Array.isArray(reviews) ? reviews : [], people: peopleOptions(peopleResponse?.data), assignees, loading: false, failed: false });
        })
        .catch((requestError) => {
          if (!live) return;
          setOptions({ reviews: [], people: [], assignees: [], loading: false, failed: true });
          setError(`${requestError?.data?.message || requestError?.message || "Unable to load the form."} Close this form and try again.`);
        });
    }, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [forShoot, project.projectKey, project.shootKey]);

  const change = useCallback((name, value) => {
    setValues((current) => ({ ...current, [name]: value }));
    setError("");
    fields.clear(name);
  }, [fields]);

  // Anything chosen or written counts as work worth asking about before it is thrown away.
  const dirty = Object.values(values).some((value) => (Array.isArray(value) ? value.length : String(value || "").trim()));
  const { guard, confirmProps } = useUnsavedGuard(dirty, { message: "Go back if you want to save this feedback." });
  const close = () => { if (!busy) guard(onClose); };

  const context = useMemo(() => ({
    reviews: options.reviews,
    people: options.people,
    assignees: options.assignees,
    renderers: {
      projectDescription: () => <RecordSummaryCard rows={projectDescriptionRows(project)} />,
    },
  }), [options.reviews, options.people, options.assignees, project]);

  /** Feedback of only spaces, said by its field before anything is sent. */
  function problems() {
    return values.feedback.trim() ? {} : { feedback: "Write the feedback." };
  }

  function payload() {
    // Who an Average or Poor review is given to; a review rated better needs nobody.
    const assignees = Object.fromEntries(FEEDBACK_REVIEW_FIELDS
      .filter(([, review]) => ISSUE_REVIEWS.includes(values[review]))
      .map(([key, , assignee]) => [key, Number(values[assignee])]));
    const ids = (list) => (list || []).map(Number).filter(Number.isInteger);
    // Which of the project's feedbacks it is - and, for a shoot's, the shoot.
    return {
      projectId: project.projectKey,
      stage: project.stage || "NEW_PROJECT",
      ...(project.shootKey ? { shootId: project.shootKey } : {}),
      review: values.review,
      feedback: values.feedback.trim(),
      assignees,
      // Only a shoot's feedback names people.
      ...(forShoot ? { appreciatedEmployeeIds: ids(values.appreciatedEmployeeIds), notSatisfiedEmployeeIds: ids(values.notSatisfiedEmployeeIds) } : {}),
    };
  }

  function submit(event) {
    event.preventDefault();
    if (!fields.check(problems())) return;
    Promise.resolve(onSubmit(payload()))
      .catch((requestError) => setError(requestError?.data?.message || requestError?.message || "Unable to save the feedback."));
  }

  return <>
    <SchemaFormPanel
      title="Give Feedback"
      description={`${project.stageLabel || "New Project Feedback"}: Rate ${[project.projectName, project.eventId && `(${project.eventId})`, project.shootCode && `- shoot ${project.shootCode}`].filter(Boolean).join(" ") || "this project"} and say how it went?`}
      sections={forShoot ? shootCompletionSections : feedbackSections}
      values={values}
      onChange={change}
      errors={fields.errors}
      context={context}
      sidebarAriaLabel="Feedback form sections"
      closeAriaLabel="Close feedback form"
      onClose={close}
      onSubmit={submit}
      error={error || fields.summary}
      saving={busy}
      loading={options.loading}
      loadingLabel="Loading the form..."
      submitLabel="Save Feedback"
      savingLabel="Saving..."
      submitDisabled={options.failed}
    />
    <ConfirmDialog {...confirmProps} layer="dialogOverPanel" />
  </>;
}
