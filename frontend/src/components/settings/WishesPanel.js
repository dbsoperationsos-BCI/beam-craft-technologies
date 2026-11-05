"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import TextAreaField from "@/components/shared/TextAreaField";
import { CardState } from "@/components/shared/DashboardCard";
import MessagePreview from "@/components/settings/MessagePreview";
import { renderTemplate } from "@/lib/messageTemplate.mjs";
import { getWishes, saveWish } from "@/services/settings/wishes.service";

/*
 * Settings → Templates → Birthday Wishes / Anniversary Wishes / Work Anniversary Wishes: the ten
 * messages of one kind, each reworded in place and saved together. `{employee name}` stands for the
 * employee's name; an anniversary wish may also use `{spouse name}`, the spouse's name on their
 * record, and a work anniversary wish `{years}`, the years since they joined ("3 years").
 *
 * Editable on `SETTINGS / Wishes` Read / Write (`canWrite`); on Read alone the wording is shown as it is.
 *
 * On each person's birthday, wedding anniversary and work anniversary (each year since their Date Of
 * Joining, the 1st onwards) one of the ten, picked at random, is sent into the
 * WhatsApp group named in Wishes Scheduler, at its time - the panel says where and when, and why the
 * last try failed if it did.
 */

// `sample` previews each wish as it is typed, filled as `wishes/sender.js` fills it - both names for
// either kind, the sender passing the spouse's name (or "your spouse") to every wish.
const KINDS = {
  birthday: { placeholders: "{employee name}", occasion: "birthday", sample: { "employee name": "Divya", "spouse name": "Karthik" } },
  weddingAnniversary: { placeholders: "{employee name} and {spouse name}", occasion: "wedding anniversary", sample: { "employee name": "Divya", "spouse name": "Karthik" } },
  workAnniversary: { placeholders: "{employee name} and {years}", occasion: "work anniversary (each year since their Date Of Joining)", sample: { "employee name": "Divya", years: "3 years" } },
};

export default function WishesPanel({ kind = "birthday", canWrite = false, unsavedRef, onNotice, onError }) {
  const [saved, setSaved] = useState([]);
  const [delivery, setDelivery] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await getWishes();
      const wishes = response?.data?.[kind] || [];
      setDelivery(response?.delivery || null);
      setSaved(wishes);
      setDrafts(Object.fromEntries(wishes.map((wish) => [wish.key, wish.body])));
    } catch (error) {
      setLoadError(error?.message || "Unable to load the wishes.");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // The wishes reworded and not saved yet - leaving with any asks first.
  const changed = saved.filter((wish) => (drafts[wish.key] ?? "").trim() !== wish.body);
  const empty = saved.some((wish) => !(drafts[wish.key] ?? "").trim());
  useEffect(() => {
    if (!unsavedRef) return undefined;
    unsavedRef.current = changed.length > 0;
    return () => { unsavedRef.current = false; };
  }, [changed.length, unsavedRef]);

  async function save() {
    setSaving(true);
    try {
      const updated = [];
      for (const wish of changed) updated.push((await saveWish(wish.key, drafts[wish.key].trim()))?.data);
      const byKey = new Map(updated.filter(Boolean).map((wish) => [wish.key, wish]));
      setSaved((current) => current.map((wish) => byKey.get(wish.key) || wish));
      onNotice?.(`${updated.length} ${updated.length === 1 ? "wish" : "wishes"} saved.`);
    } catch (error) {
      onError?.(error?.data?.message || error?.message || "Unable to save the wishes.");
    } finally {
      setSaving(false);
    }
  }

  return <CardState loading={loading} error={loadError} onRetry={load} empty={!saved.length} emptyMessage="No wishes are set up yet." rows={5}>
    <div className="space-y-4">
      {delivery && <p className="text-xs text-slate-600 sm:text-sm">{delivery.groupName
        ? <>On each employee&apos;s {KINDS[kind]?.occasion}, one of these is picked at random and sent at {delivery.sendAt} into the WhatsApp group &quot;{delivery.groupName}&quot; - the one named in Wishes Scheduler.</>
        : <>Not being sent yet: name a WhatsApp group in Wishes Scheduler and these go there on each employee&apos;s {KINDS[kind]?.occasion}.</>}</p>}
      {delivery?.lastError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 sm:text-sm">{delivery.lastError}</p>}
      {saved.map((wish, index) => <div key={wish.key} className="space-y-2">
        <TextAreaField
          label={`Wish ${index + 1}`}
          rows={3}
          maxLength={1000}
          value={drafts[wish.key] ?? ""}
          readOnly={!canWrite}
          disabled={saving}
          error={canWrite && !(drafts[wish.key] ?? "").trim() ? "A wish needs some wording." : ""}
          helperText={`Sent as written. Use ${KINDS[kind]?.placeholders} where the name should go - it is filled in for each person.`}
          onChange={(event) => setDrafts((current) => ({ ...current, [wish.key]: event.target.value }))}
        />
        {/* This wish as typed, filled the way the sender fills it - never the saved copy. */}
        <MessagePreview text={(drafts[wish.key] ?? "").trim() ? renderTemplate(drafts[wish.key], KINDS[kind]?.sample) : ""} />
      </div>)}
      {canWrite && <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {changed.length > 0 && <p className="text-[11px] text-slate-500 sm:mr-auto">{changed.length} {changed.length === 1 ? "wish" : "wishes"} changed.</p>}
        <Button type="button" variant="primary" busy={saving} busyLabel="Saving..." disabled={!changed.length || empty} onClick={save}>Save</Button>
      </div>}
    </div>
  </CardState>;
}
