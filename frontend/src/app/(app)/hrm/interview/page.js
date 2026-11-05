import InterviewPage from "@/components/hrm/InterviewPage";

/*
 * A static segment, so it wins over the `[module]` master-data route beside it — /hrm/interview
 * reaches this page rather than being looked up as a master data list and answered with a 404.
 */
export default function HrmInterviewRoute() {
  return <InterviewPage />;
}
