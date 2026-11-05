"use client";
import { useState } from "react";
import UploadQueueItem from "./UploadQueueItem";

const PAGE_SIZE = 100;
export default function UploadQueue({ items, onPause, onResume, onRetry, onCancel, onClearCompleted }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  if (!items.length) return null;
  const completed = items.filter((item) => item.status === "ready").length;
  const visible = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  return <section className="mt-4 max-w-[720px]" aria-label="Upload queue"><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold text-slate-800">Upload Queue <span className="font-normal text-slate-500">({items.length})</span></h3>{completed > 0 && <button type="button" onClick={onClearCompleted} className="text-[10px] font-medium text-blue-600 hover:underline">Clear completed</button>}</div><ul className="space-y-2">{visible.map((item) => <UploadQueueItem key={item.id} item={item} onPause={() => onPause(item.id)} onResume={() => onResume(item.id)} onRetry={() => onRetry(item.id)} onCancel={() => onCancel(item.id)} />)}</ul>{totalPages > 1 && <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500"><span>Images {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, items.length)} of {items.length}</span><div className="flex gap-2"><button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">Previous</button><button type="button" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">Next</button></div></div>}</section>;
}
