"use client";

import { useMemo } from "react";
import DataTable from "@/components/data-table/DataTable";
import { EMPLOYEE_IMPORT_COLUMNS } from "@/constants/importColumns";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import OptionsMenu from "@/components/ui/OptionsMenu";
// Who has not been taken on yet, which is what decides whether there is anything to offboard from.
import { isOnboarding, isWorking } from "@/lib/employmentStatus.mjs";

const employeeFields = [
  ["employeeId", "Employee ID", undefined, 160, 140], ["profilePhotoUrl", "Photo", "image", 110, 90], ["employeeName", "Employee Name", undefined, 220, 180],
  /*
   * Right beside the name rather than after Email ID, where it sat before: this is the value a
   * CSV or a Google Sheet import matches an owner column against (see referenceMatchers.js), so an
   * admin preparing one reads it off the same row as the name without hunting through 60-odd
   * columns for it. Blank means exactly what it looks like - nobody has been given a login yet -
   * not a column that failed to load; Login Credentials on the employee is where one is created.
   */
  ["loginUsername", "Username", undefined, 200, 170], ["employmentStatus", "Employment Status", "status", 220, 170], ["contactNumber", "Contact Number", undefined, 180, 150], ["emailId", "Email ID", undefined, 220, 180], ["loginEmail", "Login Email", undefined, 240, 200], ["dateOfJoining", "Date Of Joining", "date"], ["designation", "Designation"], ["department", "Department"], ["skills", "Skills"], ["vertical", "Vertical"], ["workBaseLocation", "Work Base Location"], ["currentWorkLocation", "Current Work Location"], ["photoShooter", "Photo Shooter", "boolean"], ["workType", "Work Type"], ["languagesKnown", "Languages Known"], ["gender", "Gender", undefined, 140, 120], ["bloodGroup", "Blood Group"], ["emergencyContactName", "Emergency Contact Name"], ["emergencyContactNumber", "Emergency Contact Number"], ["emergencyContactRelationship", "Emergency Contact Relationship"], ["aadharCardNumber", "Aadhar Card Number"], ["aadharCardImageUrl", "Aadhar Card Photo", "image", 150, 130], ["panCardNumber", "PAN Card Number"], ["panCardImageUrl", "PAN Card Photo", "image", 150, 130], ["qualificationSummary", "Qualifications"], ["experienceSummary", "Experience"], ["fatherName", "Father's Name"], ["motherName", "Mother's Name"], ["dateOfBirth", "Date Of Birth", "date"], ["maritalStatus", "Marital Status"], ["weddingAnniversary", "Wedding Anniversary", "date"], ["currentAddress", "Current Address"], ["permanentAddress", "Permanent Address"], ["reference1PersonName", "Reference-1 Persons Name"], ["reference1PersonPhone", "Reference-1 Persons Phone"], ["reference1PersonAddress", "Reference-1 Persons Address"], ["reference2PersonName", "Reference-2 Persons Name"], ["reference2PersonPhone", "Reference-2 Persons Phone"], ["reference2PersonAddress", "Reference-2 Persons Address"], ["bankName", "Bank Name"], ["bankLocation", "Bank Location"], ["accountNumber", "Account Number"], ["ifscCode", "IFSC Code"], ["dateOfRelieving", "Date of Relieving", "date"], ["relievingRemarks", "Relieving Remarks"], ["totalSalary", "Total Salary", "number"], ["joiningSalary", "Joining Salary", "number"], ["lastReviewDate", "Last Review Date", "date"], ["nextReviewDate", "Next Review Date", "date"], ["totalIncrement", "Total Increment", "number"], ["remarksDetails", "Remarks Details"], ["inviteCreatedAt", "Invite Created At", "date"], ["inviteExpiresAt", "Invite Expires At", "date"],
];

const statusStyles = { Active: "bg-emerald-500", "in Training": "bg-blue-500", PIP: "bg-amber-500", Relieved: "bg-slate-500", Absconded: "bg-red-500", "Long Leave": "bg-violet-500", Fired: "bg-red-700", "HR Onboarding Pending": "bg-orange-400", "Employee Submission Pending": "bg-sky-500", Submitted: "bg-amber-500", Approved: "bg-emerald-500", Rejected: "bg-red-500", Withdrawn: "bg-slate-500" };
// `canWrite` comes in as a prop rather than being read here, because this table is also used by
// screens outside the Employee Repository - the permission that governs it belongs to the page.
function RowActions({ employee, onEdit, onReview, onDelete, onCancelInvite, onCopyInviteLink, onEditInvite, onSendBack, onSeparate, onReactivate, onView, canWrite = true }) {
  const pending = employee.employmentStatus === "HR Onboarding Pending";
  // Someone already on a departure status has an offboarding on record, so the menu offers to open
  // it rather than to start a second one.
  const offboarded = ["Relieved", "Absconded", "Fired"].includes(employee.employmentStatus);
  const items = employee.type === "invite" ? [
    // Copying the link is a read of an invite that already exists; cancelling it is not.
    // Every invite with a short code carries its link on every read. Only an invite from before
    // short links has none — its token is hashed away, so a fresh invite is the only way back.
    employee.onboardingUrl ? { label: "Copy Link", onSelect: () => onCopyInviteLink?.(employee) } : { label: "Copy Link", description: "This older invite's link cannot be rebuilt — cancel it and re-invite to get one." },
    /*
     * Correcting the details an invite was sent on - a mistyped address, a wrong digit in the
     * number - without issuing a new link.
     *
     * On the invite rows only, and that is the point rather than an accident: an employee whose
     * submission was sent back has a record of their own, edited through Edit Employee, and their
     * invite's details are what they already filled the form in against. There is nothing to
     * correct on it and the server refuses the attempt.
     *
     * Not offered once the invite is Cancelled or Submitted either, which is the same line the
     * endpoint draws: cancelling is a decision an edit must not quietly undo, and a submitted
     * invite's details belong to the submission. An **Expired** one is editable, its expiry being
     * one of the fields.
     */
    ...(canWrite && onEditInvite && ["Created", "Verified", "Expired"].includes(employee.inviteStatus)
      ? [{ label: "Edit Invite", onSelect: () => onEditInvite(employee) }]
      : []),
    /*
     * Withdrawing a hire that fell through, through the same form an employee is offboarded with.
     *
     * The two entries are different decisions and both belong here. **Start Offboarding** records
     * what happened - the type, the reason, the date - and the row moves to the InActive tab, where
     * Move to Active can bring it back; the endpoint turns the invite into an employee record to
     * hold that, because a separation is a row against an employee id and an unsubmitted invite has
     * none. **Cancel Invite** is the other case: an invite sent by mistake or to the wrong address,
     * which is not a departure and leaves nothing worth keeping.
     */
    ...(canWrite ? [{ label: "Start Offboarding", onSelect: () => onSeparate(employee) }] : []),
    ...(canWrite ? [{ label: "Cancel Invite", tone: "danger", onSelect: () => onCancelInvite(employee) }] : []),
  ] : canWrite ? [
    { label: pending ? "Review" : "Edit", onSelect: () => (pending ? onReview : onEdit)(employee) },
    /*
     * The candidate's own onboarding link, on the employee row as well as on the invite one.
     *
     * A submission that has been sent back leaves the employee on Employee Submission Pending
     * holding a link that works - the same link they were first sent, reopened rather than
     * reissued. Copy Link was offered only on the rows that had never been submitted, so that tab
     * showed it on some rows and not on the ones where somebody most often needs it: the candidate
     * who says the mail never arrived, or whose send-back email the studio could not send because
     * its daily quota was spent.
     *
     * `onboardingLinkOpen` and not the mere presence of a URL: a Submitted or expired invite still
     * has one, and copying it would hand somebody a link that answers "this onboarding invite has
     * already been submitted".
     */
    ...(employee.onboardingUrl && employee.onboardingLinkOpen
      ? [{ label: "Copy Link", onSelect: () => onCopyInviteLink?.(employee) }]
      : []),
    /*
     * Reopens the submission under its original link and emails the candidate to edit it, so it
     * only exists while the submission is still HR's to review.
     *
     * `hasOnboardingSubmission` and not the status: an employee added by hand through Add Employee
     * also starts on HR Onboarding Pending, and there is no submission behind that row to reopen -
     * offering it there put up a button whose only possible answer was "nothing to send back".
     *
     * Login credentials have no entry here at all: they are created inside the approval flow, where
     * Approve & Onboard leads straight to the credential form, and nowhere else.
     */
    ...(pending && onSendBack && employee.hasOnboardingSubmission ? [{ label: "Send Back", onSelect: () => onSendBack(employee) }] : []),
    /*
     * On every employee row, the two onboarding statuses included.
     *
     * It was withheld from those two for a while, on the reasoning that there is nothing to offboard
     * somebody from before they have been taken on. In practice a hire falls through at exactly that
     * point - the candidate stops answering, or takes another offer, while their row sits on HR
     * Onboarding Pending or Employee Submission Pending - and the studio still has to record what
     * happened and get the row out of the onboarding tabs. Withholding it left those rows waiting
     * for a submission that was never coming, with nothing to say so but deleting the record.
     *
     * The status that follows is the separation type's own, the same as for anybody else, so such a
     * row moves to Relieved or Absconded and lands in InActive. **Move to Active** below is what
     * takes it back, and it returns the row to the onboarding status it actually held rather than
     * promoting a candidate who never started to Active - see `returningStatus` on the endpoint.
     */
    { label: offboarded ? "Open Offboarding" : "Start Offboarding", onSelect: () => onSeparate(employee) },
    /*
     * The way out of the InActive tab, for everybody in it.
     *
     * The tab holds two different situations and one intention: a departure on record - Relieved,
     * Fired, Absconded - and a `Long Leave`, which is a status and nothing else. Both are somebody
     * the studio wants back at work, and until this there was no way to say so from the repository
     * at all: the only thing that restored a status was removing the separation, which had no
     * control anywhere in the application.
     *
     * Read off `isWorking` rather than a list of departure statuses, so a status the studio adds
     * in Field Settings and does not mark as working is offered this too. The onboarding statuses
     * are excluded on the same grounds the offboarding entry excludes them: there is nothing to
     * come back from before somebody has started.
     */
    ...(onReactivate && !isWorking(employee) && !isOnboarding(employee)
      ? [{ label: "Move to Active", onSelect: () => onReactivate(employee) }]
      : []),
    { label: "Delete", tone: "danger", onSelect: () => onDelete(employee) },
  ] : [];
  // View leads the menu and is offered whatever the reader may change: on a touch screen it is the
  // only way into the record view, a double-click there being the browser's zoom gesture.
  const withView = onView ? [{ label: "View", onSelect: () => onView(employee) }, ...items] : items;
  if (!withView.length) return null;
  return <OptionsMenu ariaLabel={`Actions for ${employee.employeeName}`} items={withView} />;
}

/** `fields` decides the columns, so the Separations tab can show its own short set of them. */
export default function EmployeeTable({ employees, fields = employeeFields, exportFileName = "employee-repository", loading, density, freezeCount, selectedEmployeeId, onEdit, onReview, onDelete, onCancelInvite, onCopyInviteLink, onEditInvite, onSendBack, onSeparate, onReactivate, onRowClick, onRowDoubleClick, onTableNotice, onInfiniteStats, onFreezeColumnsChange, onImported, selection, canWrite = true }) {
  /*
   * No Sl. No. on this table, the same way Employee Attendance drops it.
   *
   * A row number counts positions in a page rather than describing the person in the row: it renumbers
   * itself when the table is sorted or filtered, and this table is sorted and filtered constantly and
   * is paged besides - so "the third one" means a different employee on every visit and cannot be
   * quoted to anybody. The record already has a number people do quote, the Employee ID, and it is a
   * column of its own.
   *
   * Dropped from the shared builder rather than removed from it: Accounts, Payment Requests, Tasks
   * and Employee Reviews still show theirs.
   *
   * Taken out of the default visibility too, not only the columns. Manage Columns is built from that
   * map, and a key with no column behind it is a tick box that hides nothing.
   */
  const defaultVisibility = useMemo(() => {
    const visibility = defaultVisibilityFor(fields);
    delete visibility.serial;
    return visibility;
  }, [fields]);
  const columns = useMemo(() => buildTableColumns({
    fields,
    statusStyles,
    renderActions: (employee) => <RowActions employee={employee} onView={onRowDoubleClick} onEdit={onEdit} onReview={onReview} onDelete={onDelete} onCancelInvite={onCancelInvite} onCopyInviteLink={onCopyInviteLink} onEditInvite={onEditInvite} onSendBack={onSendBack} onSeparate={onSeparate} onReactivate={onReactivate} canWrite={canWrite} />,
  }).filter((column) => column.id !== "serial"), [canWrite, fields, onCancelInvite, onCopyInviteLink, onEditInvite, onSendBack, onDelete, onEdit, onReactivate, onRowDoubleClick, onSeparate, onReview]);

  return <DataTable columns={columns} data={employees} importConfig={canWrite ? { prefix: "/api/hrm/employees", columns: EMPLOYEE_IMPORT_COLUMNS, templateName: "employee-import-template", title: "Import Employees", onImported } : undefined} density={density} loading={loading} loadingMessage="Loading employees..." emptyMessage="No employees found." noMatchMessage="No matching employees found." selectedRowId={selectedEmployeeId} onRowClick={onRowClick} onRowDoubleClick={onRowDoubleClick} defaultColumnVisibility={defaultVisibility} onVisibleRowsChange={onInfiniteStats} ariaLabel="Employee table" features={{ filtering: true, sorting: true, columnVisibility: true, columnResize: true, frozenColumns: { count: freezeCount, onChange: onFreezeColumnsChange }, infiniteScroll: { pageSize: 50 }, csvExport: { enabled: true, fileName: exportFileName, onResult: (exported) => onTableNotice?.(exported ? "Employee Repository CSV export downloaded." : "No rows available to export.") },
    // The tick boxes, decided by the page. This table draws what it is handed and holds nothing.
    selection }} />;
}
