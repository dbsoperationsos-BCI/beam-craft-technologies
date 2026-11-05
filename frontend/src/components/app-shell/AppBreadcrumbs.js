"use client";

import { usePathname } from "next/navigation";

const labels = { hrm: "HRM", tasks: "Tasks", sales: "Sales", manager: "Sales Manager", quotation: "Quotation", "crd-documents": "CRD Documents", "client-gifts": "Client Gifts", "employment-types": "Employment Types", "work-types": "Work Types", "employee-statuses": "Employee Statuses" };
const readable = (segment) => labels[segment] || segment.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

export default function AppBreadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  // Pages that carry their own title in a module header, so a breadcrumb above it would repeat it.
  const pageOwnedBreadcrumbs = ["/sales/manager", "/sales/quotation", "/sales/crd-documents", "/project-management/projects", "/project-management/crd-documents", "/project-management/client-gifts", "/accounts/manager"];
  if (segments.length === 0 || pathname === "/employees" || pageOwnedBreadcrumbs.includes(pathname)) return null;
  return <nav aria-label="Breadcrumb" className="mx-auto mb-5 flex max-w-7xl items-center gap-2 text-sm text-slate-500">{segments.map((segment, index) => <span key={`${segment}-${index}`} className="flex items-center gap-2">{index > 0 && <span className="text-slate-300">/</span>}<span className={index === segments.length - 1 ? "font-medium text-slate-700" : ""}>{readable(segment)}</span></span>)}</nav>;
}
