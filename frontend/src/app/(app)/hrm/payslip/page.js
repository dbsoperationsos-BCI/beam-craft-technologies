import MyPayslipPage from "@/components/hrm/MyPayslipPage";

/*
 * HRM → Payslip: the signed-in employee's own payslips. A static segment, so it wins over the
 * `[module]` master-data route beside it.
 */
export default function HrmPayslipRoute() {
  return <MyPayslipPage />;
}
