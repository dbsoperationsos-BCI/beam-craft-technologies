import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("the production route renders the shoot board, not the old project list", () => {
  const page = read("app/(app)/project-management/production/page.js");
  assert.match(page, /ProductionPage/);
  assert.doesNotMatch(page, /ProjectWorkflowModulePage/);
  assert.doesNotMatch(read("components/project-management/ProjectWorkflowModulePage.js"), /\bproduction: \{/);
});

test("the board asks the route what it may do and passes it to the panel", () => {
  const board = read("components/project-management/production/ProductionPage.js");
  assert.match(board, /useRouteAccess\(\)/);
  assert.match(board, /canWrite=\{canWrite\}/);
});

test("the board is the table on every screen size, with no separate card view", () => {
  const board = read("components/project-management/production/ProductionPage.js");
  assert.doesNotMatch(board, /RecordCardList|md:hidden/);
  assert.match(board, /<DataTable/);
});

test("the plan is one column and its buttons are thumb-sized", () => {
  const config = read("constants/productionFormConfig.js");
  // People (with the services), Travel, and the rest - Services is no longer a section of its own.
  assert.equal((config.match(/columns: 1/g) || []).length, 3);
  assert.doesNotMatch(config, /exposure/i);
  assert.match(read("components/project-management/production/ProductionShootPanel.js"), /size="lg"/);
});

test("module components type no raw controls (Rule 1)", () => {
  for (const file of fs.readdirSync(new URL("../src/components/project-management/production/", import.meta.url))) {
    const source = read(`components/project-management/production/${file}`);
    assert.doesNotMatch(source, /<(button|input|select|textarea|table)\b/, file);
    assert.doesNotMatch(source, /role="dialog"/, file);
  }
});

test("the panel has Plan, Execution and Activity, and the rail comes from shared", () => {
  const panel = read("components/project-management/production/ProductionShootPanel.js");
  for (const [id, label] of [["plan", "Plan"], ["execution", "Execution"], ["activity", "Activity"]]) assert.match(panel, new RegExp(`\\{ id: "${id}", label: "${label}" \\}`));
  assert.match(read("components/project-management/production/ProductionExecutionTab.js"), /from "@\/components\/shared\/StepRail"/);
});

test("a step's controls are drawn only for the coordinator on the current step, its action in the panel footer", () => {
  const form = read("components/project-management/production/ProductionStepForm.js");
  assert.match(form, /editable &&/);
  assert.match(form, /layer="dialogOverPanel"/);
  assert.match(form, /<StepAction>/);
  assert.match(form, /<MultiImageField[^>]*size="lg"/);
});

test("uploads go through the queue, and closing with photos still waiting asks first", () => {
  const panel = read("components/project-management/production/ProductionShootPanel.js");
  assert.match(panel, /useProductionUploads\(/);
  assert.match(panel, /uploads\.pending/);
});

test("ticket photos are compressed on the phone, and too-big or failed files are said", () => {
  const panel = read("components/project-management/production/ProductionShootPanel.js");
  assert.match(panel.match(/<FileUploadField[\s\S]*?\/>/)[0], /\n\s*compressImages\n/);
  const field = read("components/shared/FileUploadField.js");
  assert.match(field, /if \(compressImages\) \{ await addCompressing\(files\); return; \}/, "the default path is untouched");
  assert.match(field, /setNotice\(leftOutNotice\(/);
});

test("a ticket can be added the moment its travel mode is picked, without saving the plan first", () => {
  const panel = read("components/project-management/production/ProductionShootPanel.js");
  assert.doesNotMatch(panel, /Save the plan to add tickets/);
  assert.match(panel, /uploads\.add\("TICKET", files, \{ travelMode: values\.travelMode \}\)/);
});

test("a file landing refreshes the shoot without resetting the plan form, and the board hears once", () => {
  const panel = read("components/project-management/production/ProductionShootPanel.js");
  const applyFiles = panel.match(/const applyFiles = useCallback\(\(next\) => \{[\s\S]*?\}, \[update\]\);/);
  assert.ok(applyFiles, "applyFiles is a useCallback keyed only on update");
  // It only ever sets the whole detail and, at most, the form's own travelMode - never a wider reset.
  assert.doesNotMatch(applyFiles[0], /setForm\(productionPlanForm/);
  assert.match(panel, /useProductionUploads\(shootId, applyFiles, /);
  assert.doesNotMatch(panel.match(/const removeFile[\s\S]*?\}, \[/)[0], /applyDetail/);
  const hook = read("components/project-management/production/useProductionUploads.js");
  assert.match(hook, /if \(landed\) onDrained\?\.\(\);/);
});

test("closing or refreshing with files still waiting asks first, through the shared guard", () => {
  const panel = read("components/project-management/production/ProductionShootPanel.js");
  assert.match(panel, /useUnsavedGuard\(uploads\.pending > 0,/);
  assert.match(panel, /useUnloadWarning\(true, \(\) => uploads\.pending > 0\)/);
  assert.match(panel, /<ConfirmDialog \{\.\.\.confirmProps\} layer="dialogOverPanel" \/>/);
  assert.doesNotMatch(panel, /confirmClose/);
});

test("General links the group, the step shows Not sent · Retry, Settings offers the three templates", () => {
  assert.match(read("components/project-management/PreProductionGeneral.js"), /ProjectWhatsappGroupField/);
  assert.match(read("components/project-management/production/ProductionStepForm.js"), /ProductionMessageStatus/);
  assert.match(read("components/project-management/production/ProductionMessageStatus.js"), /Not sent/);
  const settings = read("components/settings/SettingsOverlay.js");
  for (const key of ["PRODUCTION_STARTED_FROM_STUDIO", "PRODUCTION_REACHED_SHOOT_PLACE", "PRODUCTION_SHOOT_COMPLETED"]) assert.match(settings, new RegExp(`templateKey="${key}"`));
  assert.match(read("components/settings/MessageTemplatePanel.js"), /PRODUCTION_MESSAGE_PLACEHOLDERS/);
});

test("the step form surfaces an unsent WhatsApp message instead of only saying done", () => {
  const form = read("components/project-management/production/ProductionStepForm.js");
  assert.match(form, /unsentNotice\(response\?\.message\)/);
  // The rail still moves on to the next step; the notice names the finished one to retry on.
  const tab = read("components/project-management/production/ProductionExecutionTab.js");
  assert.match(tab, /setViewed\(Math\.min\(furthest, lastIndex\)\);/);
  assert.doesNotMatch(tab, /isUnsent/);
});

test("Happy clients ends the shoot, so there is no status step for anybody to work", () => {
  const form = read("components/project-management/production/ProductionStepForm.js");
  // The step, its dropdown and its save are gone; the server stamps the shoot Completed itself.
  assert.doesNotMatch(form, /saveStatus|statusRemarks|SHOOT_STATUS|changeProductionShootStatus/);
  // The last word is still asked before it is sent, now on Happy clients itself.
  assert.match(form, /open=\{confirming && Boolean\(messageStep\)\}/);
});

test("pausing the shoot sits in the step's title bar, says why both ways, and stops the steps while it holds", () => {
  const tab = read("components/project-management/production/ProductionExecutionTab.js");
  const stepForm = read("components/project-management/production/ProductionStepForm.js");
  // On the step's own title line, opposite the step name - not a step of its own in the order, and
  // not a band of its own above the form.
  assert.doesNotMatch(tab, /<ProductionPauseControl/);
  assert.match(stepForm, /<header className="flex flex-wrap items-start justify-between gap-2">[\s\S]{0,400}?<ProductionPauseControl shootId=\{shootId\} execution=\{execution\} canRunSteps=\{canRunSteps\} onDetail=\{onDetail\} onError=\{onError\} \/>\n\s*<\/header>/);
  // The reason it stopped is its own line under the title, where a block of text belongs.
  assert.match(stepForm, /<ProductionPauseControl part="notice"/);
  // A paused shoot completes nothing - the server refuses it too, and the form does not offer it.
  assert.match(tab, /editable=\{canRunSteps && !detail\.execution\.paused && stepId === detail\.execution\.currentStep\}/);
  assert.match(read("components/project-management/production/ProductionStepForm.js"), /The shoot is paused\. Resume it to complete this step\./);

  const control = read("components/project-management/production/ProductionPauseControl.js");
  // The server says when it may be paused; the screen never works that out for itself.
  assert.match(control, /const mayPause = canRunSteps && Boolean\(execution\.canPause\);/);
  // Why is asked for in both directions, and the box is marked rather than the save being refused silently.
  assert.match(control, /fields\.check\(\{ remarks: remarks\.trim\(\) \? "" : paused \? "Write why the shoot is resuming\." : "Write why the shoot is paused\." \}\)/);
  assert.match(control, /pauseProductionShoot\(shootId, \{ paused: !paused, remarks: remarks\.trim\(\) \}\)/);
  assert.match(control, /useSubmitOnce\(\)/);
  // While it is paused the reason is on screen, for a viewer who may not start it either.
  assert.match(control, /if \(part === "notice"\) \{/);
  assert.match(control, /<InlineAlert tone="warning">Paused/);
  // The button keeps its size on the title line rather than stretching to the pane.
  assert.match(control, /className="min-w-36 shrink-0"/);
  assert.match(control, /\{paused \? "Resume the shoot" : "Pause the shoot"\}/);
  const service = read("services/project-management/production.service.js");
  assert.match(service, /apiRequest\(`\$\{shootPath\(shootId\)\}\/pause`, \{ method: "PATCH"/);
});

test("removing a file asks first and cannot be sent twice", () => {
  const list = read("components/project-management/production/ProductionFileList.js");
  assert.match(list, /<ConfirmDialog/);
  assert.match(list, /useSubmitOnce\(\)/);
  assert.match(list, /loading=\{busy\}/);
});

test("the photo steps take their photos before they confirm, and a finished step shows only a tick", () => {
  const form = read("components/project-management/production/ProductionStepForm.js");
  for (const step of ["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "SHOOT_STARTED", "HAPPY_CLIENTS"]) {
    assert.match(form, new RegExp(`${step}: \\{ min: 1, max: \\d+ \\}`));
  }
  assert.match(form, /HAPPENING_NOW: \{ min: 2, max: 30 \}/);
  assert.match(form, /uploads\.add\(stepPhotoKind, next\)/);
  // Confirm stays pressable; too few photos is marked on the picker instead.
  assert.match(form, /photos: photosProblem\(stepPhotos\.length, photoRule\.min, "Add a photo\."\)/);
  assert.match(form, /✓ Done/);
  assert.doesNotMatch(form, /log\.by/);
  assert.doesNotMatch(read("components/project-management/production/ProductionExecutionTab.js"), /notes=/);
});

test("People crews each of the shoot's services, after the coordinator; the old Cameras picker is gone", () => {
  const panel = read("components/project-management/production/ProductionShootPanel.js");
  assert.match(panel, /<ProductionServiceCrew/);
  assert.doesNotMatch(panel, /cameraAssetIds|shootServices/);
  const config = read("constants/productionFormConfig.js");
  // People, then Travel - which an indoor shoot is not asked at all, so a comment stands between them.
  assert.match(config, /\{ name: "keptNames", type: "custom", colSpan: 2 \},[\s\S]*?\{ name: "crew", type: "custom", colSpan: 2 \},\n    \],\n  \},\n[\s\S]*?\n  \{\n    id: "travel",\n    title: "Travel",/);
  assert.doesNotMatch(config, /id: "services"/);
  const crew = read("components/project-management/production/ProductionServiceCrew.js");
  // The service's own person is asked for one or the other: a vendor's Status, an employee's Cameras.
  assert.match(crew, /\{role === "LEAD" && \(isVendorPerson\(row\.person\)\n[\s\S]*?\? <PendingField pending=\{\(row\.vendorStatus \|\| "WAITING"\) !== "CONFIRMED"\}><Dropdown\n\s+label="Status"/);
  assert.match(crew, /: <MultiSelectField\n\s+label="Cameras"/);
});

test("a camera picked for one service is not offered to the shoot's other services", () => {
  const crew = read("components/project-management/production/ProductionServiceCrew.js");
  /*
   * And one out on another shoot at an overlapping time is not offered at all - a camera is one
   * object, so it is busy exactly as the people are (`availability.js`). What this seat already
   * holds always stays listed, so a saved plan never silently loses a camera.
   */
  assert.match(crew, /const elsewhere = new Set\(\(busyCameraAssetIds \|\| \[\]\)\.map/);
  assert.match(crew, /chosen\.has\(option\.value\) \|\| \(!taken\.has\(option\.value\) && !elsewhere\.has\(option\.value\)\)/);
  assert.match(read("components/project-management/production/ProductionShootPanel.js"), /busyCameraAssetIds=\{detail\?\.busyCameraAssetIds\}/);
  // A seat may hold several cameras, so what another service has taken is every id in its selection.
  // ...and a seat gone over to a vendor sends none, so what it still holds is not held against them.
  assert.match(crew, /row\.definitionId !== definitionId && !isVendorPerson\(row\.person\)\)\.flatMap\(\(row\) => row\.cameraAssetIds \|\| \[\]\)/);
  assert.match(crew, /options=\{camerasFor\(service\.definitionId\)\}/);
});

test("Execution puts its step's action in the panel footer beside Close, the same place and style as the Plan's button", () => {
  const panel = read("components/project-management/production/ProductionShootPanel.js");
  assert.match(panel, /\{tab === "execution" && <div ref=\{setStepActionNode\}/);
  assert.match(panel, /<StepActionSlotProvider node=\{stepActionNode\}><StepListSlotProvider node=\{stepListNode\}><ProductionExecutionTab/);
  assert.match(read("components/project-management/production/StepActionSlot.js"), /createPortal\(children, node\)/);
  assert.ok(!fs.existsSync(new URL("../src/components/shared/StickyActionBar.js", import.meta.url)));
});

test("pre production links the project's WhatsApp group by itself, once per project, when its name matches", () => {
  const field = read("components/project-management/ProjectWhatsappGroupField.js");
  assert.match(field, /autoLinkPreProductionWhatsappGroup\(project\.projectId\)/);
  assert.match(field, /triedFor\.current === project\.projectId/);
  assert.match(field, /Not linked yet: \{autoNote\}/);
  assert.match(read("services/project-management/pre-production.service.js"), /whatsapp-group\/auto`, \{ method: "POST" \}/);
});

test("the board is one row per project, its tabs where each project stands, its shoots as tiles", () => {
  const board = read("components/project-management/production/ProductionPage.js");
  // The tabs follow the viewer: every status for whoever runs a project, Planned on for crew (`boardForViewer`).
  assert.match(board, /const board = useMemo\(\(\) => boardForViewer\(productionProjects\(rows\)\), \[rows\]\);\s*const tabs = board\.tabs;/);
  // One row per project, as the viewer is shown them.
  assert.match(board, /const projects = board\.projects;/);
  assert.match(board, /projects\.filter\(\(project\) => inProjectTab\(project, activeTab\)\)/);
  assert.match(board, /<ProductionProjectPanel project=\{openProject\} onOpenShoot=\{\(id\) => openShoot\(id, true\)\}/);
  assert.doesNotMatch(board, /My Shoots|row\.mine/);
  // The same tile as Pre Production's, from one component.
  const panel = read("components/project-management/production/ProductionProjectPanel.js");
  assert.match(panel, /<ProjectShootTile[\s\S]*onOpen=\{\(\) => onOpenShoot\(shoot\.shootRecordId\)\}/);
  assert.match(read("components/project-management/PreProductionProjectPanel.js"), /return <ProjectShootTile/);
  assert.match(read("components/project-management/shoot-board/ShootBoardCard.js"), /\{shoot\.isMainEvent && <span[^>]*>.*Main Event<\/span>\}/);
});

test("whether a step's WhatsApp went, and its Retry, are the Production Manager's to see", () => {
  const form = read("components/project-management/production/ProductionStepForm.js");
  assert.match(form, /const seesMessages = Boolean\(detail\.canEditPlan\);/);
  assert.match(form, /\{seesMessages && messageStep && messageFor/);
  assert.match(form, /canRetry=\{seesMessages\}/);
  assert.equal((form.match(/seesMessages \? unsentNotice\(response\?\.message\) : null/g) || []).length, 1);
});

test("the steps that ask nothing else take optional remarks, sent with the step", () => {
  const form = read("components/project-management/production/ProductionStepForm.js");
  assert.match(form, /const OPTIONAL_REMARK_STEPS = new Set\(\["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "SHOOT_STARTED", "HAPPENING_NOW", "HAPPY_CLIENTS"\]\);/);
  // Optional is said by the missing asterisk, not by the label.
  assert.match(form, /label="Remarks"(?: helperText="[^"]*")? value=\{stepRemarks\}/);
  assert.doesNotMatch(form, /\(optional\)/);
  assert.equal((form.match(/complete\(\{ remarks: stepRemarks \}\)/g) || []).length, 2);
});

test("a tap on a photo opens it full screen with Close at the top right and a download icon at the bottom right; a PDF saves", () => {
  const list = read("components/project-management/production/ProductionFileList.js");
  assert.match(list, /saveBlob\(await downloadProductionFile\(shootId, file\.id\), file\.fileName \|\| "file"\)/);
  assert.match(list, /onClick=\{\(\) => \(image \? setViewing\(images\.indexOf\(file\)\) : void download\(file\)\)\}/);
  assert.match(list, /<Lightbox[\s\S]*layer="dialogOverPanel"[\s\S]*corner=\{<IconButton[\s\S]*<FileDownloadOutlined \/>/);
  assert.doesNotMatch(list, />Download<\/Button>/);
  assert.match(read("components/shared/Lightbox.js"), /pt-\[max\(2\.5rem,calc\(env\(safe-area-inset-top\)\+1rem\)\)\]/);
  assert.ok(fs.existsSync(new URL("../src/components/shared/Lightbox.js", import.meta.url)));
  assert.doesNotMatch(list, /target="_blank"/);
  assert.match(read("services/project-management/production.service.js"), /\/files\/\$\{encodeURIComponent\(fileId\)\}\/download/);
});

test("each photo tile has its own download mark in the corner, beside the tap that opens it", () => {
  const list = read("components/project-management/production/ProductionFileList.js");
  assert.match(list, /\{image && <IconButton[\s\S]*shape="circle"[\s\S]*absolute right-1 bottom-1 bg-white\/90[\s\S]*onClick=\{\(\) => void download\(file\)\}/);
});

test("the coordinator's shoot opens on Execution, listed first; everybody else opens on Plan", () => {
  const panel = read("components/project-management/production/ProductionShootPanel.js");
  assert.match(panel, /const runsSteps = Boolean\(detail\?\.canRunSteps && !detail\?\.canEditPlan\);/);
  assert.match(panel, /const tab = pickedTab \|\| \(runsSteps \? "execution" : "plan"\);/);
  assert.match(panel, /runsSteps \? \[EXECUTION_TAB, PLAN_TAB\] : \[PLAN_TAB, EXECUTION_TAB\]/);
  // Read only after `detail` exists - used before its declaration it would throw when the panel opens.
  assert.ok(panel.indexOf("const [detail, setDetail]") < panel.indexOf("const runsSteps"));
});

test("the photo picker is an upload mark over two buttons: Take photo and Upload from gallery", () => {
  const field = read("components/shared/MultiImageField.js");
  assert.match(field, /<CloudUploadOutlined \/>/);
  assert.match(field, /<PhotoCameraOutlined[^>]*\/>\s*Take photo/);
  assert.match(field, /"Upload from gallery"/);
  assert.doesNotMatch(read("components/shared/CameraCaptureDialog.js"), /Upload photos/);
});

test("a confirmation's two buttons sit side by side on a phone, Cancel left and the action right", () => {
  assert.match(read("components/ui/ConfirmDialog.js"), /\n    footerInline\n/);
  assert.match(read("components/ui/Dialog.js"), /footerInline \? "flex-row" : "flex-col-reverse sm:flex-row"/);
});

test("on a phone the Plan reads as one scrolling page, without a second row of section links under the tabs", () => {
  assert.match(read("components/project-management/production/ProductionShootPanel.js"), /sectionNavOnPhone=\{false\}/);
  assert.match(read("components/schema-form/SchemaFormSidebar.js"), /\{phoneNav && <nav className="z-30 flex w-full shrink-0 gap-1 overflow-x-auto/);
  assert.match(read("components/schema-form/SchemaFormPanel.js"), /phoneNav=\{sectionNavOnPhone\}/);
});

test("an unsubmitted plan offers Mark as pending beside Submit plan; a submitted one only Save changes", () => {
  /*
   * There is still no draft kept in the browser: both buttons save to the server. The difference is
   * what the save is held to - Submit plan wants the plan finished, Mark as pending takes it as it
   * stands - and once the plan is submitted there is one button again, because a submitted plan is
   * held to being complete whatever saves it.
   */
  const panel = read("components/project-management/production/ProductionShootPanel.js");
  assert.match(panel, /\{submitted \? "Save changes" : "Submit plan"\}/);
  assert.match(panel, /const bothActions = onPlan && planEditable && !submitted;/);
  assert.match(panel, /bothActions && <Button[\s\S]{0,260}?>Mark as pending<\/Button>/);
  assert.match(panel, /const submitting = !pending && !detail\?\.plan\?\.planSubmittedAt;/);
  // One save at a time, and only the button that was pressed says what it is doing.
  assert.match(panel, /busy=\{busy && pendingSave\} disabled=\{busy && !pendingSave\}/);
  assert.match(panel, /busy=\{busy && !pendingSave\} disabled=\{busy && pendingSave\}/);
  assert.doesNotMatch(panel, /Save draft/);
});

test("a step's photo picker says how many are uploaded and how many it needs, in place of a separate line", () => {
  const form = read("components/project-management/production/ProductionStepForm.js");
  assert.match(form, /hint=\{uploadedHint\(stepPhotos\.length, photoRule\.min, photoRule\.max\)\}/);
  assert.equal((form.match(/hint=\{uploadedHint\(/g) || []).length, 2);
  assert.doesNotMatch(form, /of at least 2 photos uploaded/);
  assert.match(read("components/shared/MultiImageField.js"), /\{hint \?\? `/);
});

test("the Activity tab is shown only to the Production Manager and above, never to the coordinator", () => {
  const panel = read("components/project-management/production/ProductionShootPanel.js");
  assert.match(panel, /const seesActivity = Boolean\(detail\?\.canEditPlan\);/);
  assert.match(panel, /\.\.\.\(seesActivity \? \[ACTIVITY_TAB\] : \[\]\)/);
  assert.match(panel, /detail && seesActivity && tab === "activity"/);
});

test("Reached studio completes on its button alone; only a step that posts to WhatsApp asks again", () => {
  const form = read("components/project-management/production/ProductionStepForm.js");
  assert.match(form, /if \(messageStep\) setConfirming\(true\); else void complete\(\{ remarks: stepRemarks \}\);/);
  assert.match(form, /open=\{confirming && Boolean\(messageStep\)\}/);
});

test("a multi-select scrolls its chips inside its column instead of widening it", () => {
  const field = read("components/shared/MultiSelectField.js");
  assert.match(field, /className=\{`relative block min-w-0 max-w-full /);
  assert.match(field, /overflow-x-auto/);
  // The form's wrapper around a custom field (Production Team is one) is the grid cell; it shrinks too.
  assert.match(read("components/schema-form/SchemaFormFields.js"), /<div className=\{`min-w-0 \$\{className \|\| ""\}`\.trim\(\)\}>/);
});

test("photo copy asks its fields once per service of the shoot, or once for a shoot with none; remarks optional", () => {
  const form = read("components/project-management/production/ProductionStepForm.js");
  assert.match(form, /const FOOTAGE_FIELDS = \["footageUrl", "backedUpByEmployeeId", "fileCount", "size", "firstFileName", "lastFileName"\];/);
  assert.match(form, /label="Remarks"(?: helperText="[^"]*")? value=\{values\.remarks\}/);
  assert.match(form, /\{ key: WHOLE_SHOOT, definitionId: null, name: "Whole shoot" \}/);
  // Completing wants every service of the shoot and says which answers are missing when it cannot;
  // Mark as pending beside it is `production-steps`.
  assert.match(form, /if \(!footageComplete\) \{/);
  assert.match(form, /await complete\(\{ footage: footagePayload\(footageServices, footage\) \}\);/);
  // Every field of every service is checked, each blank one marked under its own box.
  assert.match(form, /footageServices\.flatMap\(\(service\) => FOOTAGE_FIELDS\.map/);
  assert.match(form, /fields\.check\(footageProblems\(\)\)/);
  // Each block collapses to one column on a phone.
  assert.match(form, /grid min-w-0 gap-3 md:grid-cols-2/);
});

test("a crew dropdown leaves out employees busy on another shoot at that time, but keeps the one already chosen", () => {
  const crew = read("components/project-management/production/ProductionServiceCrew.js");
  assert.match(crew, /return people\.filter\(\(option\) => option\.value === chosen \|\| \(shoots\(option\) && !busy\.has\(option\.value\) && !elsewhere\.has\(option\.value\)\)\);/);
  // One employee works one service of a shoot: an employee chosen for another of its services is left out; a vendor is not.
  assert.match(crew, /const elsewhere = drones\.has\(definitionId\) \? new Set\(\) : new Set\(crew\.filter\(\(row\) => row\.definitionId !== definitionId && !drones\.has\(row\.definitionId\) && row\.role === "LEAD" && row\.person && !isVendorPerson\(row\.person\)\)/);
  // A drone service is not held to it: its list keeps everybody, and flying it leaves nobody out elsewhere.
  assert.match(crew, /const drones = new Set\(services\.filter\(\(service\) => isDroneService\(service\.name\)\)/);
  // Only shooters - employees in the Technical department - and vendors are offered.
  assert.match(crew, /const shoots = \(option\) => String\(option\.value\)\.startsWith\("ven:"\) \|\| option\.shooter;/);
  assert.match(read("lib/productionPlan.mjs"), /shooter: Boolean\(employee\.shooter\)/);
  assert.match(crew, /options=\{peopleFor\(row\.person, service\.definitionId\)\}/);
  assert.match(read("components/project-management/production/ProductionShootPanel.js"), /busyEmployeeIds=\{detail\?\.busyCrewEmployeeIds\}/);
  // No Production Team field: the team is the coordinator and each service's people.
  assert.doesNotMatch(read("components/project-management/production/ProductionShootPanel.js"), /Production Team/);
  assert.doesNotMatch(read("constants/productionFormConfig.js"), /name: "team"/);
});

test("a project row expands to its shoots, each opening straight to the shoot", () => {
  const board = read("components/project-management/production/ProductionPage.js");
  assert.match(board, /expandable: \{ label: "this project's shoots", canExpand: \(row\) => !isShootRow\(row\) && row\.shoots\?\.length > 0, getSubRows:/);
  assert.match(board, /onRowDoubleClick=\{\(row\) => \(isShootRow\(row\) \? openShoot\(row\.shootRecordId\) : setOpenProjectId\(row\.projectId\)\)\}/);
  // Every column says its shoot's counterpart, and a shoot row's status is the shoot's own.
  // Capped, so a shoot named for several at once ends in "..." rather than widening the column.
  assert.match(board, /\{ id: "clientName", label: "Client \/ Shoot", maxWidth: NAME_COLUMN_MAX_WIDTH, shoot: \(row\) => `\$\{row\.isMainEvent \? "★ " : ""\}/);
  assert.match(board, /<ProductionStatusPill status=\{shootProductionStatus\(row\.original\)\} label=\{shootStatusLabel\(row\.original\)\} \/>/);
});

test("the Plan tab opens on the project and shoot as known, read-only, as Pre Production's form does", () => {
  const panel = fs.readFileSync(new URL("../src/components/project-management/production/ProductionShootPanel.js", import.meta.url), "utf8");
  assert.match(panel, /sections=\{onPlan \? \[PLAN_CONTEXT_SECTION, \.\.\.productionPlanSections, PLAN_STATUS_SECTION\] : \[\]\}/);
  const summary = fs.readFileSync(new URL("../src/components/project-management/production/ProductionContextSummary.js", import.meta.url), "utf8");
  assert.match(summary, /import PreProductionSummaryGroup from/);
  // Project and shoot side by side, as Pre Production's; nothing from Pre Production itself.
  assert.match(summary, /<div className="grid gap-4 lg:grid-cols-2">/);
  assert.doesNotMatch(summary, /From Pre Production|reportingTime/);
});

test("a shoot opened from its project's tiles goes back to them - by the arrow, Close, and after the Plan is saved", () => {
  const page = fs.readFileSync(new URL("../src/components/project-management/production/ProductionPage.js", import.meta.url), "utf8");
  assert.match(page, /onOpenShoot=\{\(id\) => openShoot\(id, true\)\}/);
  assert.match(page, /onBack=\{shootFromTiles \? \(\) => setOpenShootId\(null\) : undefined\}/);
  // Saving the plan closes the panel wherever it was opened from - tiles or a row.
  assert.doesNotMatch(page, /closeOnSave/);
  // Close goes back to the tiles too, rather than leaving the project; the title is the row's until it loads.
  assert.match(page, /onClose=\{\(\) => setOpenShootId\(null\)\}/);
  assert.match(page, /summary=\{rows\.find\(\(row\) => row\.shootRecordId === openShootId\) \|\| null\}/);
  const panel = fs.readFileSync(new URL("../src/components/project-management/production/ProductionShootPanel.js", import.meta.url), "utf8");
  assert.match(panel, /\n\s+guard\(onBack \|\| onClose\);/);
});

test("the Execution tab stays shut until three days before the shoot, saying when it opens", () => {
  const tab = read("components/project-management/production/ProductionExecutionTab.js");
  assert.match(tab, /if \(!detail\.plan\.planSubmittedAt \|\| detail\.execution\.closedReason\) \{/);
  assert.match(tab, /\? detail\.execution\.closedReason/);
  assert.match(read("components/project-management/production/ProductionShootPanel.js"), /rail=\{tab === "execution" && detail\?\.plan\?\.planSubmittedAt && !detail\?\.execution\?\.closedReason \?/);
});

test("a shoot opened from the calendar opens inside its project, with the back arrow to its shoots, as Pre Production does", () => {
  const board = read("components/project-management/production/ProductionPage.js");
  assert.match(board, /const linkedRow = linkedShootId \? rows\.find\(\(row\) => row\.shootRecordId === linkedShootId\) : null;/);
  assert.match(board, /if \(linkedRow\?\.projectId\) \{\s+setOpenProjectId\(linkedRow\.projectId\);\s+openShoot\(linkedShootId, true\);/);
  // A shoot the board does not list still opens once the rows are in, on its own.
  assert.match(board, /\(linkedRow \|\| !loading\)/);
  assert.match(board, /onBack=\{shootFromTiles \? \(\) => setOpenShootId\(null\) : undefined\}/);
});

test("the Production table fills the pane, with no blank strip beside Status on a wide screen", () => {
  const page = read("components/project-management/production/ProductionPage.js");
  assert.match(page, /infiniteScroll: \{ pageSize: 50 \},\n(\s+\/\/.*\n)+\s+layout: "fill",/);
});
