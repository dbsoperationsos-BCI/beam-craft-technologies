import SaleStatusChip from "./SaleStatusChip";

const FACE_STATE_LABELS = { READY: "Ready", WORKER_ELSEWHERE: "Ready", STARTING: "Starting", ENGINE_OFFLINE: "Offline", MODEL_MISSING: "Model missing", NOT_CONFIGURED: "Not set up" };

/**
 * What this server's Photo Selling is set up for, said plainly so nobody believes a test payment is
 * real money, or wonders why photos cannot be uploaded or guests cannot search by selfie. Read from
 * GET /api/photo-selling/status (or the `server` block the overview and a gallery carry). Selfie
 * search is the face engine as it is running now (`faceMatching.state`), not only its settings.
 * Payments keeps its explanation; Originals storage and Selfie search show their status alone - why
 * either is not ready is said where it blocks, in a gallery's publish checklist.
 */
export default function ServerStatusBanner({ server, className = "" }) {
  if (!server) return null;
  const { payments, faceMatching, originals } = server;
  const sandbox = payments.environment !== "PRODUCTION";
  // One row per part, stacked at every width - rows without text would otherwise run on into each other.
  return <div className={`flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 ${className}`} role="status">
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-semibold text-slate-700">Payments</span>
      {payments.enabled
        ? <SaleStatusChip tone={sandbox ? "amber" : "green"}>{sandbox ? "Test mode - no real money" : "Live"}</SaleStatusChip>
        : <SaleStatusChip tone="red">{payments.credentials === "INVALID" ? "Keys refused" : "Not set up"}</SaleStatusChip>}
      {!payments.enabled && <span className="min-w-0 wrap-break-word">{payments.reason ? `${payments.reason} ` : ""}Guests can find their photos, but cannot pay until it is.</span>}
      {payments.enabled && payments.credentials === "UNREACHABLE" && <span className="min-w-0 wrap-break-word">Cashfree couldn&apos;t be reached to check this server&apos;s keys just now - checked again within half an hour.</span>}
      {payments.enabled && !payments.webhookAddressSet && <span>A payment is confirmed when the buyer comes back to their order page, when you check it, or by the server&apos;s own check within ten minutes.</span>}
    </span>
    {originals && <span className="flex flex-wrap items-center gap-2">
      <span className="font-semibold text-slate-700">Originals storage</span>
      <SaleStatusChip tone={originals.ready ? "green" : "red"}>{originals.ready ? "Ready" : "Not set up"}</SaleStatusChip>
    </span>}
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-semibold text-slate-700">Selfie search</span>
      <SaleStatusChip tone={faceMatching.available ? "green" : faceMatching.state === "STARTING" ? "amber" : "red"}>{FACE_STATE_LABELS[faceMatching.state] || (faceMatching.available ? "Ready" : "Not set up")}</SaleStatusChip>
    </span>
  </div>;
}
