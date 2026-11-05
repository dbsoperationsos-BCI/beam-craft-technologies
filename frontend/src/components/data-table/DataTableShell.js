export default function DataTableShell({ children, footer, className = "" }) {
  return <section className={`flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}>{children}{footer}</section>;
}
