/**
 * The quiet middle of a pane with nothing in it yet, with room for the one action that fills it.
 * `size="lg"` with an `icon` is the first-time screen - an event with no folder - where the empty
 * state is the whole pane and has to carry the first step on its own.
 */
export default function EmptyState({ title, message, action, icon, size = "md", className = "" }) {
  const large = size === "lg";
  return <div className={`flex flex-col items-center justify-center gap-2 px-4 text-center ${large ? "py-16" : "py-12"} ${className}`}>
    {icon && <div className={`mb-1 grid place-items-center rounded-full bg-blue-50 text-blue-600 ${large ? "h-16 w-16" : "h-10 w-10"}`}>{icon}</div>}
    <p className={large ? "text-lg font-semibold text-slate-800" : "text-sm font-medium text-slate-700"}>{title}</p>
    {message && <p className={`max-w-md text-slate-500 ${large ? "text-sm" : "text-xs"}`}>{message}</p>}
    {action && <div className={large ? "mt-4" : "mt-2"}>{action}</div>}
  </div>;
}
