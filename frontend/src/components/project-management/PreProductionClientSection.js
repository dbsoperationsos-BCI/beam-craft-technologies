"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Button from "@/components/shared/Button";
import { downloadPreProductionClientFile, getPreProductionClientForm, sendPreProductionToClient } from "@/services/project-management/pre-production.service";
import { ViewableImage } from "@/components/shared/ImageViewer";

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * The client's side of this shoot's details, read once for the form: whether it was sent to the
 * client's Beam Craft app to fill in, what is still owed, and the files they uploaded. `send` sends
 * (or reminds) and reads it again. The client's answers themselves are this form's own fields.
 */
export function usePreProductionClientForm(shootRecordId) {
  const [state, setState] = useState(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  // Read again after each send (`version`), so the bar says when it went.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!shootRecordId) return undefined;
    let active = true;
    getPreProductionClientForm(shootRecordId)
      .then((result) => { if (active) setState(result.data); })
      .catch((error) => { if (active) setMessage(error.message || "Unable to read what the client filled in."); });
    return () => { active = false; };
  }, [shootRecordId, version]);

  async function send() {
    setSending(true);
    setMessage("");
    try {
      const result = await sendPreProductionToClient(shootRecordId);
      setMessage(result.data?.phones ? "Sent - the client got a notification in the app." : "Sent - it is waiting in the client's app (no phone of theirs is signed in yet).");
      setVersion((current) => current + 1);
    } catch (error) {
      setMessage(error.message || "Unable to send to the client.");
    } finally {
      setSending(false);
    }
  }

  async function download(file) {
    try {
      await downloadPreProductionClientFile(shootRecordId, file);
    } catch (error) {
      setMessage(error.message || "Unable to download this file.");
    }
  }

  return { state, message, sending, send, download };
}

/**
 * Where the client's app stands: whether this shoot was sent to them to fill in (the Send to client
 * button is in the form's footer), when, and what is still owed.
 */
export function PreProductionClientBar({ client }) {
  const { state, message } = client;
  const sent = Boolean(state?.sentAt);
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
    <div className="min-w-0 flex-1 text-sm text-slate-700">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Client&apos;s app</p>
      {!state && <p className="mt-1">{message || "Loading…"}</p>}
      {state && !sent && <p className="mt-1">Not sent yet. The client can fill in every empty field of this shoot, and upload the invitation, dresses and decor files, in their app.</p>}
      {sent && <p className="mt-1">Sent {formatDateTime(state.sentAt)}. {state.done ? <span className="font-medium text-emerald-700">The client has filled in everything.</span> : <>Still to come: <span className="font-medium">{state.pending.join(", ")}</span>.</>}</p>}
      {state && message && <p className="mt-1 text-xs text-slate-500">{message}</p>}
    </div>

  </div>;
}

/**
 * One of the three checklist items only the client answers - the invitation, the dresses, the decor:
 * no Yes/No for the team, but what the client has done - uploaded files (each to download), said they
 * do not have them, or not yet. The item's own Yes follows the client's upload (`value`/`onChange`),
 * so saving the form keeps what the client sent.
 */
export function PreProductionClientFileField({ client, kind, label, value, onChange }) {
  const group = client.state?.files?.find((entry) => entry.kind === kind);
  const uploaded = Boolean(group?.files?.length);
  useEffect(() => {
    if (uploaded && value !== true) onChange(true);
  }, [uploaded, value, onChange]);
  let status = "Loading…";
  if (client.state) {
    if (group?.notAvailable) status = "The client said they do not have these.";
    else if (uploaded) status = `The client uploaded ${group.files.length} file${group.files.length === 1 ? "" : "s"}.`;
    else if (client.state.sentAt) status = "Waiting for the client to upload these in their app.";
    else status = "The client uploads these in their app once the form is sent to them.";
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Filled by client</span>
    </div>
    <p className="text-xs text-slate-500">{status}</p>
    {uploaded && <PreProductionClientFiles client={client} kind={kind} />}
  </div>;
}

/** The files the client uploaded for one checklist item (`kind`), each with Download. */
export function PreProductionClientFiles({ client, kind }) {
  const group = client.state?.files?.find((entry) => entry.kind === kind);
  if (!group || (!group.notAvailable && !group.files.length)) return null;
  if (group.notAvailable) return <p className="-mt-2 text-xs text-slate-500">The client said they do not have these.</p>;
  return <ul className="-mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200">
    {group.files.map((file) => <li key={file.id} className="flex items-center gap-3 px-3 py-2">
      {file.previewUrl
        ? <ViewableImage images={group.files.filter((entry) => entry.previewUrl).map((entry) => ({ src: entry.previewUrl, name: entry.name }))} index={group.files.filter((entry) => entry.previewUrl).indexOf(file)} label={`View ${file.name || group.label}`} className="rounded"><Image src={file.previewUrl} alt={file.name || group.label} width={40} height={40} unoptimized className="h-10 w-10 rounded object-cover" /></ViewableImage>
        : <span className="inline-flex h-10 w-10 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold uppercase text-slate-500">{(file.name || "").split(".").pop()?.slice(0, 4) || "file"}</span>}
      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{file.name || "File"}</span>
      <Button type="button" variant="secondary" size="sm" onClick={() => void client.download(file)}>Download</Button>
    </li>)}
  </ul>;
}
