"use client";

import Button from "@/components/shared/Button";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { MESSAGE_LABELS } from "@/lib/productionSteps.mjs";
import { retryProductionMessage } from "@/services/project-management/production.service";

/** How a step's WhatsApp message went: sent, sending, or "Not sent · Retry" with the reason. */
export default function ProductionMessageStatus({ shootId, message, canRetry, onDetail, onError }) {
  const { busy, run } = useSubmitOnce();
  if (message.status === "SENT") return <p className="text-xs text-green-700">✓ WhatsApp sent</p>;
  if (message.status === "SENDING") return <p className="text-xs text-slate-500">Sending…</p>;

  async function retry() {
    await run(async () => {
      onError("");
      try {
        const response = await retryProductionMessage(shootId, message.step);
        onDetail(response?.data, response?.message?.status === "SENT" ? `${MESSAGE_LABELS[message.step]} message sent.` : undefined);
        if (response?.message?.status === "FAILED") onError(response.message.reason || "The message was not sent.");
      } catch (error) {
        onError(error.message || "Unable to retry the message.");
      }
    });
  }

  return <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
    <span className="font-semibold">Not sent</span>
    <span className="min-w-0 flex-1 break-words">{message.reason}</span>
    {canRetry && <Button type="button" size="lg" className="w-full sm:w-auto" busy={busy} busyLabel="Retrying..." onClick={() => void retry()}>Retry</Button>}
  </div>;
}
