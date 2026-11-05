"use client";

import { useState } from "react";
import DesktopWindowsOutlined from "@mui/icons-material/DesktopWindowsOutlined";
import Download from "@mui/icons-material/Download";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import Microsoft from "@mui/icons-material/Microsoft";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import { WINDOWS_RELEASE } from "@/lib/desktopRelease.mjs";
import { findMissingInstallerStatus } from "@/services/desktop/desktopRelease.service";

/**
 * Where the Visual Curation desktop app is downloaded from — opened by the icon beside the sidebar's
 * Visual Curation heading. It never downloads on open: the download starts from the button.
 *
 * `release` is the published Windows installer (see `lib/desktopRelease.mjs`); without one the
 * dialog says the app is not published yet rather than offering a link that goes nowhere. Every
 * fact on the card — version, format, size — comes from that release, never from here.
 *
 * Whether the download started or failed is said by the app's snackbar, which the sidebar owns
 * (`onStarted` / `onFailed`), so the message outlives the dialog if the reader closes it.
 */

function startBrowserDownload(url, fileName) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function MetaPill({ children }) {
  return <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-600">{children}</span>;
}

export default function DesktopAppDownloadDialog({ onClose, onStarted, onFailed, release = WINDOWS_RELEASE }) {
  const [status, setStatus] = useState("idle");

  async function download() {
    if (!release || status === "checking") return;
    setStatus("checking");
    if (await findMissingInstallerStatus(release.url)) {
      setStatus("failed");
      onFailed?.("The installer isn't available right now. Try again later or contact your administrator.");
      return;
    }
    try {
      startBrowserDownload(release.url, release.fileName);
      setStatus("started");
      onStarted?.("Your download has started. Check your browser's downloads.");
    } catch {
      setStatus("failed");
      onFailed?.("The download could not be started. Try again.");
    }
  }

  const meta = release ? [release.version && `Version ${release.version}`, release.installerType, release.size].filter(Boolean) : [];

  return <Dialog
    title="Download Visual Curation Desktop App"
    icon={<DesktopWindowsOutlined style={{ fontSize: 22 }} />}
    size="md"
    onClose={onClose}
    footer={<>
      <Button size="lg" onClick={onClose}>Close</Button>
      {release && <Button size="lg" variant="primary" onClick={download} busy={status === "checking"} busyLabel="Preparing download…" className="gap-2 shadow-sm">
        <Download aria-hidden="true" style={{ fontSize: 18 }} />
        {status === "started" ? "Download again" : "Download for Windows"}
      </Button>}
    </>}
  >
    <section aria-label="Windows installer" className="flex items-center gap-3.5 rounded-[14px] border border-slate-200 bg-linear-to-b from-white to-slate-50/80 p-4">
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
        <Microsoft style={{ fontSize: 22 }} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-600">Windows</p>
        <h3 className="mt-0.5 text-base font-semibold text-slate-900">Visual Curation Desktop</h3>
        {release
          ? <div className="mt-2 flex flex-wrap gap-1.5">{meta.map((item) => <MetaPill key={item}>{item}</MetaPill>)}</div>
          : <p className="mt-1 text-sm text-slate-500">Not published yet</p>}
      </div>
    </section>
    {!release && <div className="mt-4 flex items-start gap-2.5 rounded-[14px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm leading-5 text-slate-700">
      <InfoOutlined aria-hidden="true" style={{ fontSize: 18 }} className="mt-px shrink-0 text-slate-500" />
      <p className="min-w-0">The Windows installer hasn&apos;t been published for this workspace yet. Ask your administrator to publish the desktop release.</p>
    </div>}
  </Dialog>;
}
