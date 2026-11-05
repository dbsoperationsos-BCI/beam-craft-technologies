import { apiRequest } from "@/services/api/client";

/**
 * Reads one PDF - a bank statement or a receipt - and returns the money received it shows, each
 * transaction marked when its reference is already in the cash book. Nothing is recorded: every
 * row is filed afterwards through `createCashEntry`. The password opens the file and is not kept.
 */
export function extractStatement({ fileName, data, password = "" }) {
  return apiRequest("/api/accounts/statement-import/extract", {
    method: "POST",
    body: JSON.stringify({ fileName, data, password }),
  });
}
