"use client";

import SimpleTable from "@/components/data-table/SimpleTable";

import { useCallback, useEffect, useState } from "react";
import OptionsMenu from "@/components/ui/OptionsMenu";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import WhatsAppLimitsCard from "./WhatsAppLimitsCard";
import {
  disconnectWhatsappUser,
  getWhatsappChatSettings,
  getWhatsappUsers,
  logoutWhatsapp,
  setWhatsappChatEnabled,
  setWhatsappUserEnabled,
} from "@/services/sales/whatsapp-chat.service";

/**
 * The studio's WhatsApp: who may chat from a lead, who is held to linking one at all, and whether
 * their account is linked.
 *
 * Two different reasons land somebody here, and a row can be either or both: being on the **Sales**
 * team, a CRM who can chat from a lead, and **Required** - Allow WhatsApp ticked on their Login
 * Credentials, which holds them to the application-wide gate regardless of department. The second
 * exists because an administrator switching that tick on for somebody outside Sales had no way to
 * see afterwards whether that person had actually linked - the only other place that answer showed
 * was the gate itself, on that person's own screen, the next time they opened the application.
 *
 * Its own file since the User Settings overlay that used to hold it was removed. That overlay had
 * become a second way into one screen - Studio Branding moved to Settings, leaving it with this
 * table and nothing else, and Settings already listed the same table under User Settings > WhatsApp.
 * So the overlay went and the table stayed, which is the half that anything actually renders.
 *
 * Drawn by `SettingsOverlay`. It reports what is already true - a CRM links their own WhatsApp from
 * the WhatsApp Chat tab of a lead, and anybody Required links from the gate itself - so nothing here
 * is a form and nothing here submits.
 */

// Four different answers, and the difference between the last two matters: a CRM who linked
// before the last restart is paired but not connected, which is not the same as never linked.
function statusLook(row) {
  if (!row.hasAccount) return { label: "No account yet", dot: "bg-slate-300", text: "text-slate-500" };
  if (row.status === "connected") return { label: "Connected", dot: "bg-emerald-500", text: "text-emerald-700" };
  if (row.status === "pairing") return { label: "Scanning", dot: "bg-amber-500", text: "text-amber-700" };
  if (row.paired) return { label: "Not connected", dot: "bg-red-500", text: "text-red-700" };
  return { label: "Not linked", dot: "bg-slate-300", text: "text-slate-500" };
}

/**
 * One row per CRM.
 *
 * The server answers with the sales team as the Employee Repository holds it, so somebody added
 * to Sales appears here without anyone editing a list. The names the app ships with - the roster
 * the lead table filters by - are added underneath for any that are not employees yet, so the
 * three the CRM already works with do not vanish while the repository is still being filled in.
 *
 * An administrator's own login is not a CRM and is not among them either way.
 */
function crmRows(serverRows) {
  /*
   * Whoever the server says, and nobody else.
   *
   * Three names used to be appended here from a list written into the application, so the CRMs the
   * app "ships with" stayed visible while the employee repository was being filled in. The
   * repository is the roster now - a name in the code is wrong the day somebody joins or leaves,
   * and this table is about people's WhatsApp pairing, where a row for somebody who does not exist
   * is a row that can never be paired.
   */
  return serverRows;
}

function formatNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? `+${digits}` : "—";
}

/**
 * How hard this CRM has been working their WhatsApp, in a table cell.
 *
 * The same three levels the CRM sees in their own chat panel. "Within limits" is said rather
 * than left blank, so a quiet row reads as checked-and-fine instead of as missing data.
 */
function usageLook(usage) {
  const counts = usage?.counts || {};
  const summary = `${counts.hourlyMessages || 0}/hr to ${counts.hourlyChats || 0} client${counts.hourlyChats === 1 ? "" : "s"}`;
  if (usage?.level === "over") return { label: "Over limit", tone: "text-red-700", summary };
  if (usage?.level === "warning") return { label: "Near limit", tone: "text-amber-700", summary };
  return { label: "Within limits", tone: "text-slate-500", summary };
}

export default function WhatsAppUsersTable() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // The CRM whose link is about to be ended, held while the confirmation is up. Disconnecting
  // somebody sends them back to scanning a code, so it is asked before it is done.
  const [disconnecting, setDisconnecting] = useState(null);
  const [working, setWorking] = useState(false);
  // The studio switch, and whether this account is allowed to move it. Both come from the
  // server: an administrator is a role the server knows, not something the browser decides.
  // The studio switch, the usage limits and whether this account may move either. `limits` is
  // what is in force, `saved` is what this studio chose (a null per limit nobody set) and
  // `defaults` is what the app falls back to - the limits card needs all three to tell an empty
  // box from a chosen number. See the card for why that distinction is load-bearing.
  const [chat, setChat] = useState({ enabled: true, canEdit: false, limits: null, saved: null, defaults: null, bounds: null });
  // Held while the confirmation is up. Switching off disconnects every CRM, so it is asked
  // before it is done - the same rule the single disconnect below follows.
  const [switchingOff, setSwitchingOff] = useState(false);
  const [switching, setSwitching] = useState(false);
  // The CRM whose switch is being turned off, held while the confirmation is up - blocking
  // somebody disconnects them, so it is asked before it is done, as the row's own Disconnect is.
  const [blocking, setBlocking] = useState(null);
  const [blockingId, setBlockingId] = useState(null);

  const load = useCallback(async () => {
    try {
      // Together, so the table and the switch above it are never a moment out of step with
      // each other - a list showing everyone connected under a switch reading off reads as a
      // bug in the switch.
      const [response, settings] = await Promise.all([getWhatsappUsers(), getWhatsappChatSettings()]);
      setUsers(Array.isArray(response?.data) ? response.data : []);
      setChat({
        enabled: settings?.data?.enabled !== false,
        canEdit: Boolean(settings?.data?.canEdit),
        limits: settings?.data?.limits || null,
        saved: settings?.data?.saved || null,
        defaults: settings?.data?.defaults || null,
        bounds: settings?.data?.bounds || null,
      });
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Unable to load WhatsApp users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Only ever your own session: the server ends the one belonging to the caller, so this is the
  // signed-in CRM unlinking their own WhatsApp and never anybody else's.
  const logout = useCallback(async () => {
    try {
      await logoutWhatsapp();
      await load();
    } catch (requestError) {
      setError(requestError.message || "Unable to log out of WhatsApp.");
    }
  }, [load]);

  /**
   * Asks before ending somebody else's link, and says plainly when there is nothing to end.
   *
   * A CRM who has never signed in has no session to disconnect, and one who has signed in but
   * never scanned has no WhatsApp on it. Both are worth saying out loud: the alternative is a
   * menu entry that appears to do nothing.
   */
  const askToDisconnect = useCallback((row) => {
    if (!row.userId) {
      setError(`${row.name} has no app account yet, so there is no WhatsApp session to disconnect.`);
      return;
    }
    if (row.status !== "connected" && !row.paired) {
      setError(`${row.name} has not linked a WhatsApp, so there is nothing to disconnect.`);
      return;
    }
    setError("");
    setDisconnecting(row);
  }, []);

  // Somebody else's, which the server allows only with User Settings Read / Write.
  const disconnect = useCallback(async (row) => {
    setWorking(true);
    try {
      await disconnectWhatsappUser(row.userId);
      setDisconnecting(null);
      await load();
    } catch (requestError) {
      setError(requestError.message || "Unable to disconnect this WhatsApp.");
      setDisconnecting(null);
    } finally {
      setWorking(false);
    }
  }, [load]);

  /**
   * Moves the studio switch.
   *
   * Switching on is done as it is pressed: it gives something back, and the CRMs it gives it
   * back to still have to link for themselves. Switching off is asked about first, because it
   * ends every link at once and each of those CRMs has to scan a fresh code afterwards.
   */
  const applySwitch = useCallback(async (enabled) => {
    setSwitching(true);
    try {
      await setWhatsappChatEnabled(enabled);
      setSwitchingOff(false);
      setError("");
      // Reloaded rather than assumed: the reply says how many were disconnected, and the table
      // underneath has to show them that way too.
      await load();
    } catch (requestError) {
      setError(requestError.message || "Unable to switch WhatsApp chat.");
      setSwitchingOff(false);
    } finally {
      setSwitching(false);
    }
  }, [load]);

  /**
   * Moves one CRM's switch.
   *
   * Switching on is done as it is pressed - it gives something back, and that CRM still has to
   * link for themselves. Switching off is asked about first, because it ends their session.
   */
  const applyUserSwitch = useCallback(async (row, enabled) => {
    if (!row?.userId) return;
    setBlockingId(row.userId);
    try {
      await setWhatsappUserEnabled(row.userId, enabled);
      setBlocking(null);
      setError("");
      await load();
    } catch (requestError) {
      setError(requestError.message || "Unable to switch this CRM's WhatsApp.");
      setBlocking(null);
    } finally {
      setBlockingId(null);
    }
  }, [load]);

  if (loading) {
    return <p className="px-1 py-6 text-center text-sm text-slate-500">Loading CRMs...</p>;
  }

  const rows = crmRows(users);
  const overLimit = rows.filter((row) => row.usage?.level === "over");

  return (
    <div className="space-y-3">
      {/* The switch leads, and the sentence explaining the list follows it - the same order the
          CRM's other panels put a control and its explanation in.

          The bare labelled switch Table Settings uses, with no card and no second line saying
          what the switch already shows. Visible to everyone and movable only with User Settings
          Read / Write, which the server decides and reports as `canEdit`:
          a CRM whose Link button is refusing them is owed the reason, and hiding the switch
          would leave them guessing. */}
      <ToggleSwitch
        label="WhatsApp chat"
        ariaLabel="WhatsApp chat for the whole studio"
        helperText="Off stops chat from leads and disconnects every CRM's WhatsApp."
        checked={chat.enabled}
        disabled={!chat.canEdit || switching}
        onCheckedChange={(next) => (next ? void applySwitch(true) : setSwitchingOff(true))}
      />

      {/* Under the switch and above the table, which is the order the three things are decided in:
          whether anybody may chat, how hard they may chat before being warned, then who is
          chatting. Only once the settings have actually arrived - a card rendered against nulls
          would show "warned past undefined clients an hour" for a beat on every load. */}
      {chat.limits && (
        <WhatsAppLimitsCard
          limits={chat.limits}
          saved={chat.saved}
          defaults={chat.defaults}
          bounds={chat.bounds}
          canEdit={chat.canEdit}
          // The Usage column measures each CRM against these, so it is stale the moment they move.
          onSaved={load}
        />
      )}

      {error && <p role="alert" className="text-xs text-red-600 sm:text-sm">{error}</p>}

      {/* The same warning the CRM is being shown, said once here for whoever can act on it.
          Named rather than counted: an administrator's next step is to disconnect somebody, and
          that needs the name. The row's own menu is where it is done. */}
      {overLimit.length > 0 && (
        <div role="status" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 sm:text-sm">
          <span className="font-semibold">
            {overLimit.length === 1 ? `${overLimit[0].name} is over the WhatsApp limit.` : `${overLimit.length} CRMs are over the WhatsApp limit.`}
          </span>{" "}
          {overLimit.length === 1
            ? overLimit[0].usage?.reasons?.[0] || ""
            : overLimit.map((row) => row.name).join(", ")}
          {" "}Messaging many clients in a short time is what WhatsApp reads as a broadcast, and the
          studio&apos;s number can be banned for it. Disconnect them from their row if they do not stop.
        </div>
      )}

      {/* The same card, headings and row dividers as the CRM's own tables, with the actions in a
          narrow last column the way every table in the OS carries them. */}
      <SimpleTable
        variant="card"
        columns={[
          { key: "name", label: "Username" },
          { key: "number", label: "Number" },
          { key: "status", label: "Status" },
          { key: "usage", label: "Usage" },
          // One CRM's own switch, beside the studio-wide one above the table.
          { key: "chat", label: "WhatsApp chat" },
          // Named for a screen reader, blank on screen: the column is the row's own menu, not a
          // heading anyone reads.
          { key: "actions", label: "Actions", srOnly: true, headerClassName: "w-12 !px-2" },
        ]}
        rows={rows}
        rowKey={(row) => row.key}
        emptyMessage="Nobody is on Sales or required to link WhatsApp yet."
        // The cells carry their own looks - a status dot, a usage reading, a switch with its
        // reason - so the row is drawn here rather than column by column.
        renderRow={(row) => {
                const look = statusLook(row);
                const usage = usageLook(row.usage);
                return (
                  <tr key={row.key} className="align-top">
                    <td className="whitespace-nowrap px-5 py-3 text-sm font-semibold text-slate-800">
                      {row.name}
                      {row.isSelf && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}
                      {/* Sales is why most rows are here and needs no label of its own; Required is
                          the exception worth naming - it is the only sign, anywhere but that
                          person's own screen, that Allow WhatsApp reaches somebody outside Sales. */}
                      {row.required && <span className="ml-2 inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">Required</span>}
                      {row.role && <p className="mt-0.5 text-xs font-normal text-slate-500">{row.role}</p>}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-600">
                      {formatNumber(row.whatsappNumber || row.contactNumber)}
                      {!row.whatsappNumber && row.contactNumber && (
                        <p className="mt-0.5 text-xs text-slate-400">On file</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-sm">
                      <span className={`inline-flex items-center gap-2 ${look.text}`}>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${look.dot}`} />
                        {look.label}
                      </span>
                    </td>
                    {/* What the CRM's own panel is telling them, so an administrator deciding
                        whether to step in sees the reading that asked them to stop. */}
                    <td className="whitespace-nowrap px-5 py-3 text-sm">
                      <span className={`font-medium ${usage.tone}`}>{usage.label}</span>
                      <p className="mt-0.5 text-xs font-normal text-slate-400">{usage.summary}</p>
                    </td>
                    {/* Blocks this CRM alone, leaving the rest working - the studio switch above
                        the table is the one that stops everybody. The same switch, without its
                        own label because the column heading is the label.

                        Every row carries one, so the column reads as a column. A CRM who has not
                        signed in has no session to block, so theirs is shown but cannot be moved
                        and says why - which is more honest than an empty cell. */}
                    <td className="whitespace-nowrap px-5 py-3 text-sm">
                      <span
                        className="inline-flex items-center gap-2"
                        title={!row.userId
                          ? `${row.name} has no app account yet, so there is no WhatsApp to switch off.`
                          : !chat.canEdit
                            ? "Switching a CRM's WhatsApp on or off needs User Settings Read / Write."
                            : undefined}
                      >
                        <ToggleSwitch
                          ariaLabel={`WhatsApp chat for ${row.name}`}
                          checked={Boolean(row.userId) && row.chatEnabled !== false}
                          // Movable only with User Settings Read / Write, which the server enforces either way.
                          disabled={!row.userId || !chat.canEdit || blockingId === row.userId}
                          onCheckedChange={(next) => (next ? void applyUserSwitch(row, true) : setBlocking(row))}
                        />
                        {!row.userId && <span className="text-xs text-slate-400">No account</span>}
                      </span>
                    </td>
                    {/* Linking is a QR scanned on that CRM's own phone, so the only account this
                        menu can act on is the one signed in. Everyone else's row offers the read
                        the panel is for. */}
                    <td className="w-12 px-2 py-2 align-middle">
                      <OptionsMenu
                        ariaLabel={`Actions for ${row.name}`}
                        zIndex={150}
                        menuClassName="w-48"
                        items={[
                          { label: "Refresh status", onSelect: () => void load() },
                          // Your own row logs out; everyone else's disconnects. Offered on every
                          // row rather than only the linked ones, so the menu is the same
                          // wherever it is opened - a row with nothing to end says so when it is
                          // chosen instead of quietly missing the entry.
                          ...(row.isSelf
                            ? [{ label: "Log out of WhatsApp", tone: "danger", onSelect: () => void logout() }]
                            : [{ label: "Disconnect WhatsApp", tone: "danger", onSelect: () => askToDisconnect(row) }]),
                        ]}
                      />
                    </td>
                  </tr>
                );
        }}
      />

      {/* Blocking one CRM ends their session, so it is asked about first - the same rule the
          row's own Disconnect follows. Switching one back on is not asked about: it gives
          something back, and they still have to link for themselves. */}
      <ConfirmDialog
        open={Boolean(blocking)}
        title={`Switch WhatsApp off for ${blocking?.name || "this CRM"}?`}
        confirmLabel="Switch off"
        busyLabel="Switching off..."
        loading={blockingId === blocking?.userId}
        onCancel={() => setBlocking(null)}
        onConfirm={() => void applyUserSwitch(blocking, false)}
      />

      {/* The question and the two answers, and nothing else - the same shape the chat panel's
          logout confirmation uses. The title says what Switch off does; the paragraph under it
          only said it again at length. */}
      <ConfirmDialog
        open={switchingOff}
        title="Switch WhatsApp off for everyone?"
        confirmLabel="Switch off"
        busyLabel="Switching off..."
        loading={switching}
        onCancel={() => setSwitchingOff(false)}
        onConfirm={() => void applySwitch(false)}
      />

      {/* The module's own confirmation, so ending somebody's link reads like every other
          destructive step in the app rather than happening on one click. */}
      <ConfirmDialog
        open={Boolean(disconnecting)}
        title="Disconnect this WhatsApp?"
        message={`${disconnecting?.name || "This CRM"} will be signed out of WhatsApp here, and the device will disappear from their phone's Linked devices. They will have to scan a new code to chat again.`}
        confirmLabel="Disconnect"
        busyLabel="Disconnecting..."
        loading={working}
        onCancel={() => setDisconnecting(null)}
        onConfirm={() => void disconnect(disconnecting)}
      />
    </div>
  );
}
