"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import { getClientChat, listClientChats, replyClientChat, setClientChatStatus } from "@/services/sales/client-chats.service";

/*
 * Client Management -> Client Chats: the chats clients start from their app, one per topic (Pre Production,
 * Payment, Production, Shoot details, Services, Deliverables, Quotation, Other). The list on the left - unanswered ones marked -
 * and the conversation on the right, with the reply box. Both refresh every few seconds while open, so
 * a client's new message shows without reloading. Read to see them, Read / Write to answer.
 */

const REFRESH_MS = 8000;
// Nebula's replies (the AI answers a client's message first) are shown apart from the team's.
const NEBULA = "Nebula (AI assistant)";
const TOPIC_TONE = {
  payment: "bg-emerald-50 text-emerald-700",
  quotation: "bg-violet-50 text-violet-700",
  "pre-production": "bg-amber-50 text-amber-700",
  production: "bg-blue-50 text-blue-700",
  shoot: "bg-sky-50 text-sky-700",
  services: "bg-teal-50 text-teal-700",
  deliverables: "bg-indigo-50 text-indigo-700",
  other: "bg-slate-100 text-slate-600",
};

function when(value) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function TopicPill({ topic, label }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TOPIC_TONE[topic] || TOPIC_TONE.other}`}>{label}</span>;
}

export default function ClientChatsPage() {
  const { canWrite } = useModuleAccess("CLIENT", "Client Chats");
  const router = useRouter();
  const params = useSearchParams();
  const [chats, setChats] = useState(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [openId, setOpenId] = useState(() => Number(params.get("chat")) || null);
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const { notice, showError, clearNotice } = useNotice();
  const bottom = useRef(null);

  const loadList = useCallback(async () => {
    try {
      const result = await listClientChats({ unread: onlyUnread });
      setChats(result?.data || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Unable to load client chats.");
    }
  }, [onlyUnread]);

  const loadThread = useCallback(async (id) => {
    if (!id) return;
    try {
      const result = await getClientChat(id);
      setThread(result?.data || null);
    } catch (loadError) {
      showError(loadError.message || "Unable to load the chat.");
    }
  }, [showError]);

  useEffect(() => {
    const first = window.setTimeout(() => { void loadList(); void loadThread(openId); }, 0);
    const timer = window.setInterval(() => { void loadList(); void loadThread(openId); }, REFRESH_MS);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [loadList, loadThread, openId]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [thread?.messages?.length]);

  function open(id) {
    setOpenId(id);
    setThread(null);
    setReply("");
    router.replace(`/sales/client-chats?chat=${id}`, { scroll: false });
  }

  async function send(event) {
    event.preventDefault();
    if (!reply.trim() || !openId) return;
    setSending(true);
    try {
      await replyClientChat(openId, reply.trim());
      setReply("");
      await Promise.all([loadThread(openId), loadList()]);
    } catch (sendError) {
      showError(sendError.message || "The reply could not be sent.");
    } finally {
      setSending(false);
    }
  }

  async function toggleClosed() {
    try {
      await setClientChatStatus(openId, thread.status === "closed" ? "open" : "closed");
      await Promise.all([loadThread(openId), loadList()]);
    } catch (statusError) {
      showError(statusError.message || "Unable to update the chat.");
    }
  }

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader title="Client Chats" />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)]">
      {/* The chats, newest first. */}
      <aside className={`min-h-0 overflow-y-auto border-r border-slate-200 bg-white ${openId ? "max-md:hidden" : ""}`}>
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">Conversations</p>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={onlyUnread} onChange={(event) => setOnlyUnread(event.target.checked)} />
            Unanswered only
          </label>
        </div>
        {error ? <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {!chats && !error ? <div className="p-6"><Loader label="Loading chats..." /></div> : null}
        {chats && !chats.length ? <p className="px-4 py-10 text-center text-sm text-slate-500">{onlyUnread ? "Every chat is answered." : "No client has written yet."}</p> : null}
        <ul>
          {(chats || []).map((chat) => <li key={chat.id}>
            <button type="button" onClick={() => open(chat.id)} className={`flex w-full flex-col gap-1 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${chat.id === openId ? "bg-blue-50" : ""}`}>
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{chat.projectName || chat.eventId}</span>
                <span className="shrink-0 text-[11px] text-slate-400">{when(chat.lastMessageAt)}</span>
              </span>
              <span className="flex items-center gap-2">
                <TopicPill topic={chat.topic} label={chat.topicLabel} />
                <span className={`min-w-0 flex-1 truncate text-xs ${chat.unread ? "font-semibold text-slate-800" : "text-slate-500"}`}>
                  {chat.lastMessage ? `${chat.lastMessage.fromClient ? "" : "You: "}${chat.lastMessage.body}` : ""}
                </span>
                {chat.unread ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600" aria-label="Unanswered" /> : null}
                {chat.status === "closed" ? <span className="shrink-0 text-[11px] text-slate-400">Closed</span> : null}
              </span>
            </button>
          </li>)}
        </ul>
      </aside>

      {/* The conversation. */}
      <div className={`flex min-h-0 flex-col bg-slate-50 ${openId ? "" : "max-md:hidden"}`}>
        {!openId ? <p className="m-auto text-sm text-slate-500">Choose a conversation.</p> : !thread ? <div className="m-auto"><Loader label="Loading..." /></div> : <>
          <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <Button type="button" size="sm" className="md:hidden" onClick={() => { setOpenId(null); router.replace("/sales/client-chats", { scroll: false }); }}>Back</Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800">{thread.projectName || thread.eventId}</p>
              <p className="text-xs text-slate-500">{thread.eventId} · <TopicPill topic={thread.topic} label={thread.topicLabel} /></p>
            </div>
            {canWrite ? <Button type="button" size="sm" variant="secondary" onClick={() => void toggleClosed()}>{thread.status === "closed" ? "Reopen" : "Mark resolved"}</Button> : null}
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {thread.messages.map((message) => <div key={message.id} className={`flex ${message.fromClient ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${message.fromClient ? "rounded-bl-md bg-white text-slate-800" : message.author === NEBULA ? "rounded-br-md bg-violet-600 text-white" : "rounded-br-md bg-blue-600 text-white"}`}>
                {!message.fromClient ? <p className="mb-0.5 text-[11px] font-semibold text-blue-100">{message.author}</p> : null}
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                <p className={`mt-1 text-right text-[10px] ${message.fromClient ? "text-slate-400" : "text-blue-100"}`}>{when(message.at)}</p>
              </div>
            </div>)}
            <div ref={bottom} />
          </div>
          {canWrite ? <form onSubmit={(event) => void send(event)} className="flex items-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
            <textarea
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(event); } }}
              placeholder="Write a reply... (Enter to send, Shift+Enter for a new line)"
              rows={2}
              maxLength={2000}
              className="min-h-[44px] flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <Button type="submit" variant="primary" disabled={sending || !reply.trim()}>{sending ? "Sending..." : "Send"}</Button>
          </form> : <p className="border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">You can read client chats but not answer them.</p>}
        </>}
      </div>
    </div>
  </section>;
}
