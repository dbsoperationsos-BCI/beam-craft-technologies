"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import { CardState } from "@/components/shared/DashboardCard";
import A4DocumentPreview from "@/components/shared/A4DocumentPreview";
import { downloadSamplePayslipPdf, getPayslipTemplate } from "@/services/hrm/payrollRegister.service";

/*
 * Settings → Payroll rules → Payslip template: the sample payslip on an A4 sheet, exactly as the
 * PDF prints it (the server's own HTML), below Edit Payslip.
 *
 * Its heading is not typed here: the logo and the company's name are Organization → Branding Logo's,
 * and the address is the Head Office branch's in Organization → Branches, so each is kept in one
 * place and a change there reaches every payslip. Nothing is chosen here: which items a payslip
 * carries is Edit Payslip's, above it; the PF / personal-only setting (`details`) is no longer chosen
 * anywhere and stays as it was saved. Behind `HRM / Payroll Register` Read, as the rest of Payroll
 * rules: the preview, and the sample PDF.
 */

export default function PayslipTemplatePanel({ onNotice, onError }) {
  // The sample payslip as the PDF prints it - the server's own document, so preview and download match.
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setHtml((await getPayslipTemplate())?.data?.html || "");
    } catch (requestError) {
      setLoadError(requestError?.message || "Unable to load the payslip template.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // The saved template, printed with the sample figures - the way a payslip will look on paper.
  async function downloadSample() {
    setDownloading(true);
    try {
      await downloadSamplePayslipPdf();
      onNotice?.("Sample payslip downloaded.");
    } catch (requestError) {
      onError?.(requestError?.message || "Unable to download the sample payslip.");
    } finally {
      setDownloading(false);
    }
  }

  return <CardState loading={loading} error={loadError} onRetry={load} rows={4}>
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" busy={downloading} busyLabel="Preparing PDF..." onClick={downloadSample}>Download sample PDF</Button>
      </div>
      <A4DocumentPreview html={html} title="Payslip template preview" />
    </div>
  </CardState>;
}
