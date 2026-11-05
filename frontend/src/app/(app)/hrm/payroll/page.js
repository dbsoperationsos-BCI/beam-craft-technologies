import { Suspense } from "react";
import PayrollPage from "@/components/hrm/PayrollPage";

/*
 * HRM → Payroll. A static segment, so it wins over the `[module]` master-data route beside it. The
 * Suspense boundary is what `useSearchParams` needs: the page reads its section from `?section=`.
 */
export default function HrmPayrollRoute() {
  return <Suspense fallback={null}><PayrollPage /></Suspense>;
}
