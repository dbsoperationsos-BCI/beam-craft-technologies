/** The quiet middle of a pane with nothing in it yet, with room for the one action that fills it. */
export default function EmptyState({ title, message, action, className = "" }) {
  return <div className={`flex flex-col items-center justify-center gap-2 px-4 py-12 text-center ${className}`}>
    <p className="text-sm font-medium text-slate-700">{title}</p>
    {message && <p className="max-w-md text-xs text-slate-500">{message}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>;
}
