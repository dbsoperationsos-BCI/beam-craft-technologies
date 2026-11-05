import { redirect } from "next/navigation";

// Users and Roles are their own routes so the sidebar can point at each and highlight the one being
// looked at. Bare /admin is kept as a way in and sends you to the first of them.
export default function AdminRoute() {
  redirect("/admin/users");
}
