import { Suspense } from "react";
import EmployeeAttendancePage from "@/components/hrm/EmployeeAttendancePage";

// The Suspense boundary is what `useSearchParams` needs: the page reads `?section=request`, the
// bell's link for a request waiting on this person. `null` because the shell is already drawn.
export default function Page() {
  return <Suspense fallback={null}><EmployeeAttendancePage /></Suspense>;
}
