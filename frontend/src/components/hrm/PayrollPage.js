"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import Loader from "@/components/shared/Loader";
import DropdownMenu from "@/components/ui/DropdownMenu";
import PayrollAdvanceSection from "@/components/hrm/PayrollAdvanceSection";
import PayrollMainSection from "@/components/hrm/PayrollMainSection";
import PayrollRecoverySection from "@/components/hrm/PayrollRecoverySection";

/*
 * HRM → Payroll (`/hrm/payroll`, `HRM / Payroll`): four sections behind one switch beside the
 * heading, the way Employee Attendance holds its Dashboard, Register and the rest - Main Page,
 * Advance Salary, Recovery and Policy Breach. (An employee's own payslips are My Profile → Payslip.)
 *
 * **Main Page** is the monthly payroll register (`PayrollMainSection`), behind its own
 * `HRM / Payroll Register`; **Advance Salary** the register of amounts paid ahead of salary
 * (`PayrollAdvanceSection`), behind `HRM / Payroll Advance`; **Recovery** the register of amounts
 * taken back from salary over months (`PayrollRecoverySection`), behind `HRM / Payroll Recovery`;
 * **Policy Breach** the register of fines taken from salary over months (the same section,
 * `kind="policy-breach"`), behind `HRM / Payroll Policy Breach` - what each employee is paid, advanced,
 * owes or is fined is not for everybody who opens Payroll - so each is offered only with its
 * permission, and absent without it; a login holding none of the four is told so.
 *
 * The section open lives in the address (`?section=advance-salary`, `recovery`, `policy-breach`, and no
 * query for the Main Page), so a refresh, the Back button or a bookmark reopens the same one. A login
 * that may not open the Main Page lands on the first section it may.
 */
const SECTION_MAIN = "main";
const SECTION_ADVANCE_SALARY = "advance-salary";
const SECTION_RECOVERY = "recovery";
const SECTION_POLICY_BREACH = "policy-breach";

const SECTIONS = [
  { label: "Main Page", value: SECTION_MAIN, permission: ["HRM", "Payroll Register", "READ"] },
  { label: "Advance Salary", value: SECTION_ADVANCE_SALARY, permission: ["HRM", "Payroll Advance", "READ"] },
  { label: "Recovery", value: SECTION_RECOVERY, permission: ["HRM", "Payroll Recovery", "READ"] },
  { label: "Policy Breach", value: SECTION_POLICY_BREACH, permission: ["HRM", "Payroll Policy Breach", "READ"] },
];
const DEEP_LINK_SECTIONS = new Set([SECTION_ADVANCE_SALARY, SECTION_RECOVERY, SECTION_POLICY_BREACH]);

export default function PayrollPage() {
  const router = useRouter();
  const requestedSection = useSearchParams().get("section");
  const section = DEEP_LINK_SECTIONS.has(requestedSection) ? requestedSection : SECTION_MAIN;
  const setSection = useCallback((next) => {
    router.replace(next && next !== SECTION_MAIN ? `/hrm/payroll?section=${next}` : "/hrm/payroll", { scroll: false });
  }, [router]);
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const sections = SECTIONS.filter((entry) => !entry.permission || hasPermission(...entry.permission));
  // A section this login may not open - a link passed on, a permission taken away - opens the first
  // one it may.
  const shownSection = permissionsLoading || sections.some((entry) => entry.value === section) ? section : sections[0]?.value;

  const sectionSwitch = <div className="min-w-0 sm:border-l sm:border-slate-200 sm:pl-3">
    <DropdownMenu ariaLabel="Payroll section" items={sections} value={shownSection} onChange={setSection} sorted={false} />
  </div>;

  // A section behind a permission waits for the permissions, rather than showing another one first.
  if (permissionsLoading && SECTIONS.find((entry) => entry.value === section)?.permission) {
    return <section className="flex h-full min-h-0 w-full min-w-0 items-center justify-center"><Loader /></section>;
  }
  if (shownSection === SECTION_MAIN) {
    return <PayrollMainSection
      titleAccessory={sectionSwitch}
      canWrite={hasPermission("HRM", "Payroll Register", "READ_WRITE")}
      // Skipping changes Advance Salary, Recovery or Policy Breach too, so it needs that module's write as well - as the server checks.
      canSkipAdvance={hasPermission("HRM", "Payroll Register", "READ_WRITE") && hasPermission("HRM", "Payroll Advance", "READ_WRITE")}
      canSkipRecovery={hasPermission("HRM", "Payroll Register", "READ_WRITE") && hasPermission("HRM", "Payroll Recovery", "READ_WRITE")}
      canSkipPolicyBreach={hasPermission("HRM", "Payroll Register", "READ_WRITE") && hasPermission("HRM", "Payroll Policy Breach", "READ_WRITE")}
    />;
  }
  if (shownSection === SECTION_ADVANCE_SALARY) {
    return <PayrollAdvanceSection
      titleAccessory={sectionSwitch}
      canWrite={hasPermission("HRM", "Payroll Advance", "READ_WRITE")}
      // Converting writes a recovery too, so it needs both - as the server checks.
      canConvert={hasPermission("HRM", "Payroll Advance", "READ_WRITE") && hasPermission("HRM", "Payroll Recovery", "READ_WRITE")}
    />;
  }
  if (shownSection === SECTION_RECOVERY) {
    return <PayrollRecoverySection
      titleAccessory={sectionSwitch}
      canWrite={hasPermission("HRM", "Payroll Recovery", "READ_WRITE")}
      // Undoing a conversion hands advances back to Advance Salary, so it needs both - as the server checks.
      canUndoConversion={hasPermission("HRM", "Payroll Recovery", "READ_WRITE") && hasPermission("HRM", "Payroll Advance", "READ_WRITE")}
    />;
  }

  if (shownSection === SECTION_POLICY_BREACH) {
    return <PayrollRecoverySection
      kind="policy-breach"
      titleAccessory={sectionSwitch}
      canWrite={hasPermission("HRM", "Payroll Policy Breach", "READ_WRITE")}
    />;
  }

  // None of the four is this login's: said, rather than an empty section that is not there.
  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader title="Payroll" />
    <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
      <DashboardCard title="Payroll">
        <CardState empty emptyMessage="Your role has no Payroll section to open - Main Page, Advance Salary, Recovery and Policy Breach each need their own permission." />
      </DashboardCard>
    </div>
  </section>;
}
