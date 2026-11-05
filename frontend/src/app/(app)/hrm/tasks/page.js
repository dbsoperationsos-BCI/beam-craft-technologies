import { Suspense } from "react";
import TasksPage from "@/components/hrm/TasksPage";

/*
 * A static segment, so it wins over the `[module]` master-data route beside it — /hrm/tasks reaches
 * this page rather than being looked up as a master data list and answered with a 404.
 *
 * The Suspense boundary is what `useSearchParams` needs: the page reads `?task=` so the bell can
 * open a task directly, and a production build of a static page calling that hook without a
 * boundary fails outright. `null` as the fallback because the shell around it is already drawn and
 * a spinner between it and the table would only flash.
 */
export default function HrmTasksRoute() {
  return <Suspense fallback={null}><TasksPage /></Suspense>;
}
