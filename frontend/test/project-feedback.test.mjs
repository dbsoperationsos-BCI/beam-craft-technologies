import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { FEEDBACK_TEMPLATE_KEYS, feedbackMessage, feedbackTemplateKey, socialLinksText } from "../src/lib/feedbackMessage.mjs";
import { DEFAULT_FEEDBACK_STATUS, FEEDBACK_STATUSES, feedbackSections, feedbackStatusOf, projectDescriptionRows } from "../src/constants/feedbackConfig.js";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const PAGE = read("components", "project-management", "FeedbackPage.js");
const PANEL = read("components", "project-management", "FeedbackFormPanel.js");

// A waiting project as the Yet to be done tab holds it (`GET /feedback/pending`).
const project = {
  id: "project:ck-project:NEW_PROJECT",
  pending: true,
  projectKey: "ck-project",
  eventId: "EV-0007",
  eventDate: "2026-09-14T00:00:00.000Z",
  projectName: "WED Priya & Arjun",
  clientName: "Priya & Arjun",
  projectStatus: "Ongoing",
  branch: "Erode TN",
  crmName: "Priya Nandini",
};
const fields = Object.fromEntries(feedbackSections.flatMap((section) => section.fields).map((field) => [field.name, field]));

test("Give Feedback states the project and asks only for a review and the feedback - no project to pick", () => {
  assert.deepEqual(Object.keys(fields), ["projectDescription", "review", "reviewAssignee", "feedback"]);
  assert.equal(fields.projectDescription.type, "custom");
  assert.equal(fields.review.label, "Review");
  assert.equal(fields.feedback.label, "Feedback");
  assert.equal(fields.review.required, true);
  assert.equal(fields.feedback.required, true);
  assert.equal(fields.feedback.type, "textarea");
  assert.deepEqual(fields.review.options({}, { reviews: ["Excellent", "Good", "Average", "Poor"] }).map((option) => option.label), ["Excellent", "Good", "Average", "Poor"]);
  assert.equal(fields.review.props.sorted, false);
});

test("the card states the project's Project Description, as Cash Spent does - and a shoot's, for its feedback", () => {
  assert.deepEqual(projectDescriptionRows(project), [
    ["Event ID", "EV-0007"],
    ["Project", "WED Priya & Arjun"],
    ["Client Name", "Priya & Arjun"],
    ["Project Status", "Ongoing"],
    ["Main Event Date", "14 Sept 2026"],
    ["Branch", "Erode TN"],
    ["CRM", "Priya Nandini"],
  ]);
  // An undated project leaves its date empty for the card's dash.
  assert.equal(projectDescriptionRows({ ...project, eventDate: null })[4][1], "");
  assert.deepEqual(projectDescriptionRows(null), []);
  // A shoot waiting for its Shoot Completion Feedback adds the shoot after the project.
  const shoot = { ...project, shootKey: "ck-shoot", shootCode: "DBS-SID-DD-ERD-000008", shootName: "Reception", shootDate: "2026-10-10T00:00:00.000Z" };
  assert.deepEqual(projectDescriptionRows(shoot).slice(7), [["Shoot ID", "DBS-SID-DD-ERD-000008"], ["Shoot", "Reception"], ["Shoot Date", "10 Oct 2026"]]);
  assert.match(PANEL, /<RecordSummaryCard rows=\{projectDescriptionRows\(project\)\} \/>/);
  // The form names the project the reviewer is rating, by its name and Event ID.
  assert.match(PANEL, /description=\{`\$\{project\.stageLabel \|\| "New Project Feedback"\}: Rate \$\{\[project\.projectName, project\.eventId && `\(\$\{project\.eventId\}\)`, project\.shootCode && `- shoot \$\{project\.shootCode\}`\]/);
});

test("there is no page-level Add Feedback; the form is for the project it was opened from", () => {
  assert.doesNotMatch(PAGE, />Add Feedback</);
  assert.doesNotMatch(PAGE, /actions=\{canWrite/);
  assert.match(PAGE, /\{adding && canWrite && <FeedbackFormPanel project=\{adding\}/);
  // The project is the row's, never picked: the form sends its key with the review.
  // Which feedback it is, and a shoot's row sends its shoot too.
  assert.match(PANEL, /projectId: project\.projectKey,\s+stage: project\.stage \|\| "NEW_PROJECT",\s+\.\.\.\(project\.shootKey \? \{ shootId: project\.shootKey \} : \{\}\),\s+review: values\.review,\s+feedback: values\.feedback\.trim\(\),\s+assignees,/);
  assert.match(PANEL, /Promise\.resolve\(onSubmit\(payload\(\)\)\)/);
  assert.doesNotMatch(PANEL, /projects:|shoots:/);
});

test("only the New Project Feedback is asked for: the later stages' forms are gone", async () => {
  const config = await import("../src/constants/feedbackConfig.js");
  assert.equal(config.productionCompletionSections, undefined);
  assert.equal(config.projectCompletedSections, undefined);
  const SERVICE = read("services", "project-management", "feedback.service.js");
  assert.deepEqual([...SERVICE.matchAll(/export function (\w+)/g)].map((match) => match[1]), ["getProjectFeedback", "getPendingFeedbackProjects", "getFeedbackAssignees", "getProjectFeedbackOptions", "getFeedbackShootPeople", "createProjectFeedback", "createProjectFeedbackMany", "sendFeedbackWhatsApp", "setFeedbackIssueStatus"]);
  assert.doesNotMatch(PANEL, /PRODUCTION_COMPLETION|PROJECT_COMPLETED|getFeedbackProjectPeople/);
  assert.doesNotMatch(PAGE, /heldForNextStage/);
});

test("a shoot's feedback asks Appreciation and Not Satisfied, from the people who worked on that shoot", async () => {
  const { shootCompletionSections } = await import("../src/constants/feedbackConfig.js");
  // The review and feedback every feedback asks, then the two lists.
  assert.deepEqual(shootCompletionSections.map((section) => section.title), ["Feedback", "Appreciation", "Not Satisfied"]);
  const shootFields = Object.fromEntries(shootCompletionSections.flatMap((section) => section.fields).map((field) => [field.name, field]));
  assert.equal(shootFields.appreciatedEmployeeIds.type, "multiselect");
  assert.equal(shootFields.notSatisfiedEmployeeIds.type, "multiselect");
  // Somebody chosen in one list is not offered in the other.
  const people = [{ value: "1", label: "Arun" }, { value: "2", label: "Mukesh" }];
  assert.deepEqual(shootFields.appreciatedEmployeeIds.options({ notSatisfiedEmployeeIds: ["2"] }, { people }), [people[0]]);
  assert.deepEqual(shootFields.notSatisfiedEmployeeIds.options({ appreciatedEmployeeIds: ["1"] }, { people }), [people[1]]);
  // Only on a shoot's form: its people are loaded for that shoot, and sent as numbers.
  assert.match(PANEL, /const forShoot = project\.stage === "SHOOT_COMPLETION" && Boolean\(project\.shootKey\);/);
  assert.match(PANEL, /forShoot \? getFeedbackShootPeople\(project\.projectKey, project\.shootKey\) : Promise\.resolve\(null\),/);
  assert.match(PANEL, /sections=\{forShoot \? shootCompletionSections : feedbackSections\}/);
  assert.match(PANEL, /\.\.\.\(forShoot \? \{ appreciatedEmployeeIds: ids\(values\.appreciatedEmployeeIds\), notSatisfiedEmployeeIds: ids\(values\.notSatisfiedEmployeeIds\) \} : \{\}\),/);
  assert.match(read("services", "project-management", "feedback.service.js"), /\/api\/project-management\/feedback\/projects\/\$\{encodeURIComponent\(projectId\)\}\/people\?shootId=\$\{encodeURIComponent\(shootId\)\}/);
  // Read back after the words, in the info panel and View.
  const { SHOOT_COMPLETION_FIELDS, feedbackRecordFor } = await import("../src/lib/feedbackRecord.mjs");
  assert.deepEqual(SHOOT_COMPLETION_FIELDS.map(([key]) => key).slice(4, 7), ["feedback", "appreciated", "notSatisfied"]);
  const given = { projectKey: "p1", id: "f1", stage: "SHOOT_COMPLETION", shootKey: "s1", shootCode: "DBS-SID-1", status: "Completed", review: "Good", feedback: "Fine.", appreciated: "Arun", notSatisfied: "" };
  assert.equal(feedbackRecordFor(given, [given]).entity["SHOOT_COMPLETION.s1.appreciated"], "Arun");
});

test("the list says whose feedback it holds: one's own, or everybody's with View All Feedback", () => {
  assert.match(PAGE, /useModuleAccess\("PROJECT", "View All Feedback"\)/);
  assert.match(PAGE, /No projects are waiting for feedback, and you have not given any yet\. A project appears here once it is created in Bookings & Converted\./);
});

test("the table has an Event Date column, and a row is read in the info panel and in View", () => {
  assert.match(PAGE, /\{ id: "eventDate", label: "Event Date", type: "date" \}/);
  assert.match(PAGE, /<DataTableInfoPanel[\s\S]*?sections=\{infoRecord\.sections\}/);
  assert.match(PAGE, /<RecordViewPanel[\s\S]*?sections=\{viewRecord\.sections\}/);
  assert.match(PAGE, /onRowDoubleClick=\{setViewing\}/);
  // Dates sort as dates, not as their displayed text.
  assert.match(PAGE, /column\.type === "date" \? \{ sortingFn:/);
  assert.match(PAGE, /\{ label: "View", onSelect: \(\) => setViewing\(row\) \}/);
});

test("the info panel and View show the project, then each of its feedbacks: given, or waiting - nothing locked", async () => {
  const { feedbackRecordFor, FEEDBACK_PROJECT_FIELDS } = await import("../src/lib/feedbackRecord.mjs");
  const project = { projectKey: "p1", eventId: "EV-1", projectName: "WED A & B", clientName: "A & B" };
  const titles = (record) => record.sections.map((section) => section.title);

  // Waiting: its New Project Feedback reads Yet to be done, and no later stage is listed.
  const waiting = { ...project, id: "project:p1:NEW_PROJECT", pending: true, stage: "NEW_PROJECT", status: "Yet to be done" };
  let record = feedbackRecordFor(waiting, [waiting]);
  assert.deepEqual(titles(record), ["Project", "New Project Feedback"]);
  assert.equal(record.entity["NEW_PROJECT.status"], "Yet to be done");
  assert.ok(record.sections.every((section) => !section.locked));

  // Given: shown in full.
  const given = { ...project, id: "f1", stage: "NEW_PROJECT", stageLabel: "New Project Feedback", feedbackCode: "DBS-FB-00001", status: "Issues sorted", review: "Average", feedback: "Late album.", issueRemarks: "Sent the next day." };
  record = feedbackRecordFor(given, [given]);
  assert.deepEqual(titles(record), ["Project", "New Project Feedback"]);
  assert.equal(record.entity.eventId, "EV-1");
  assert.equal(record.entity["NEW_PROJECT.feedbackCode"], "DBS-FB-00001");
  assert.equal(record.entity["NEW_PROJECT.issueRemarks"], "Sent the next day.", "a decided feedback shows its remark");

  // A Production Completion Feedback given before that stage was removed: its own parts, beside the rest.
  const pc = { ...project, id: "f2", stage: "PRODUCTION_COMPLETION", feedbackCode: "DBS-FB-00002", status: "Completed", salesReview: "Excellent", referralName: "Kavya", appreciated: "Arun Kumar, Mukesh K" };
  record = feedbackRecordFor(pc, [given, pc]);
  assert.deepEqual(titles(record), ["Project", "New Project Feedback", "Production Completion Feedback"]);
  assert.equal(record.entity["PRODUCTION_COMPLETION.salesReview"], "Excellent");
  assert.equal(record.entity["PRODUCTION_COMPLETION.appreciated"], "Arun Kumar, Mukesh K");
  assert.equal(record.entity["NEW_PROJECT.review"], "Average");
  assert.ok(!record.sections.find((section) => section.title === "Production Completion Feedback").fields.some(([key]) => key.endsWith("issueRemarks")));
  // Its New Project Feedback neither waiting nor shown: given by somebody this reader is not shown.
  assert.equal(feedbackRecordFor(pc, [pc]).entity["NEW_PROJECT.status"], "Given - not shown to you");
  assert.equal(feedbackRecordFor(null, []).entity, null);

  assert.match(PAGE, /const infoRecord = useMemo\(\(\) => feedbackRecordFor\(infoRow, rows\), \[infoRow, rows\]\);/);
  assert.match(PAGE, /entity=\{viewRecord\.entity\}\s+sections=\{viewRecord\.sections\}/);
  assert.deepEqual(FEEDBACK_PROJECT_FIELDS.find(([key]) => key === "eventDate"), ["eventDate", "Event Date", "date"]);
});

test("the info panel and View give each of a project's shoots its own Shoot Completion Feedback section", async () => {
  const { feedbackRecordFor } = await import("../src/lib/feedbackRecord.mjs");
  const base = { projectKey: "p1", eventId: "EV-1", projectName: "WED A & B" };
  const np = { ...base, id: "f1", stage: "NEW_PROJECT", feedbackCode: "DBS-FB-00001", status: "Completed", review: "Good", feedback: "Fine." };
  const one = { ...base, id: "f2", stage: "SHOOT_COMPLETION", shootKey: "s1", shootCode: "DBS-SID-1", shootName: "Engagement", shootDate: "2026-10-09", feedbackCode: "DBS-FB-00002", status: "Issues", review: "Poor", feedback: "Late." };
  const two = { ...base, id: "shoot:s2:SHOOT_COMPLETION", pending: true, stage: "SHOOT_COMPLETION", shootKey: "s2", shootCode: "DBS-SID-2", shootName: "Wedding", shootDate: "2026-10-10", status: "Yet to be done" };
  const overall = { ...base, id: "project:p1:OVERALL", pending: true, stage: "OVERALL", status: "Yet to be done" };
  const record = feedbackRecordFor(two, [np, one, two, overall]);
  // The project's feedbacks in the order they are asked: New Project, each shoot, then Overall.
  assert.deepEqual(record.sections.map((section) => section.title), ["Project", "New Project Feedback", "Shoot Completion Feedback - DBS-SID-1", "Shoot Completion Feedback - DBS-SID-2", "Overall Feedback"]);
  assert.equal(record.entity["OVERALL.status"], "Yet to be done");
  // Not waiting yet - its shoots not all completed - it is not listed.
  assert.ok(!feedbackRecordFor(two, [np, one, two]).sections.some((section) => section.title === "Overall Feedback"));
  // Each shoot's values are its own: the given one in full, the waiting one Yet to be done.
  assert.equal(record.entity["SHOOT_COMPLETION.s1.shootName"], "Engagement");
  assert.equal(record.entity["SHOOT_COMPLETION.s1.review"], "Poor");
  assert.equal(record.entity["SHOOT_COMPLETION.s2.shootCode"], "DBS-SID-2");
  assert.equal(record.entity["SHOOT_COMPLETION.s2.status"], "Yet to be done");
  const waiting = record.sections.find((section) => section.title.endsWith("DBS-SID-2"));
  assert.deepEqual(waiting.fields.map(([, label]) => label), ["Shoot ID", "Shoot", "Shoot Date", "Status"]);
  assert.equal(record.entity["NEW_PROJECT.review"], "Good");
});

test("the status bar lists the five statuses in order, opens on Yet to be done and filters the table", () => {
  assert.deepEqual(FEEDBACK_STATUSES, ["Yet to be done", "Issues", "Issues sorted", "Completed", "Rejected"]);
  assert.equal(DEFAULT_FEEDBACK_STATUS, "Yet to be done");
  // A row carries its status; one with none, or one the bar does not know, reads as the first.
  assert.equal(feedbackStatusOf({ status: "Issues sorted" }), "Issues sorted");
  assert.equal(feedbackStatusOf({}), "Yet to be done");
  assert.equal(feedbackStatusOf({ status: "Archived" }), "Yet to be done");
  // The header's tabs, remembered per page, each with its count, and the table shows the chosen one.
  assert.match(PAGE, /useStickyTab\("project-feedback", DEFAULT_FEEDBACK_STATUS, FEEDBACK_STATUSES\)/);
  assert.match(PAGE, /tabs=\{onBoard \? undefined : statusTabs\}\s+tabValue=\{status\}\s+onTabChange=\{chooseStatus\}/);
  assert.match(PAGE, /const chooseStatus = useCallback\(\(next\) => \{ setStatus\(next\); setInfoRow\(null\); \}/);
  assert.match(PAGE, /count: loading \? undefined : tabCount\(rows\.filter\(\(row\) => feedbackStatusOf\(row\) === label\), label\)/);
  assert.match(PAGE, /data=\{shownRows\}/);
  // A saved feedback is filed by its review, and the bar moves to where it went.
  assert.match(PAGE, /if \(saved\?\.status\) setStatus\(saved\.status\);/);
});

test("Yet to be done holds the projects created in Bookings & Converted, each with Give Feedback for a writer", () => {
  const SERVICE = read("services", "project-management", "feedback.service.js");
  assert.match(SERVICE, /export function getPendingFeedbackProjects\(\) \{\s+return apiRequest\("\/api\/project-management\/feedback\/pending"\)/);
  // Loaded beside the feedback, waiting projects first.
  assert.match(PAGE, /Promise\.allSettled\(\[getProjectFeedback\(\), getPendingFeedbackProjects\(\)\]\)/);
  // Give Feedback only on a waiting project and only for a writer; it opens the form on that project.
  assert.match(PAGE, /row\.pending && canWrite \? \[\{ label: "Give Feedback", onSelect: \(\) => setAdding\(row\) \}\]/);
  // A waiting project's Review cell says it is still to come.
  assert.match(PAGE, /if \(row\.pending && column\.id === "review"\) return "Not given yet";/);
  // The saved feedback replaces its waiting row - the project's, or that shoot's, never a sibling's.
  assert.match(PAGE, /!\(row\.pending && row\.projectKey && row\.projectKey === saved\.projectKey && row\.stage === saved\.stage && \(row\.shootKey \|\| null\) === \(saved\.shootKey \|\| null\)\)/);
  // A shoot's feedback is named by its Shoot ID, in a column after the Event ID; no Feedback Type.
  assert.match(PAGE, /\{ id: "eventId", label: "Event ID" \},\s+\/\/[^\n]*\n\s+\{ id: "shootCode", label: "Shoot ID" \},/);
  assert.doesNotMatch(PAGE, /feedbackType/);
});

test("a Completed feedback is answered with a thank-you, review and follow links; an Issues one with an apology", () => {
  assert.deepEqual(FEEDBACK_TEMPLATE_KEYS, { Completed: "FEEDBACK_THANK_YOU", Issues: "FEEDBACK_ISSUES" });
  assert.equal(feedbackTemplateKey("Yet to be done"), null);
  const links = {
    googleReviewUrl: "https://g.page/r/erode/review",
    customSocialLinks: [
      { label: "Facebook", url: "https://facebook.com/beam" },
      { label: "Instagram", url: "https://instagram.com/beam" },
      { label: "YouTube", url: "" },
    ],
  };
  // The links the studio added, under their labels, one line each - an empty one left out.
  assert.equal(socialLinksText(links), "Facebook: https://facebook.com/beam\nInstagram: https://instagram.com/beam");
  assert.equal(socialLinksText({ googleReviewUrl: "x" }), "");
  // With no template (a deleted row), the seeded wording, filled in.
  const thanks = feedbackMessage(null, { status: "Completed", clientName: "Priya & Arjun", shoot: "Reception", socialLinks: links });
  assert.match(thanks, /^Hi Priya & Arjun,/);
  assert.match(thanks, /review here:\nhttps:\/\/g\.page\/r\/erode\/review/);
  assert.match(thanks, /Follow us for more of our work:\nFacebook: https:\/\/facebook\.com\/beam/);
  // A branch with no links leaves those parts out rather than printing empty headings.
  assert.doesNotMatch(feedbackMessage(null, { status: "Completed", clientName: "A", shoot: "Haldi", socialLinks: {} }), /review here|Follow us/);
  const sorry = feedbackMessage(null, { status: "Issues", clientName: "Priya", shoot: "Wedding" });
  assert.match(sorry, /^Hi Priya,\n\nThank you for sharing your feedback about your project\. We’ve received it and will review the issues you raised\. Our team will get back to you soon\.\n\nThank you for your patience\.$/);
  // With its Feedback ID, the Issues message asks the client to mention it.
  const withCode = feedbackMessage(null, { status: "Issues", clientName: "Priya", shoot: "Wedding", feedbackCode: "DBS-FB-00007" });
  assert.match(withCode, /Please mention DBS-FB-00007 if you contact us about your feedback\. Thank you for your patience\.$/);
  // The studio's template fills {feedback id}; the thank-you does not carry it.
  assert.equal(feedbackMessage({ body: "Ref {feedback id}" }, { status: "Issues", feedbackCode: "DBS-FB-00007" }), "Ref DBS-FB-00007");
  assert.doesNotMatch(feedbackMessage(null, { status: "Completed", clientName: "A", shoot: "Haldi", feedbackCode: "DBS-FB-00007", socialLinks: {} }), /DBS-FB/);

  // The studio's own wording wins, with the placeholders filled.
  const template = { body: "Dear {client name} - {shoot} ({event id})\n{google review link}\n{social links}" };
  assert.equal(
    feedbackMessage(template, { status: "Completed", clientName: "Priya", shoot: "Haldi", eventId: "EV-1", socialLinks: links }),
    "Dear Priya - Haldi (EV-1)\nhttps://g.page/r/erode/review\n" + socialLinksText(links),
  );
});

test("after Save Feedback the client's message opens in the shared message box, to copy or send on WhatsApp", () => {
  const DIALOG = read("components", "project-management", "FeedbackMessageDialog.js");
  // Feedback is on the project: the client's message thanks them for feedback on their project.
  assert.match(DIALOG, /shoot: "project",/);
  assert.match(feedbackMessage(null, { status: "Issues", clientName: "Priya", shoot: "project", feedbackCode: "DBS-FB-00009" }), /sharing your feedback about your project\./);
  assert.match(PAGE, /if \(feedbackTemplateKey\(saved\?\.status\)\) setAnswering\(saved\);/);
  assert.match(PAGE, /\{answering && <FeedbackMessageDialog feedback=\{answering\}/);
  // The shared box with its Copy, and the template for the feedback's status, with its Feedback ID.
  assert.match(DIALOG, /const templateKey = feedbackTemplateKey\(feedback\.status\);\s*const template = useMessageTemplate\(templateKey\);/);
  assert.match(DIALOG, /<ShareableMessage label="Message to send the client"/);
  assert.match(DIALOG, /feedbackCode: feedback\.feedbackCode,/);
  // Send WhatsApp beside Close, to the client's own number - absent while WhatsApp is not linked or
  // the message is switched off under Settings → Templates.
  assert.match(DIALOG, /\{feedback\.id && canSend && <SendWhatsAppButton className="max-sm:flex-1" message=\{text\} onSend=\{sendOnWhatsApp\} \/>\}/);
  assert.match(DIALOG, /<Button className="max-sm:flex-1" type="button" onClick=\{onClose\}>Close<\/Button>/);
  // Every other message box keeps its Send WhatsApp.
  assert.match(read("components", "sales", "ClientLoginReadyDialog.js"), /<SendWhatsAppButton/);
  // Both templates are worded in Settings → Message Templates.
  const SETTINGS = read("components", "settings", "SettingsOverlay.js");
  assert.match(SETTINGS, /templateKey="FEEDBACK_THANK_YOU"/);
  assert.match(SETTINGS, /templateKey="FEEDBACK_ISSUES"/);
  assert.match(read("components", "settings", "MessageTemplatePanel.js"), /FEEDBACK_THANK_YOU: \{\s+"client name":/);
});

test("under Issues, a writer's ⋮ menu moves a feedback on to Issues sorted or Rejected, after a confirmation", async () => {
  const { FEEDBACK_ISSUE_OUTCOMES } = await import("../src/constants/feedbackConfig.js");
  assert.deepEqual(FEEDBACK_ISSUE_OUTCOMES, ["Issues sorted", "Rejected"]);
  // Only on given feedback still under Issues, and only for a writer.
  assert.match(PAGE, /!row\.pending && canWrite && row\.status === "Issues"/);
  assert.match(PAGE, /FEEDBACK_ISSUE_OUTCOMES\.map\(\(status\) => \(\{ label: status, tone: status === "Rejected" \? "danger" : undefined/);
  // Asked first, then sent, and the server's answer replaces the row.
  assert.match(PAGE, /\{resolving && canWrite && <ConfirmDialog/);
  assert.match(PAGE, /await setFeedbackIssueStatus\(resolving\.row\.id, resolving\.status, remarks\)/);
  assert.match(read("services", "project-management", "feedback.service.js"), /method: "PATCH",\s+body: JSON\.stringify\(\{ status, remarks \}\)/);
});

test("moving a feedback on asks for remarks: required for Rejected, optional for Issues sorted", async () => {
  // The box sits in the same confirmation, starred only for a rejection.
  assert.match(PAGE, /<TextAreaField\s+label="Remarks"\s+required=\{resolving\.status === "Rejected"\}/);
  assert.match(PAGE, /"How was it sorted out\? \(optional\)"/);
  // A blank rejection is stopped and said under the box, before anything is sent; the server's own
  // refusal of a remark lands there too.
  assert.match(PAGE, /if \(resolving\.status === "Rejected" && !remarks\) \{\s+setResolving\(\(current\) => \(\{ \.\.\.current, error: "Enter the remarks\." \}\)\);\s+return;/);
  assert.match(PAGE, /else if \(error\.status === 400\) \{\s+setResolving/);
  // Reject stays pressable: a blank reason is marked under the box rather than the button waiting.
  assert.doesNotMatch(PAGE, /confirmDisabled=/);
  assert.match(PAGE, /maxLength=\{REMARKS_MAX_LENGTH\}/);
  // The remark is a column on Issues sorted and Rejected only, and in the info panel once moved.
  assert.match(PAGE, /\{ id: "issueRemarks", label: "Remarks", width: 280, outcomeOnly: true \}/);
  assert.match(PAGE, /!\(column\.outcomeOnly && !FEEDBACK_ISSUE_OUTCOMES\.includes\(status\)\)/);
  const { FEEDBACK_GIVEN_FIELDS } = await import("../src/lib/feedbackRecord.mjs");
  const fields = FEEDBACK_GIVEN_FIELDS.map(([key]) => key);
  assert.ok(["issueRemarks", "issueResolvedBy", "issueResolvedAt"].every((key) => fields.includes(key)));
});

test("the Feedback ID is the table's first column, then its Versions, then the Feedback Stage, and the ID leads each feedback in the info panel and View", async () => {
  assert.match(PAGE, /const feedbackColumns = \[\s+\/\/[^\n]*\n\s+\{ id: "feedbackCode", label: "Feedback ID" \},\s+\/\/[^\n]*\n\s+\{ id: "versionCount", label: "Versions", type: "number", width: 110 \},\s+\/\/[^\n]*\n\s+\{ id: "stageLabel", label: "Feedback Stage" \},\s+\{ id: "projectName", label: "Project" \}/);
  const { FEEDBACK_GIVEN_FIELDS } = await import("../src/lib/feedbackRecord.mjs");
  assert.deepEqual(FEEDBACK_GIVEN_FIELDS[0], ["feedbackCode", "Feedback ID"]);
  assert.match(PAGE, /title=\{viewing\.feedbackCode \? `Feedback - \$\{viewing\.feedbackCode\}`/);
});

test("Yet to be done shows no Feedback ID - the projects waiting there have none", async () => {
  assert.match(PAGE, /feedbackColumns\.filter\(\(column\) => !\(status === DEFAULT_FEEDBACK_STATUS && \["feedbackCode", "versionCount"\]\.includes\(column\.id\)\)/);
  assert.match(PAGE, /\}\)\), \[feedbackActions, status\]\);/);
  // Nor a "Feedback ID" line for a waiting stage in the info panel and View - only its status.
  const { feedbackRecordFor } = await import("../src/lib/feedbackRecord.mjs");
  const waiting = { id: "project:p:NEW_PROJECT", pending: true, projectKey: "p", stage: "NEW_PROJECT", status: "Yet to be done" };
  const section = feedbackRecordFor(waiting, [waiting]).sections.find((entry) => entry.title === "New Project Feedback");
  assert.deepEqual(section.fields, [["NEW_PROJECT.status", "Status"]]);
});

test("an Average or Poor review asks who to Assign to, beside it, and the answer is a task for them", async () => {
  const { FEEDBACK_REVIEW_FIELDS, ISSUE_REVIEWS } = await import("../src/constants/feedbackConfig.js");
  assert.deepEqual(ISSUE_REVIEWS, ["Average", "Poor"]);
  assert.deepEqual(FEEDBACK_REVIEW_FIELDS, [["REVIEW", "review", "reviewAssignee"]]);
  const field = fields.reviewAssignee;
  assert.equal(field.label, "Assign to");
  assert.equal(field.required, true);
  // Shown only for Average or Poor.
  assert.equal(field.when({ review: "Poor" }), true);
  assert.equal(field.when({ review: "Average" }), true);
  assert.equal(field.when({ review: "Good" }), false);
  assert.deepEqual(field.options({}, { assignees: [{ value: "7", label: "Arun" }] }), [{ value: "7", label: "Arun" }]);
  // The form loads who can be assigned, and sends them for an Average or Poor review only.
  assert.match(PANEL, /getFeedbackAssignees\(\)\.catch\(\(\) => null\),/);
  assert.match(PANEL, /\.filter\(\(\[, review\]\) => ISSUE_REVIEWS\.includes\(values\[review\]\)\)/);
});

test("an issue already given to somebody as a task is answered from their Tasks, not moved on the page", async () => {
  // The Feedback page moves a feedback by hand only when it has no tasks.
  assert.match(PAGE, /row\.status === "Issues" && !row\.hasIssues/);
  // The task is answered from Tasks: Issues sorted or Rejected, a reason required for Rejected.
  const TASK = read("components", "hrm", "TaskDetailPanel.js");
  assert.match(TASK, /task\.canResolveFeedback && \{ label: "Issues sorted", variant: "primary"/);
  assert.match(TASK, /task\.canResolveFeedback && \{ label: "Rejected", variant: "danger"/);
  // Checked on the press, the reason marked under its own box.
  assert.match(TASK, /fields\.check\(\{ reason: answering === "Rejected" && !reason\.trim\(\) \? "Enter a reason\." : "" \}\)/);
  assert.match(read("services", "hrm", "tasks.service.js"), /apiRequest\(`\/api\/hrm\/tasks\/\$\{id\}\/feedback-outcome`/);
  // The View lists each issue, who has it and how it was answered - for every stage's feedback.
  const { FEEDBACK_GIVEN_FIELDS, PRODUCTION_COMPLETION_FIELDS, PROJECT_COMPLETED_FIELDS } = await import("../src/lib/feedbackRecord.mjs");
  for (const list of [FEEDBACK_GIVEN_FIELDS, PRODUCTION_COMPLETION_FIELDS, PROJECT_COMPLETED_FIELDS]) assert.ok(list.some(([key]) => key === "issuesSummary"));
  const keys = PRODUCTION_COMPLETION_FIELDS.map(([key]) => key);
  assert.ok(["salesReview", "preProductionFeedback", "productionReview", "referralName", "referralMobile", "appreciated", "notSatisfied"].every((key) => keys.includes(key)));
});

test("on the employee's review timeline a client's Appreciation is a Shine and Not Satisfied a Shadow, in date order, never moving the salary", async () => {
  const { reviewTimeline, withClientFeedback, clientFeedbackCounts } = await import("../src/lib/employeeReviewTimeline.mjs");
  const reviews = [{ reviewDate: "2026-04-01", outcome: "Shine", incrementAmount: 2000 }];
  const clientFeedback = [
    { id: 1, outcome: "Shine", feedbackCode: "DBS-FB-00250", givenOn: "2026-10-08T05:00:00.000Z" },
    // Without PROJECT / Feedback the source does not come: the card says only what happened.
    { id: 2, outcome: "Shadow", givenOn: "2026-02-01T05:00:00.000Z" },
  ];
  const steps = withClientFeedback(reviewTimeline(reviews, 20000), clientFeedback);
  assert.deepEqual(steps.map((step) => [step.type, step.side]), [["client", "left"], ["review", "right"], ["client", "right"]]);
  // The salary is the reviews' alone.
  assert.equal(steps.find((step) => step.type === "review").salary, 22000);
  assert.deepEqual(clientFeedbackCounts(clientFeedback), { shine: 1, shadow: 1 });
  // Drawn read-only, and the form hands it the record's own list.
  const TIMELINE = read("components", "employees", "EmployeeReviewTimeline.js");
  assert.match(TIMELINE, /function ClientFeedbackCard\(\{ entry, side \}\)/);
  assert.match(TIMELINE, /Client feedback: \{counts\.shine\} Shine · \{counts\.shadow\} Shadow/);
  assert.match(read("components", "employees", "EmployeeFormPanel.js"), /clientFeedback=\{employee\?\.clientFeedback \|\| \[\]\}/);
});

test("each assigned issue shows who has it, where their task stands, and how it ended - as fields, not one line", async () => {
  const { feedbackRecordFor, issueFieldsFor } = await import("../src/lib/feedbackRecord.mjs");
  const issue = { reviewKey: "REVIEW", reviewLabel: "Review", review: "Average", assignedTo: "Anitha Ravichandran", taskCode: "DBS-TK-00043", taskStatus: "In Progress", status: "Open", remarks: "" };

  // One issue: plain labels.
  const one = issueFieldsFor("NEW_PROJECT", [issue]);
  assert.deepEqual(one.fields.map(([, label]) => label), ["Assigned To", "Task Status", "Task ID", "Outcome"]);
  assert.equal(one.values["NEW_PROJECT.issue0.assignedTo"], "Anitha Ravichandran");
  assert.equal(one.values["NEW_PROJECT.issue0.taskStatus"], "In Progress");
  assert.equal(one.values["NEW_PROJECT.issue0.status"], "Open");

  // Several: each named by the review it is about; remarks once written; nobody said as such.
  const many = issueFieldsFor("PRODUCTION_COMPLETION", [
    { ...issue, reviewLabel: "Sales", review: "Poor", status: "Issues sorted", taskStatus: "Completed", remarks: "Called the client." },
    { ...issue, reviewLabel: "Production", assignedTo: "", taskCode: "DBS-TK-00044" },
  ]);
  const labels = many.fields.map(([, label]) => label);
  assert.ok(labels.includes("Sales (Poor) - Assigned To"));
  assert.ok(labels.includes("Sales (Poor) - Remarks"));
  assert.ok(labels.includes("Production (Average) - Task Status"));
  assert.ok(!labels.includes("Production (Average) - Remarks"), "no Remarks row before any are written");
  assert.equal(many.values["PRODUCTION_COMPLETION.issue1.assignedTo"], "Nobody");

  // In the View, they stand where the one-line summary used to.
  const given = { projectKey: "p1", id: "f1", stage: "NEW_PROJECT", status: "Issues", review: "Average", issues: [issue] };
  const record = feedbackRecordFor(given, [given]);
  const section = record.sections.find((entry) => entry.title === "New Project Feedback");
  const sectionLabels = section.fields.map(([, label]) => label);
  assert.ok(!sectionLabels.includes("Assigned Issues"));
  assert.deepEqual(sectionLabels.slice(0, 6), ["Feedback ID", "Status", "Assigned To", "Task Status", "Task ID", "Outcome"]);
  assert.equal(record.entity["NEW_PROJECT.issue0.taskCode"], "DBS-TK-00043");
});

test("a project's feedbacks on one tab fold into one row, the highest version shown with how many there are", async () => {
  const { groupFeedbackRows, groupedFeedbackOf } = await import("../src/lib/feedbackGroups.mjs");
  const given = (id, projectKey, feedbackVersion) => ({ id, projectKey, feedbackVersion, feedbackCode: `DBS-FB-0000${projectKey}-0${feedbackVersion}`, status: "Completed" });
  // Newest first from the server; a project's versions need not arrive in order.
  const rows = groupFeedbackRows([given("a3", "1", 3), given("b1", "2", 1), given("a1", "1", 1), given("a4", "1", 4), given("a2", "1", 2)]);
  assert.deepEqual(rows.map((row) => [row.id, row.versionCount]), [["a4", 4], ["b1", 1]], "one row per project, where its first row came");
  assert.deepEqual(groupedFeedbackOf(rows[0]).map((row) => row.id), ["a3", "a2", "a1"], "the rest under it, newest first");
  assert.ok(groupedFeedbackOf(rows[0]).every((row) => row.isGroupedRow && row.versionCount === null), "the count said once");
  assert.deepEqual(groupedFeedbackOf(rows[1]), [], "a lone feedback has nothing to open");
  assert.deepEqual(groupedFeedbackOf(groupedFeedbackOf(rows[0])[0]), [], "a folded row opens nothing itself");
});

test("a tab counts the rows it shows - one per project - and a row with no project or version stands alone", async () => {
  const { countFeedbackGroups, groupFeedbackRows } = await import("../src/lib/feedbackGroups.mjs");
  const rows = [{ id: "a", projectKey: "1", feedbackVersion: 2 }, { id: "b", projectKey: "1", feedbackVersion: 1 }, { id: "c" }, { id: "d", projectKey: "2", feedbackVersion: "x" }];
  assert.equal(countFeedbackGroups(rows), 3);
  assert.equal(groupFeedbackRows(rows).length, countFeedbackGroups(rows), "the count and the table agree");
  assert.match(PAGE, /const tabCount = \(onTab, label\) => \(label === DEFAULT_FEEDBACK_STATUS \? onTab\.length : countFeedbackGroups\(onTab\)\);/);
});

test("the Feedback table folds them under a chevron, but not on Yet to be done", () => {
  assert.match(PAGE, /return status === DEFAULT_FEEDBACK_STATUS \? onTab : groupFeedbackRows\(onTab\);/);
  assert.match(PAGE, /expandable: \{ label: "this project's other feedback", canExpand: \(row\) => groupedFeedbackOf\(row\)\.length > 0, getSubRows: groupedFeedbackOf \}/);
});
