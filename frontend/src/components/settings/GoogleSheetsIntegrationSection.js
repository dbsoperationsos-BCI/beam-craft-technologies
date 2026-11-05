"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import HelpTip from "@/components/shared/HelpTip";
import TextField from "@/components/shared/TextField";
import OptionsMenu from "@/components/ui/OptionsMenu";
import CloseButton from "@/components/shared/CloseButton";
import IconButton from "@/components/shared/IconButton";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import SheetAssignmentRulesPanel from "@/components/settings/SheetAssignmentRulesPanel";
import { rulesHaveIssues } from "@/lib/sheetAssignmentRules.mjs";

/**
 * Settings → Integrations, for one module: the cards, the Google account, the linked sheets and
 * everything that can be done to them.
 *
 * This is the whole flow the Sales integration had inside `SettingsOverlay`, lifted out so the
 * Interview integration could be the same screen rather than a second copy of it. What differs
 * between the two is `config` - see `sheetIntegrationConfigs.js`: which routes are called, which
 * tables a sheet may feed, what the rows are called, and where Google sends the browser back to.
 * Everything else - the drill-down from the cards, the link dialog with its assignment rules, the
 * Google Picker, the consent redirect and the draft that survives it, Sync Now, Preview Import,
 * Edit and Delete - is written once here.
 *
 * `onError` and `onNotice` hand messages to the overlay's one notice line, exactly as the inline
 * version set `linkError` and `sectionNotice`; the dialog also prints the current error inline,
 * because a refusal that keeps a dialog open must be readable inside it.
 *
 * Mounted with `key={config.id}`: the two integration sections sit at the same place in the rail's
 * tree, and without the key React would carry one module's linked sheets into the other's panel.
 */

// A sheet syncs every 2 minutes in the background, so "how long ago" reads better than a
// bare timestamp for anything recent; the exact time is kept for older runs.
function formatSyncTime(value) {
  if (!value) return "Not synced yet";
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return "Not synced yet";
  const seconds = Math.max(0, Math.round((Date.now() - when.getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (seconds < 86400) {
    const hours = Math.round(seconds / 3600);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(when);
}

function syncStatusTone(status) {
  const value = String(status || "").toUpperCase();
  if (value === "OK") return "bg-emerald-50 text-emerald-600";
  if (value === "FAILED") return "bg-rose-50 text-rose-600";
  return "bg-amber-50 text-amber-600";
}

// What the run actually did. Counts that are zero are left out, so a quiet sync reads as
// "No changes" rather than a row of noughts.
/**
 * What a successful save or sync says: how many records it added, and nothing else.
 *
 * The full summary (`describeSyncSummary`) counts skipped rows too, and most of a sheet is skipped
 * on every pass simply because it is already here - read as the notice of a save that worked, that
 * looked like a failure. So the notice is the one number the person acted for, "0" included; the
 * rest stays on the link's own row in the list, under Last sync.
 */
function addedNotice(summary, config) {
  const added = Number(summary?.created) || 0;
  const noun = added === 1 ? config?.noun || "record" : config?.nounPlural || "records";
  return `${added.toLocaleString()} ${noun} ${added === 1 ? "was" : "were"} added.`;
}

function describeSyncSummary(summary) {
  if (!summary || typeof summary !== "object") return "No details recorded.";
  if (summary.error) return String(summary.error);
  const parts = [];
  // A sync only ever adds, so `created` is the whole of what it wrote; everything else it read is
  // accounted for under `skipped`.
  if (summary.created) parts.push(`${Number(summary.created).toLocaleString()} created`);
  if (summary.skipped) {
    // Why they were skipped, not only how many. A sheet whose rows are all already here, a rejected
    // one, and one whose rows were deleted on purpose must not read the same - and the first is the
    // ordinary case now, so a quiet sync has to say so rather than look like a sync that did nothing.
    const reasons = [];
    if (summary.skippedExisting) {
      // Of those, the ones recognised by their number or email rather than by which row they came
      // from - a person the register already holds, which is the case somebody may want to look at.
      const sameContact = Number(summary.skippedSameContact) || 0;
      const already = `${Number(summary.skippedExisting).toLocaleString()} already here`;
      reasons.push(sameContact ? `${already}, ${sameContact.toLocaleString()} on a number or email you already have` : already);
    }
    // `skippedInvalid` is only ever 0 now - a row is no longer refused for what one cell holds -
    // but an older sync's stored summary may still carry one, so it is still read.
    if (summary.skippedInvalid) reasons.push(`${Number(summary.skippedInvalid).toLocaleString()} invalid`);
    if (summary.skippedDuplicate) reasons.push(`${Number(summary.skippedDuplicate).toLocaleString()} duplicate`);
    if (summary.skippedDeleted) reasons.push(`${Number(summary.skippedDeleted).toLocaleString()} deleted here`);
    const why = reasons.length ? ` (${reasons.join(", ")})` : "";
    parts.push(`${Number(summary.skipped).toLocaleString()} skipped${why}`);
  }
  /*
   * The cells the importer could not read and left empty - **not** rows it refused.
   *
   * Its own line rather than folded into "skipped", because nothing was skipped: the lead is in the
   * register with one column blank, and this is the studio's cue to go and correct that column in
   * the sheet. Named row by row underneath, where the row problems are already listed.
   */
  if (summary.clearedFields) {
    const count = Number(summary.clearedFields);
    parts.push(`${count.toLocaleString()} field${count === 1 ? "" : "s"} left blank`);
  }
  if (summary.failed) parts.push(`${Number(summary.failed).toLocaleString()} failed`);
  // How the link's assignment rules did, and only where it has some.
  if (summary.assignmentRules) {
    if (summary.assignedByRule) parts.push(`${Number(summary.assignedByRule).toLocaleString()} assigned by rule`);
    if (summary.unassignedRows) parts.push(`${Number(summary.unassignedRows).toLocaleString()} matched no rule`);
  }
  const rows = Number(summary.totalRows || 0);
  const detail = parts.length ? parts.join(", ") : "No changes";
  return rows ? `${detail} · ${rows.toLocaleString()} row${rows === 1 ? "" : "s"} read` : detail;
}

const SheetsIcon = ({ className = "h-12 w-12" }) => (
  <svg aria-hidden="true" viewBox="0 0 48 48" className={className}>
    <rect x="6" y="10" width="28" height="28" rx="6" className="fill-[#1aa86b]" />
    <rect x="10" y="14" width="28" height="28" rx="6" className="fill-[#38c172]" />
    <path d="M24 19v14M17 26h14" className="stroke-white stroke-[3.2]" strokeLinecap="round" />
  </svg>
);

const MeetIcon = ({ className = "h-12 w-12" }) => (
  <svg aria-hidden="true" viewBox="0 0 48 48" className={className}>
    <rect x="8" y="10" width="25" height="28" rx="6" className="fill-[#fbbc04]" />
    <path d="M32 18 40 14v20l-8-4z" className="fill-[#fbbc04]" />
    <circle cx="15" cy="31" r="3.5" className="fill-white" />
  </svg>
);

function integrationCards(config) {
  return [
    {
      id: "google-sheets",
      title: "Google Sheets",
      description: config.sheetsDescription,
      accent: "from-emerald-500 via-cyan-500 to-blue-500",
      icon: <SheetsIcon />,
    },
    {
      id: "google-drive",
      title: "Google Drive",
      description: config.driveDescription,
      accent: "from-blue-500 via-green-500 to-amber-400",
      icon: (
        <svg aria-hidden="true" viewBox="0 0 48 48" className="h-12 w-12">
          <path d="M17 10h14l9 16-7 12H19l-9-16z" className="fill-[#4285f4]" />
          <path d="M23 10h8l9 16h-9z" className="fill-[#34a853]" />
          <path d="M17 10 8 26h9l8-16z" className="fill-[#fbbc04]" />
        </svg>
      ),
    },
    {
      id: "google-meet",
      title: "Google Meet",
      description: config.meet.description,
      accent: "from-amber-400 via-yellow-400 to-orange-400",
      icon: <MeetIcon />,
    },
    {
      id: "more",
      title: "More to come",
      description: "Stay tuned",
      accent: "from-slate-100 via-slate-50 to-white",
      icon: (
        <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-md border border-slate-200 bg-white text-slate-300">
          <AddRoundedIcon style={{ fontSize: 30 }} />
        </span>
      ),
    },
  ];
}

/**
 * The heading of one integration's own panel: back to the grid, what it is, and its action.
 *
 * The back button is the only way out of a detail panel, because the rail entry stays on
 * Integration either way — the drill-down happens inside that section.
 */
function IntegrationDetailHeader({ onBack, title, description, icon, action }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
      <div className="flex min-w-0 items-center gap-3">
        <IconButton onClick={onBack} label={`Back to integrations from ${title}`} className="text-slate-500 hover:text-slate-700">
          <ArrowBackRoundedIcon aria-hidden="true" fontSize="small" />
        </IconButton>
        {icon}
        <div className="min-w-0">
          <h3 className="flex min-w-0 items-center text-base font-medium text-slate-800 sm:text-lg"><span className="truncate">{title}</span><HelpTip text={description} /></h3>
        </div>
      </div>
      {action}
    </div>
  );
}

function IntegrationCard({ title, description, icon, accent }) {
  return (
    <article className="group flex h-full flex-col items-center justify-center rounded-[18px] border border-slate-100 bg-white px-5 py-6 text-center shadow-[0_1px_0_rgba(15,23,42,0.02)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
      <div className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${accent} bg-opacity-10`}>
        {icon}
      </div>
      <h3 className="mt-4 text-[15px] font-semibold leading-6 text-slate-700">{title}</h3>
      <p className="mt-1.5 max-w-[190px] text-[14px] leading-6 text-slate-600">{description}</p>
    </article>
  );
}

let googlePickerLoaderPromise = null;

function loadGooglePickerSdk() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Picker can only be loaded in the browser."));
  }
  if (window.google?.picker) {
    return Promise.resolve(window.google.picker);
  }

  if (!googlePickerLoaderPromise) {
    googlePickerLoaderPromise = new Promise((resolve, reject) => {
      const existingScript = document.getElementById("google-picker-api");
      const finish = () => {
        if (!window.gapi?.load) {
          reject(new Error("Google API loader is unavailable."));
          return;
        }
        window.gapi.load("picker", {
          callback: () => resolve(window.google.picker),
          onerror: () => reject(new Error("Unable to load Google Picker SDK.")),
          timeout: 10000,
          ontimeout: () => reject(new Error("Timed out loading Google Picker SDK.")),
        });
      };

      if (existingScript) {
        if (window.gapi?.load) {
          finish();
        } else {
          existingScript.addEventListener("load", finish, { once: true });
          existingScript.addEventListener("error", () => reject(new Error("Unable to load Google API script.")), { once: true });
        }
        return;
      }

      const script = document.createElement("script");
      script.id = "google-picker-api";
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      script.defer = true;
      script.onload = finish;
      script.onerror = () => reject(new Error("Unable to load Google API script."));
      document.head.appendChild(script);
    });
  }

  return googlePickerLoaderPromise;
}

const PENDING_LINK_TTL_MS = 10 * 60 * 1000;

export default function GoogleSheetsIntegrationSection({ config, initialIntegration = null, onError, onNotice }) {
  const { api } = config;
  const hasVertical = config.tables.some((table) => table.vertical);
  const cards = integrationCards(config);

  // Which integration's own panel is open inside the section, or null for the grid.
  const [activeIntegration, setActiveIntegration] = useState(initialIntegration);
  const [showLinkSpreadsheetDialog, setShowLinkSpreadsheetDialog] = useState(false);
  // Non-empty when the dialog was opened from a row's Edit action rather than to
  // create a new link. Drives the Update wording and the PUT-instead-of-POST path.
  const [editingLinkId, setEditingLinkId] = useState("");
  // "" means: let the backend pick the vertical from the sheet's own columns. Sheets are
  // vertical-shaped (wedding vs corporate vs event), so detection is the right default
  // and pinning every link to whichever vertical the CRM page happened to show is not.
  // A module with one table starts on it, so the dialog does not ask a question with one answer.
  const [systemTableId, setSystemTableId] = useState(config.tables.length === 1 ? config.tables[0].value : "");
  const [vertical, setVertical] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [targetedTab, setTargetedTab] = useState("");
  const [linkedSheets, setLinkedSheets] = useState([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [savingLink, setSavingLink] = useState(false);
  const [syncingLinkId, setSyncingLinkId] = useState("");
  /*
   * The message the section is showing, kept here for the dialog's inline line and mirrored to the
   * overlay's notice line through `onError` - one message, two places it has to be readable.
   */
  const [linkError, setLinkErrorState] = useState("");
  const setLinkError = useCallback((message) => {
    setLinkErrorState(message);
    onError?.(message);
  }, [onError]);
  // The link awaiting delete confirmation, and whether that delete is in flight.
  const [pendingDeleteLink, setPendingDeleteLink] = useState(null);
  const [deletingLink, setDeletingLink] = useState(false);
  const [googleConnection, setGoogleConnection] = useState(null);
  const [loadingGoogleConnection, setLoadingGoogleConnection] = useState(false);
  const [startingGoogleOAuth, setStartingGoogleOAuth] = useState(false);
  const [pickerStatus, setPickerStatus] = useState("");
  /*
   * The rules being written in the link dialog, and the two lists they are written from.
   *
   * Asked for while the sheet is being linked rather than afterwards, because creating a link runs
   * a full import immediately - rules added later would miss the whole first batch.
   */
  const [assignmentRules, setAssignmentRules] = useState([]);
  const [assignableEmployees, setAssignableEmployees] = useState([]);
  // The linked sheet's real column headings, so the column picker offers what the sheet has rather
  // than taking a typo that would silently never match. Empty until the sheet has been read once.
  const [sheetHeaders, setSheetHeaders] = useState([]);
  const [selectedSpreadsheet, setSelectedSpreadsheet] = useState(null);
  const [selectedTab, setSelectedTab] = useState(null);
  const [spreadsheetTabs, setSpreadsheetTabs] = useState([]);
  const [loadingSpreadsheetTabs, setLoadingSpreadsheetTabs] = useState(false);
  const [previewLink, setPreviewLink] = useState(null);
  // Last-sync figures re-read while the preview is open, so a background sync appears
  // without closing and reopening the panel.
  const [liveSync, setLiveSync] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);
  const pickerWindowRef = useRef(null);

  /**
   * Whether an integration's own panel is the thing on screen. The loads and the Google-picker
   * wiring behind a panel must not run while the reader is on the grid.
   */
  const showGoogleSheetsDetail = activeIntegration === "google-sheets";
  const showGoogleMeetDetail = activeIntegration === "google-meet";
  // Meet runs on the same connection as Sheets; the only thing it needs on top is the
  // calendar grant, which an account connected before Meet existed will not have.
  const meetReady = Boolean(googleConnection?.hasCalendarScope);

  const loadGoogleConnection = useCallback(async () => {
    // Both integration panels read this one connection; gating it on the Sheets panel alone
    // is what made Google Meet report "No Google account connected" however many times it
    // was reconnected.
    if (!showGoogleSheetsDetail && !showGoogleMeetDetail) return;
    setLoadingGoogleConnection(true);
    try {
      const response = await api.connection();
      setGoogleConnection(response?.data || null);
    } catch {
      setGoogleConnection(null);
    } finally {
      setLoadingGoogleConnection(false);
    }
  }, [api, showGoogleMeetDetail, showGoogleSheetsDetail]);

  /*
   * `quiet` is the background re-read: no spinner, and what is on screen is kept when the request
   * fails - a momentary blip is not the same statement as "you have no linked sheets".
   */
  const loadLinkedSheets = useCallback(async ({ quiet = false } = {}) => {
    if (!showGoogleSheetsDetail) return;
    if (!quiet) setLoadingLinks(true);
    try {
      const response = await api.list();
      setLinkedSheets(Array.isArray(response?.data) ? response.data : []);
    } catch {
      if (!quiet) setLinkedSheets([]);
    } finally {
      if (!quiet) setLoadingLinks(false);
    }
  }, [api, showGoogleSheetsDetail]);

  /*
   * The employees a rule may name, loaded with the panel. An empty list on failure rather than an
   * error: a rule cannot be completed without an employee, so an empty list refuses the save on
   * its own, in the one place it matters.
   */
  useEffect(() => {
    if (!showGoogleSheetsDetail) return undefined;
    let active = true;
    void api.assignableEmployees()
      .then((response) => { if (active) setAssignableEmployees(Array.isArray(response?.data) ? response.data : []); })
      .catch(() => { if (active) setAssignableEmployees([]); });
    return () => { active = false; };
  }, [api, showGoogleSheetsDetail]);

  /*
   * A linked sheet's real column headings, read in the background when its rules are opened.
   * Failure is silent by design: the panel falls back to a text field with no headings offered.
   */
  // Called from handlers only, never from an effect, so neither needs memoising.
  async function loadSheetHeaders(linkId) {
    if (!linkId) return;
    try {
      const response = await api.preview(linkId);
      const headers = response?.data?.headers;
      if (Array.isArray(headers)) setSheetHeaders(headers);
    } catch {
      setSheetHeaders([]);
    }
  }

  async function loadSpreadsheetTabs(spreadsheetId) {
    const nextSpreadsheetId = String(spreadsheetId || selectedSpreadsheet?.spreadsheetId || "").trim();
    if (!nextSpreadsheetId) return;

    setLoadingSpreadsheetTabs(true);
    setLinkError("");
    try {
      const response = await api.spreadsheetTabs(nextSpreadsheetId);
      const data = response?.data || {};
      const tabs = Array.isArray(data.tabs) ? data.tabs : [];
      setSpreadsheetTabs(tabs);
      if (data.spreadsheetName) {
        setSelectedSpreadsheet((current) => ({
          spreadsheetId: nextSpreadsheetId,
          spreadsheetName: data.spreadsheetName || current?.spreadsheetName || nextSpreadsheetId,
        }));
      }
      setSelectedTab((current) => {
        if (current && tabs.some((tab) => String(tab.sheetId) === String(current.sheetId))) {
          setTargetedTab(current.title || "");
          return current;
        }
        return null;
      });
    } catch (error) {
      if (error?.code === "GOOGLE_RECONNECT_REQUIRED" || error?.status === 401) {
        setLinkError("Google connection expired.");
      } else {
        setLinkError(error?.message || "Unable to load spreadsheet tabs.");
      }
      setSpreadsheetTabs([]);
      setSelectedTab(null);
    } finally {
      setLoadingSpreadsheetTabs(false);
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!showGoogleSheetsDetail) return undefined;
    void loadLinkedSheets();
    void loadGoogleConnection();
    // Re-read while the panel is open, so a sync that fails in the background says so here. Half
    // the sync interval, so a completed pass shows within about a minute.
    const timer = window.setInterval(() => { void loadLinkedSheets({ quiet: true }); }, 60000);
    return () => window.clearInterval(timer);
  }, [showGoogleSheetsDetail, loadLinkedSheets, loadGoogleConnection]);

  // Meet needs the connection as well - it is the same Google account, read for a different
  // grant - but not the linked sheets.
  useEffect(() => {
    if (!showGoogleMeetDetail) return undefined;
    void loadGoogleConnection();
    return undefined;
  }, [showGoogleMeetDetail, loadGoogleConnection]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Signs the Google account out entirely. This is one account behind every Google feature, so
   * it is said plainly: disconnecting stops sheet syncing as well as Meet scheduling. Linked
   * sheets are kept, so reconnecting the same account does not mean setting them all up again.
   */
  const handleDisconnectGoogle = async () => {
    setDisconnectingGoogle(true);
    setLinkError("");
    try {
      const response = await api.disconnect();
      setGoogleConnection(null);
      setLinkError(response?.message || "Google account disconnected.");
    } catch (error) {
      setLinkError(error?.message || "Unable to disconnect the Google account.");
    } finally {
      setDisconnectingGoogle(false);
    }
  };

  const handleStartGoogleOAuth = async () => {
    setStartingGoogleOAuth(true);
    setLinkError("");
    try {
      const response = await api.startOAuth();
      // Noted before leaving the app: the callback returns to a fixed URL, so without this a flow
      // started from Google Meet came back on the Google Sheets panel, and one started from the
      // Interview section came back on Sales.
      if (typeof window !== "undefined") {
        if (activeIntegration) window.sessionStorage.setItem("dbs_google_oauth_return", activeIntegration);
        window.sessionStorage.setItem("dbs_google_oauth_return_section", config.sectionId);
      }
      const authUrl = response?.data?.authUrl;
      if (!authUrl) {
        throw new Error("Google OAuth start URL was not returned.");
      }
      window.location.assign(authUrl);
    } catch (error) {
      console.error("Unable to start Google OAuth:", error);
      setLinkError(error?.message || "Unable to start Google OAuth.");
      setStartingGoogleOAuth(false);
    }
  };

  const handleOpenGooglePicker = async () => {
    setPickerStatus("");
    try {
      const apiKey = String(process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY || "").trim();
      const appId = String(process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID || "").trim();
      if (!apiKey || !appId) {
        throw new Error("Google Picker is not configured. Set NEXT_PUBLIC_GOOGLE_PICKER_API_KEY and NEXT_PUBLIC_GOOGLE_PICKER_APP_ID.");
      }
      await loadGooglePickerSdk();
      const tokenResponse = await api.pickerToken();
      const accessToken = tokenResponse?.data?.accessToken;
      if (!accessToken) {
        throw new Error("Unable to load a Google access token for Picker.");
      }

      const { google } = window;
      if (!google?.picker?.PickerBuilder) {
        throw new Error("Google Picker SDK is not ready.");
      }

      const picker = new google.picker.PickerBuilder()
        .setDeveloperKey(apiKey)
        .setAppId(appId)
        .setOAuthToken(accessToken)
        .setOrigin(window.location.origin)
        .addView(google.picker.ViewId.SPREADSHEETS)
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setMaxItems(1)
        .setCallback((data) => {
          if (data?.action === google.picker.Action.CANCEL) {
            return;
          }
          if (data?.action === google.picker.Action.PICKED) {
            const pickedFile = Array.isArray(data.docs) ? data.docs[0] : null;
            if (pickedFile) {
              const spreadsheetId = String(pickedFile.id || "").trim();
              const spreadsheetName = String(pickedFile.name || "").trim();
              setSelectedSpreadsheet({
                spreadsheetId,
                spreadsheetName: spreadsheetName || spreadsheetId || "Spreadsheet",
              });
              setSelectedTab(null);
              setSpreadsheetTabs([]);
              setPickerStatus("");
              setLinkError("");
              void loadSpreadsheetTabs(spreadsheetId);
            } else {
              setPickerStatus("");
            }
          }
        })
        .build();

      pickerWindowRef.current = picker;
      picker.setVisible(true);
    } catch (error) {
      console.error("Unable to open Google Picker:", error);
      setPickerStatus(error?.message || "Unable to open Google Picker.");
    }
  };

  const resetLinkForm = () => {
    setEditingLinkId("");
    setSheetUrl("");
    setTargetedTab("");
    setSelectedSpreadsheet(null);
    setSelectedTab(null);
    setSpreadsheetTabs([]);
    setSystemTableId(config.tables.length === 1 ? config.tables[0].value : "");
    setVertical("");
    setAssignmentRules([]);
    setSheetHeaders([]);
  };

  const handleSaveSheetLink = async (overrides = null) => {
    setSavingLink(true);
    setLinkError("");
    // Cleared at the start, so the answer always shows - see `handleSyncSheetLink`.
    onNotice?.("");
    try {
      // `overrides` carries a draft restored after the Google consent redirect, when
      // component state has not been re-populated yet.
      const draft = overrides || {
        systemTableId,
        vertical,
        sheetUrl,
        targetedTab: selectedTab?.title || targetedTab,
        spreadsheetId: selectedSpreadsheet?.spreadsheetId || "",
        spreadsheetName: selectedSpreadsheet?.spreadsheetName || "",
        sheetId: selectedTab?.sheetId ?? null,
        editingLinkId,
        // Carried through the Google consent redirect with the rest of the draft: linking a new
        // sheet leaves the page, and rules left behind in component state would be gone by the
        // time the save resumes - silently, with the sheet linked and assigning nobody.
        assignmentRules,
      };
      const editingId = draft.editingLinkId || "";

      if (!draft.spreadsheetId && !draft.sheetUrl) {
        setLinkError("Select a spreadsheet before linking.");
        return;
      }
      if (!draft.targetedTab) {
        setLinkError("Select the tab to import from before linking.");
        return;
      }
      // Said here as well as by the backend, because the backend's refusal comes after the Google
      // redirect: a half-written rule would send the user through a sign-in only to be turned back.
      if (rulesHaveIssues(draft.assignmentRules || [])) {
        setLinkError("Finish or remove the incomplete assignment rule before saving.");
        return;
      }

      // Linking always goes through Google's account chooser first, so the sheet is
      // linked using whichever account is signed in there. `overrides` means we have
      // already been through that redirect and are here to finish the save. Editing an
      // existing link reuses its account, so it saves straight away.
      if (!overrides && !editingId) {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(config.pendingLinkKey, JSON.stringify({ ...draft, savedAt: Date.now() }));
        }
        await handleStartGoogleOAuth();
        return;
      }

      if (!googleConnection && !editingId) {
        setLinkError("Google sign-in did not complete. Please try linking again.");
        return;
      }

      const response = await api.save({
        systemTableName: config.systemTableName,
        systemTableId: draft.systemTableId,
        ...(hasVertical ? { vertical: draft.vertical } : {}),
        sheetUrl: draft.sheetUrl || undefined,
        spreadsheetId: draft.spreadsheetId || undefined,
        spreadsheetName: draft.spreadsheetName || undefined,
        targetedTab: draft.targetedTab,
        assignmentRules: (draft.assignmentRules || []).map((rule) => ({
          columnHeader: rule.columnHeader || "",
          matchValue: rule.matchValue || "",
          targets: (rule.targets || []).map((target) => ({
            employeeId: Number(target.employeeId),
            percent: Number(target.percent),
          })),
        })),
      }, editingId);

      setShowLinkSpreadsheetDialog(false);
      resetLinkForm();
      await loadLinkedSheets();

      const summary = response?.sync || null;
      const verb = editingId ? "Sheet updated" : "Sheet linked";
      if (response?.warning) {
        setLinkError(`${verb}, but the import failed: ${response.warning}`);
      } else {
        // A save that worked is said as one, in the green notice - not on the error line.
        setLinkError("");
        onNotice?.(`${verb}. ${addedNotice(summary, config)}`);
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(config.refreshEvent));
      }
    } catch (error) {
      console.error("Unable to save Google Sheet link:", error);
      setLinkError(error?.message || "Unable to save Google Sheet link.");
      // Re-open the dialog so an interrupted link can be corrected and retried.
      if (overrides) setShowLinkSpreadsheetDialog(true);
    } finally {
      setSavingLink(false);
    }
  };

  // Resume a link that was interrupted by the Google consent redirect. The draft is read straight
  // from sessionStorage rather than from a `google=connected` query param, because the page strips
  // that param before this section is even opened.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!showGoogleSheetsDetail) return;
    if (loadingGoogleConnection || !googleConnection) return;

    const pendingRaw = window.sessionStorage.getItem(config.pendingLinkKey);
    if (!pendingRaw) return;
    window.sessionStorage.removeItem(config.pendingLinkKey);

    let pending = null;
    try {
      pending = JSON.parse(pendingRaw);
    } catch {
      return;
    }
    if (!pending) return;
    if (pending.savedAt && Date.now() - pending.savedAt > PENDING_LINK_TTL_MS) return;

    setSystemTableId(pending.systemTableId || "");
    setVertical(pending.vertical || "");
    setAssignmentRules(Array.isArray(pending.assignmentRules) ? pending.assignmentRules : []);

    if ((pending.spreadsheetId || pending.sheetUrl) && pending.targetedTab) {
      // A save that was interrupted mid-flight: finish it. The draft is passed
      // explicitly because the state writes above are not flushed yet.
      setSheetUrl(pending.sheetUrl || "");
      setTargetedTab(pending.targetedTab);
      setSelectedSpreadsheet({
        spreadsheetId: pending.spreadsheetId,
        spreadsheetName: pending.spreadsheetName || pending.spreadsheetId,
      });
      setSelectedTab({ title: pending.targetedTab, sheetId: pending.sheetId ?? null });
      void handleSaveSheetLink(pending);
      return;
    }

    // Signed in purely to start a new link: open a clean dialog against whichever
    // account was just chosen, so the Picker lists that account's spreadsheets.
    setSheetUrl("");
    setTargetedTab("");
    setSelectedSpreadsheet(null);
    setSelectedTab(null);
    setSpreadsheetTabs([]);
    setAssignmentRules([]);
    setSheetHeaders([]);
    setShowLinkSpreadsheetDialog(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGoogleSheetsDetail, loadingGoogleConnection, googleConnection]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSyncSheetLink = async (linkId) => {
    setSyncingLinkId(linkId);
    setLinkError("");
    /*
     * Cleared at the start, not only replaced at the end.
     *
     * The panel remembers a dismissed notice by its text (`SchemaFormPanel`), and forgets it only
     * when the notice goes empty. A second sync answering the same "0 leads were added." set the
     * identical string, so nothing changed and the notice stayed dismissed - the toast showed on
     * the first sync and on none after, until the page was left and reopened. Emptied here, it
     * renders empty while the request runs, and the answer arrives as new.
     */
    onNotice?.("");
    try {
      const response = await api.sync(linkId);
      const summary = response?.data?.summary || {};
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(config.refreshEvent));
      }
      setLinkError("");
      onNotice?.(`Sync complete. ${addedNotice(summary, config)}`);
      await loadLinkedSheets();
    } catch (error) {
      console.error("Unable to sync Google Sheet link:", error);
      setLinkError(error?.message || "Unable to sync Google Sheet link.");
    } finally {
      setSyncingLinkId("");
    }
  };

  // Deleting asks first. The row is only removed once the confirmation is accepted, which
  // is why there is no undo afterwards.
  const handleDeleteSheetLink = async () => {
    const link = pendingDeleteLink;
    if (!link || deletingLink) return;
    setDeletingLink(true);
    try {
      const response = await api.remove(link.id);
      // The rows went with the link, so the screen behind this panel is showing rows that are no
      // longer there. Same signal Sync Now sends, for the same reason.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(config.refreshEvent));
      }
      const removed = config.deletedCount(response);
      setLinkError(
        removed
          ? `Sheet unlinked and ${removed.toLocaleString()} ${removed === 1 ? config.noun : config.nounPlural} it imported ${removed === 1 ? "was" : "were"} deleted.`
          : `Sheet unlinked. It had no ${config.nounPlural} in ${config.moduleName}.`,
      );
      setPendingDeleteLink(null);
      await loadLinkedSheets();
    } catch (error) {
      setLinkError(error?.message || "Unable to delete Google Sheet link.");
      setPendingDeleteLink(null);
    } finally {
      setDeletingLink(false);
    }
  };

  useEffect(() => {
    if (!previewLink) return undefined;
    let cancelled = false;
    const readLatest = async () => {
      try {
        const response = await api.list();
        const match = (response?.data || []).find((item) => item.id === previewLink.id);
        if (!cancelled && match) {
          setLiveSync({
            lastSyncedAt: match.lastSyncedAt || null,
            lastSyncStatus: match.lastSyncStatus || null,
            lastSyncSummary: match.lastSyncSummary || null,
          });
        }
      } catch {
        // The panel keeps showing the figures it already has.
      }
    };
    // Half the sync interval, so a completed run shows up within about a minute.
    const timer = window.setInterval(readLatest, 60000);
    void readLatest();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, previewLink]);

  const handlePreviewSheetLink = async (link) => {
    setPreviewLink(link);
    setPreviewData(null);
    setLiveSync(null);
    setLoadingPreview(true);
    setLinkError("");
    try {
      const response = await api.preview(link.id);
      setPreviewData(response?.data || null);
    } catch (error) {
      console.error("Unable to load Google Sheet import preview:", error);
      setLinkError(error?.message || "Unable to load Google Sheet import preview.");
      setPreviewLink(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const dialogs = typeof document === "undefined" ? null : createPortal(
    <>
      {showLinkSpreadsheetDialog && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowLinkSpreadsheetDialog(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${config.id}-link-sheet-title`}
            /* One size whatever it holds. `h-` rather than `max-h-`, so adding an assignment
               rule scrolls the body instead of growing the dialog and shifting the buttons out
               from under the cursor; wide enough for a rule's four fields to sit on one line,
               and still the full width of a 360px screen minus its gutter. */
            className="flex h-[min(calc(100dvh-2rem),42rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
              <h2 id={`${config.id}-link-sheet-title`} className="text-lg font-medium text-slate-800">
                {editingLinkId ? "Update Google Sheet" : "Link Google Sheet"}
              </h2>
              <CloseButton
                ariaLabel="Close spreadsheet dialog"
                onClick={() => {
                  setShowLinkSpreadsheetDialog(false);
                  setEditingLinkId("");
                }}
              />
            </header>

            {/* The three fields are the module's own controls at their own sizes, stacked one
                per row, so this dialog reads like every other form in the app. */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
              {/* The two pickers share a row from `sm`; the URL keeps its own, since a
                  spreadsheet link is the one value here that is genuinely long. */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Dropdown
                  mode="input"
                  label={config.tableSelectLabel}
                  ariaLabel={config.tableSelectLabel}
                  placeholder="Select a table"
                  helperText={`Where the ${config.nounPlural} from this sheet are added.`}
                  value={systemTableId}
                  onChange={(nextId) => {
                    setSystemTableId(nextId);
                    setVertical(config.tables.find((table) => table.value === nextId)?.vertical || "");
                  }}
                  options={config.tables.map((table) => ({ label: table.label, value: table.value }))}
                />
                <TextField
                  label="Targeted Tab"
                  value={targetedTab}
                  onChange={(event) => setTargetedTab(event.target.value)}
                  placeholder="New Tab1"
                  helperText="Type the tab's name exactly as it reads at the bottom of the sheet."
                />
              </div>
              <TextField
                label="Google Sheet Name URL"
                value={sheetUrl}
                onChange={(event) => setSheetUrl(event.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                helperText="Paste the spreadsheet's link from your browser's address bar."
              />
              {selectedSpreadsheet && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600 sm:text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-slate-700">{selectedSpreadsheet.spreadsheetName}</span>
                      {selectedTab ? ` · ${selectedTab.title}` : loadingSpreadsheetTabs ? " · Reading tabs..." : ""}
                    </span>
                    <Button type="button" variant="secondary" size="sm" onClick={() => void handleOpenGooglePicker()}>Change spreadsheet</Button>
                  </div>
                  {spreadsheetTabs.length > 0 && (
                    <select
                      aria-label="Spreadsheet tab"
                      className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 sm:text-sm"
                      value={selectedTab ? String(selectedTab.sheetId) : ""}
                      onChange={(event) => {
                        const next = spreadsheetTabs.find((tab) => String(tab.sheetId) === String(event.target.value));
                        setSelectedTab(next || null);
                        setTargetedTab(next?.title || "");
                      }}
                    >
                      <option value="">Select a tab</option>
                      {spreadsheetTabs.map((tab) => <option key={tab.sheetId} value={String(tab.sheetId)}>{tab.title}</option>)}
                    </select>
                  )}
                </div>
              )}
              {pickerStatus && <p role="alert" className="text-xs text-amber-700 sm:text-sm">{pickerStatus}</p>}
              {/* Asked here, while the sheet is being linked, because creating a link imports the
                  whole sheet immediately - rules added afterwards would miss that first batch,
                  which is always the largest one. The same rules then run on every auto-sync. */}
              <SheetAssignmentRulesPanel
                rules={assignmentRules}
                onChange={setAssignmentRules}
                employees={assignableEmployees}
                headers={sheetHeaders}
                disabled={savingLink}
                noun={config.noun}
                nounPlural={config.nounPlural}
                ownerLabel={config.ownerLabel}
              />
              {/* Shown here as well as on the section behind: the checks that reject a link
                  leave this dialog open, so a message rendered only behind it reported the
                  refusal to a part of the page the user cannot see. */}
              {linkError && <p role="alert" className="text-xs text-red-600 sm:text-sm">{linkError}</p>}
            </div>

            <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 px-5 py-4 sm:px-6">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowLinkSpreadsheetDialog(false);
                  setEditingLinkId("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => void handleSaveSheetLink()}
                disabled={savingLink || startingGoogleOAuth}
              >
                {startingGoogleOAuth
                  ? "Opening Google sign-in..."
                  : savingLink
                    ? editingLinkId
                      ? "Updating..."
                      : "Linking..."
                    : editingLinkId
                      ? "Update"
                      : "Link Google Sheet"}
              </Button>
            </footer>
          </section>
        </div>
      )}

      {/* Above the link and preview dialogs (z-150/155), since it can be raised over them. */}
      {pendingDeleteLink && (
        <div
          className="fixed inset-0 z-[165] flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingLink) setPendingDeleteLink(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${config.id}-delete-sheet-link-title`}
            className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <header className="px-5 pt-5 sm:px-6">
              <h2 id={`${config.id}-delete-sheet-link-title`} className="text-base font-semibold text-slate-900 sm:text-lg">
                Delete linked sheet?
              </h2>
              <p className="mt-1.5 text-xs leading-5 text-slate-600 sm:text-sm sm:leading-6">
                <span className="font-medium text-slate-800">
                  {pendingDeleteLink.spreadsheetName || pendingDeleteLink.systemTableName || "This sheet"}
                </span>{" "}
                will stop syncing into {config.moduleName}, and every {config.noun} it imported will be deleted with it.
                The spreadsheet itself is not touched, so linking it again re-imports them.
              </p>
            </header>
            {/* Ghost beside the destructive button, and both at the module's own size: the
                confirmation reads the same as every other one in the app. */}
            <footer className="flex flex-col-reverse gap-3 px-5 py-5 sm:flex-row sm:justify-end sm:px-6">
              <Button type="button" variant="ghost" onClick={() => setPendingDeleteLink(null)} disabled={deletingLink}>
                Cancel
              </Button>
              <Button type="button" variant="danger" onClick={() => void handleDeleteSheetLink()} disabled={deletingLink}>
                {deletingLink ? "Deleting..." : "Delete"}
              </Button>
            </footer>
          </section>
        </div>
      )}

      {previewLink && (
        <div
          className="fixed inset-0 z-[155] flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setPreviewLink(null);
              setPreviewData(null);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${config.id}-import-preview-title`}
            className="flex max-h-[88vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.22)]"
          >
            <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
              <div>
                <h2 id={`${config.id}-import-preview-title`} className="flex items-center text-[18px] font-medium tracking-[-0.02em] text-slate-800 sm:text-[20px]">
                  Google Sheet Import Preview
                  <HelpTip text="Review the mapping and row classifications before any import is enabled." />
                </h2>
              </div>
              <CloseButton
                ariaLabel="Close import preview"
                onClick={() => {
                  setPreviewLink(null);
                  setPreviewData(null);
                }}
              />
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/40 px-5 py-5 sm:px-6">
              {loadingPreview ? (
                <div className="rounded-[16px] border border-dashed border-slate-200 bg-white px-4 py-8 text-[14px] text-slate-500">
                  Loading preview...
                </div>
              ) : previewData ? (
                <div className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="rounded-[16px] border border-slate-200 bg-white p-4">
                      <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Spreadsheet</p>
                      <p className="mt-1 text-[15px] font-medium text-slate-700">{previewData.link?.spreadsheetName || previewLink.spreadsheetName || "—"}</p>
                      <p className="mt-0.5 break-all text-[12px] text-slate-500">{previewData.link?.spreadsheetId || previewLink.spreadsheetId || "—"}</p>
                    </div>
                    <div className="rounded-[16px] border border-slate-200 bg-white p-4">
                      <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Tab</p>
                      <p className="mt-1 text-[15px] font-medium text-slate-700">{previewData.link?.targetedTab || previewLink.targetedTab || "—"}</p>
                    </div>
                    <div className="rounded-[16px] border border-slate-200 bg-white p-4">
                      <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Google Account</p>
                      <p className="mt-1 text-[15px] font-medium text-slate-700">{previewData.link?.googleEmail || "—"}</p>
                      <p className="mt-0.5 text-[12px] text-slate-500">{previewData.link?.googleDisplayName || ""}</p>
                    </div>
                    <div className="rounded-[16px] border border-slate-200 bg-white p-4 lg:col-span-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="flex items-center text-[12px] font-semibold uppercase tracking-wide text-slate-500">Last Sync<HelpTip text="Syncs automatically every 2 minutes." /></p>
                        {(liveSync?.lastSyncStatus || previewData.link?.lastSyncStatus) && (
                          <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${syncStatusTone(liveSync?.lastSyncStatus || previewData.link?.lastSyncStatus)}`}>
                            {liveSync?.lastSyncStatus || previewData.link?.lastSyncStatus}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[15px] font-medium text-slate-700">{formatSyncTime(liveSync?.lastSyncedAt ?? previewData.link?.lastSyncedAt)}</p>
                      <p className="mt-0.5 text-[12px] text-slate-500">{describeSyncSummary(liveSync?.lastSyncSummary ?? previewData.link?.lastSyncSummary)}</p>
                    </div>
                  </div>

                  {previewData.assignment?.missingColumns?.length ? (
                    <div role="alert" className="rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
                      {/* The one failure mode of these rules that is otherwise invisible: the
                          column was renamed in the spreadsheet, the rule still exists, and every
                          row it used to assign now arrives with no owner. */}
                      <p className="font-semibold">Some assignment rules cannot run against this sheet.</p>
                      <p className="mt-1">
                        It has no column called{" "}
                        {previewData.assignment.missingColumns.map((entry, index) => (
                          <span key={`${entry.id}-${index}`}>
                            {index ? ", " : ""}
                            <span className="font-medium">{entry.columnHeader}</span>
                          </span>
                        ))}
                        . {config.nounTitle}s those rules would have assigned arrive unassigned until the rule or the sheet is corrected.
                      </p>
                    </div>
                  ) : null}

                  <div className="rounded-[16px] border border-slate-200 bg-white p-4">
                    <h3 className="text-[14px] font-semibold text-slate-700">Summary</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                      {[
                        ["Total Rows", previewData.summary?.totalRows ?? 0],
                        [`New ${config.nounTitle}s`, previewData.summary?.newRows ?? 0],
                        // Named as skipped, because that is what the sync will do with them: a
                        // row already here is never rewritten from the sheet.
                        [`Existing ${config.nounTitle}s (skipped)`, previewData.summary?.existingRows ?? 0],
                        ["Duplicates in Sheet", previewData.summary?.duplicateRows ?? 0],
                        // Not rows refused - a row is never refused now - but cells the importer
                        // could not read and will store empty.
                        ["Fields Left Blank", previewData.summary?.clearedFields ?? 0],
                        // What the rules did. "Unassigned" is the figure worth reading: a rule
                        // written against a column since renamed leaves every row ownerless.
                        ["Assigned by Rule", previewData.summary?.assignedByRule ?? 0],
                        ["Unassigned", previewData.summary?.unassignedRows ?? 0],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-[14px] border border-slate-200 bg-slate-50 px-4 py-3">
                          <p className="text-[12px] font-medium text-slate-500">{label}</p>
                          <p className="mt-1 text-[20px] font-semibold text-slate-800">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[1.1fr_1.3fr]">
                    <div className="rounded-[16px] border border-slate-200 bg-white p-4">
                      <h3 className="text-[14px] font-semibold text-slate-700">Column Mapping</h3>
                      <div className="mt-3 overflow-hidden rounded-[12px] border border-slate-200">
                        <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                          <div>Google Sheet</div>
                          <div>{config.recordFieldLabel}</div>
                        </div>
                        <div className="max-h-[280px] overflow-y-auto">
                          {Object.entries(previewData.mapping?.fields || {}).length ? (
                            Object.entries(previewData.mapping.fields).map(([fieldName, info]) => (
                              <div key={fieldName} className="grid grid-cols-2 border-b border-slate-100 px-3 py-2 text-[13px] text-slate-700 last:border-b-0">
                                <div className="truncate">{info?.sourceHeader || "—"}</div>
                                <div className="truncate font-medium">{fieldName}</div>
                              </div>
                            ))
                          ) : (
                            <div className="px-3 py-4 text-[13px] text-slate-500">No mapped columns found.</div>
                          )}
                        </div>
                      </div>

                      {Array.isArray(previewData.mapping?.unmappedHeaders) && previewData.mapping.unmappedHeaders.length ? (
                        <div className="mt-4">
                          <h4 className="text-[13px] font-semibold text-slate-700">Unmapped Columns</h4>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {previewData.mapping.unmappedHeaders.map((header) => (
                              <span key={header} className="rounded-full bg-slate-100 px-3 py-1 text-[12px] text-slate-600">
                                {header}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-[16px] border border-slate-200 bg-white p-4">
                      <h3 className="text-[14px] font-semibold text-slate-700">Row Preview</h3>
                      <div className="mt-3 max-h-[500px] space-y-3 overflow-y-auto pr-1">
                        {(previewData.rows || []).map((row) => {
                          const summary = config.previewRow(row);
                          const issues = Array.isArray(row?.issues) ? row.issues : [];
                          return (
                            <div key={`${row.rowNumber}-${row.classification}`} className="rounded-[14px] border border-slate-200 bg-slate-50 px-4 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-[13px] font-semibold text-slate-700">Row {row.rowNumber}</p>
                                  <p className="text-[12px] text-slate-500">{row.classification}</p>
                                </div>
                                {row.matchedBy ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-600">Match: {row.matchedBy}</span> : null}
                              </div>
                              <div className="mt-3 grid gap-2 text-[13px] text-slate-700 sm:grid-cols-2">
                                <div><span className="font-medium text-slate-500">Name:</span> {summary.name || "—"}</div>
                                <div><span className="font-medium text-slate-500">Phone:</span> {summary.phone || "—"}</div>
                                <div><span className="font-medium text-slate-500">Email:</span> {summary.email || "—"}</div>
                                <div><span className="font-medium text-slate-500">Status:</span> {summary.status || "—"}</div>
                                {/* Which rule fired, and on what. Without this a wrong rule is
                                    only discoverable after the rows have landed on the wrong
                                    person and somebody complains. */}
                                <div>
                                  <span className="font-medium text-slate-500">Assign to:</span>{" "}
                                  {summary.owner || "—"}
                                  {row.assignment?.rule ? (
                                    <span className="ml-1 text-[11px] text-slate-500">
                                      (rule: {row.assignment.rule.columnHeader} = {row.assignment.rule.matchValue}
                                      {row.assignment.rule.percent && row.assignment.rule.percent < 100 ? ` · ${row.assignment.rule.percent}% share` : ""})
                                    </span>
                                  ) : null}
                                  {/* Said explicitly, because a row landing on somebody the rule
                                      does not name otherwise reads as the rule being wrong. */}
                                  {row.assignment?.cover ? (
                                    <span className="ml-1 text-[11px] font-medium text-amber-700">
                                      covering for {row.assignment.cover.coveringFor} ({row.assignment.cover.reason})
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              {row.classification === "EXISTING" && row.matchedRecord ? (
                                <div className="mt-3 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
                                  Existing {config.nounTitle}: {config.matchedRecordId(row) || "Matched record"} — left as it is, this row will not be imported again.
                                </div>
                              ) : null}
                              {issues.length ? (
                                <ul className="mt-3 space-y-1 text-[12px] text-rose-600">
                                  {issues.map((issue, index) => (
                                    <li key={`${issue.field || "issue"}-${index}`}>- {issue.reason}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <footer className="flex items-center justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPreviewLink(null);
                  setPreviewData(null);
                }}
              >
                Close
              </Button>
            </footer>
          </section>
        </div>
      )}
    </>,
    document.body,
  );

  return (
    <div className="space-y-4">
      {/* The cards are the way in; picking one replaces them with that integration's own
          panel, and the back button returns to the grid. Kept inside this section so the
          drill-down does not move the reader out of Settings' rail. */}
      {!activeIntegration && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => {
                  if (card.id === "google-sheets" || card.id === "google-meet") setActiveIntegration(card.id);
                }}
                className="text-left"
              >
                <IntegrationCard {...card} />
              </button>
            ))}
          </div>
        </>
      )}

      {activeIntegration === "google-meet" && (
        <div className="space-y-4">
          <IntegrationDetailHeader
            onBack={() => setActiveIntegration(null)}
            title="Google Meet"
            description={config.meet.description}
            icon={<MeetIcon className="h-8 w-8" />}
          />
          {/* Meet has nothing of its own to configure - it rides on the same Google account the
              Sheets integration uses. What it does need is the calendar grant, which an account
              connected before Meet scheduling existed will not carry, so this panel exists to
              report that and to fix it. */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="flex items-center text-sm font-semibold text-slate-700">
              Google Account
              <HelpTip text={`Meetings are created on this account's calendar, and it hosts the Meet.${googleConnection ? " Disconnecting it also stops Google Sheets syncing; linked sheets are kept." : ""}`} />
            </h4>
            {loadingGoogleConnection ? (
              <p className="mt-4 rounded-lg border border-dashed border-slate-200 px-4 py-6 text-xs text-slate-500 sm:text-sm">Checking your Google account...</p>
            ) : (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-700 sm:text-sm">
                    {googleConnection ? googleConnection.googleEmail : "No Google account connected"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {!googleConnection
                      ? "Connect an account to create Meet links."
                      : meetReady
                        ? "Calendar access granted - Meet scheduling is ready."
                        : "This account was connected before Meet scheduling. Reconnect it to allow calendar access."}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${meetReady ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                  {meetReady ? "Ready" : "Action needed"}
                </span>
              </div>
            )}
            {!loadingGoogleConnection && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {!meetReady && (
                  <Button type="button" variant="primary" disabled={startingGoogleOAuth} onClick={() => void handleStartGoogleOAuth()}>
                    {startingGoogleOAuth ? "Opening Google..." : googleConnection ? "Reconnect Google" : "Connect Google"}
                  </Button>
                )}
                {googleConnection && (
                  <Button type="button" variant="secondary" disabled={disconnectingGoogle} onClick={() => void handleDisconnectGoogle()}>
                    {disconnectingGoogle ? "Disconnecting..." : "Disconnect account"}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="text-sm font-semibold text-slate-700">How to use it</h4>
            <p className="mt-2 text-xs leading-6 text-slate-600 sm:text-sm">
              {config.meet.howTo.lead}
              <span className="font-medium text-slate-700"> {config.meet.howTo.action}</span>{config.meet.howTo.rest}
            </p>
          </div>
        </div>
      )}

      {activeIntegration === "google-sheets" && (
        <div className="space-y-4">
          <IntegrationDetailHeader
            onBack={() => setActiveIntegration(null)}
            title="Google Sheets"
            description={config.sheetsDescription}
            icon={<SheetsIcon className="h-8 w-8" />}
            action={
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  resetLinkForm();
                  setLinkError("");
                  setShowLinkSpreadsheetDialog(true);
                }}
              >
                + Link Spreadsheet
              </Button>
            }
          />
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="flex items-center text-sm font-semibold text-slate-700">
              Linked Sheets
              <HelpTip text="Multiple Google Sheets can be linked and stored in MySQL." />
            </h4>

            <div className="mt-4 space-y-2">
              {loadingLinks ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-xs text-slate-500 sm:text-sm">
                  Loading linked sheets...
                </div>
              ) : linkedSheets.length ? (
                linkedSheets.map((link) => (
                  <div
                    key={link.id}
                    className="relative rounded-lg border border-slate-200 px-4 py-3 text-xs text-slate-600 sm:text-sm"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        {/* A sheet linked by URL has no name of its own yet, so the id stands in
                            for it - long enough to push the actions off the row if left to run. */}
                        <p className="truncate font-medium text-slate-700">{link.spreadsheetName || link.systemTableName}</p>
                        <p className="truncate text-slate-500">{link.sheetUrl}</p>
                        <p className="truncate text-slate-500">Tab: {link.targetedTab}</p>
                        <p className="truncate text-slate-500">Account: {link.googleEmail || "Connected"}</p>
                        {/* Said on the row rather than only inside Edit: a sheet importing rows
                            nobody is assigned is the state worth noticing without going looking. */}
                        <p className="truncate text-slate-500">
                          {link.assignmentRules?.length
                            ? `Assignment: ${link.assignmentRules.length} rule${link.assignmentRules.length === 1 ? "" : "s"}`
                            : `Assignment: none — imported ${config.nounPlural} arrive unassigned`}
                        </p>
                      </div>
                      {/* `shrink-0`, so the actions keep their own width: squeezed by a long id
                          beside them, the button was breaking "Sync Now" across two lines. */}
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="whitespace-nowrap"
                          onClick={() => void handleSyncSheetLink(link.id)}
                          disabled={syncingLinkId === link.id}
                        >
                          {syncingLinkId === link.id ? "Syncing..." : "Sync Now"}
                        </Button>
                        <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-600">
                          Connected
                        </span>
                        {/* Two different facts, so two pills: **Connected** is the Google account,
                            this is what the last sync actually did. */}
                        {link.lastSyncStatus && link.lastSyncStatus !== "OK" ? (
                          <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${syncStatusTone(link.lastSyncStatus)}`}>
                            {link.lastSyncStatus === "FAILED" ? "Sync failed" : "Partial sync"}
                          </span>
                        ) : null}
                        <OptionsMenu
                          ariaLabel={`Open actions for ${link.systemTableName}`}
                          // Above this overlay's own portal and its dialogs (z-150/155), which
                          // are siblings of the menu under body.
                          zIndex={160}
                          items={[
                            { label: "Preview Import", onSelect: () => void handlePreviewSheetLink(link) },
                            {
                              label: "Edit",
                              onSelect: () => {
                                setEditingLinkId(link.id);
                                setLinkError("");
                                setSheetUrl(link.sheetUrl || "");
                                setTargetedTab(link.targetedTab || "");
                                setSystemTableId(link.systemTableId || "");
                                setVertical(link.vertical || "");
                                setAssignmentRules(
                                  (link.assignmentRules || []).map((rule) => ({
                                    columnHeader: rule.columnHeader || "",
                                    matchValue: rule.matchValue || "",
                                    targets: (rule.targets || []).map((target) => ({
                                      employeeId: target.employeeId ? String(target.employeeId) : "",
                                      percent: String(target.percent ?? 100),
                                    })),
                                  })),
                                );
                                setSheetHeaders([]);
                                // Fetched in the background: the dialog opens straight away and
                                // the column field becomes a picker once the sheet has been read.
                                void loadSheetHeaders(link.id);
                                setShowLinkSpreadsheetDialog(true);
                              },
                            },
                            // Delete asks first rather than offering an undo afterwards.
                            { label: "Delete", tone: "danger", onSelect: () => setPendingDeleteLink(link) },
                          ]}
                        />
                      </div>
                    </div>

                    {/* What the last pass did, under the row rather than only inside Preview
                        Import: a sheet whose tab has been renamed or whose share has been revoked
                        simply stops importing, and the reason is what says which field to correct. */}
                    {link.lastSyncStatus === "FAILED" ? (
                      <p role="alert" className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
                        <span className="font-semibold">Last sync failed</span>
                        {link.lastSyncedAt ? ` · ${formatSyncTime(link.lastSyncedAt)}` : ""} — {describeSyncSummary(link.lastSyncSummary)}
                      </p>
                    ) : link.lastSyncStatus === "PARTIAL" ? (
                      <p role="alert" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                        <span className="font-semibold">Last sync finished with problems</span>
                        {link.lastSyncedAt ? ` · ${formatSyncTime(link.lastSyncedAt)}` : ""} — {describeSyncSummary(link.lastSyncSummary)}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        {link.lastSyncedAt ? `Last sync: ${formatSyncTime(link.lastSyncedAt)} — ${describeSyncSummary(link.lastSyncSummary)}` : "Not synced yet."}
                      </p>
                    )}

                    {/* Which rows did not import, and why - by row number, so the spreadsheet can
                        be opened at the line and corrected. Capped by the backend at five, with
                        the true total named after them. */}
                    {link.lastSyncSummary?.rowProblems?.length ? (
                      <div className="mt-1.5 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                        <p className="font-semibold text-slate-700">Rows that did not import</p>
                        <ul className="mt-1 space-y-0.5">
                          {link.lastSyncSummary.rowProblems.map((problem) => (
                            <li key={problem.rowNumber} className="break-words">
                              <span className="font-medium text-slate-700">Row {problem.rowNumber}</span> — {problem.reason}
                            </li>
                          ))}
                        </ul>
                        {(() => {
                          const total = Number(link.lastSyncSummary.clearedFields || 0)
                            + Number(link.lastSyncSummary.skippedInvalid || 0)
                            + Number(link.lastSyncSummary.failed || 0);
                          const shown = link.lastSyncSummary.rowProblems.length;
                          return total > shown ? (
                            <p className="mt-1 text-slate-500">
                              Showing {shown} of {total} — open Preview Import for the rest.
                            </p>
                          ) : null;
                        })()}
                      </div>
                    ) : null}

                    {/* A sync can succeed and still assign nobody: the column a rule names has
                        been renamed in the spreadsheet. Named rather than counted, because the fix
                        is to point the rule at the new heading and a number cannot be acted on. */}
                    {link.lastSyncSummary?.assignmentMissingColumns?.length ? (
                      <p role="alert" className="mt-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                        Assignment {link.lastSyncSummary.assignmentMissingColumns.length === 1 ? "rule refers" : "rules refer"} to{" "}
                        <span className="font-medium">{link.lastSyncSummary.assignmentMissingColumns.join(", ")}</span>, which this sheet
                        has no column for — those {config.nounPlural} arrive unassigned. Edit the sheet to correct the rule.
                      </p>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-xs text-slate-500 sm:text-sm">
                  No Google Sheets linked yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {dialogs}
    </div>
  );
}
