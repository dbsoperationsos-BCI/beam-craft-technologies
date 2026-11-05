import EmployeeReferralsPage from "@/components/hrm/EmployeeReferralsPage";

/*
 * A static segment, so it wins over the `[module]` master-data route beside it — /hrm/employee-referrals
 * reaches this page rather than being looked up as a master data list and answered with a 404.
 */
export default function Page() {
  return <EmployeeReferralsPage />;
}
