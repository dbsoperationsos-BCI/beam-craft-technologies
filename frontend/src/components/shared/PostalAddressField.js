"use client";

import { useEffect, useMemo, useState } from "react";
import { searchPostOffices } from "@/services/location/india-post.service";

export default function PostalAddressField({ label = "Address", onQueryChange, onSelect, required = false, value = "" }) {
  const [query, setQuery] = useState(value);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(value), 0);
    return () => window.clearTimeout(timer);
  }, [value]);
  useEffect(() => {
    const search = query.trim();
    if ((!/^\d{6}$/.test(search) && search.length < 3) || search === value) {
      const timer = window.setTimeout(() => {
        setOptions([]);
        setError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("");
      try { setOptions(await searchPostOffices(search, controller.signal)); }
      catch (lookupError) { if (lookupError.name !== "AbortError") setError(lookupError.message || "Unable to search postal addresses."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, value]);
  const uniqueOptions = useMemo(() => [...new Map(options.map((office) => [`${office.branchName}-${office.pincode}`, office])).values()], [options]);
  function select(office) { setQuery(`${office.branchName} - ${office.pincode}`); setOptions([]); onSelect(office); }
  function changeQuery(event) { setQuery(event.target.value); onQueryChange?.(event.target.value); }
  return <div className="relative text-sm font-medium text-slate-700 md:col-span-2">
    <label>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}<input type="search" required={required} value={query} onChange={changeQuery} placeholder="Search branch name or enter a 6-digit PIN" autoComplete="off" className="mt-2 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
    {(loading || error || uniqueOptions.length > 0) && <div className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">{loading ? <p className="px-3 py-3 text-sm font-normal text-slate-500">Searching postal addresses...</p> : error ? <p role="alert" className="px-3 py-3 text-sm font-normal text-red-600">{error}</p> : uniqueOptions.map((office) => <button key={`${office.branchName}-${office.pincode}`} type="button" onClick={() => select(office)} className="block w-full border-b border-slate-100 px-3 py-2 text-left font-normal hover:bg-blue-50"><span className="block text-sm text-slate-800">{office.branchName} - {office.pincode}</span><span className="mt-0.5 block text-xs text-slate-500">{office.district}, {office.state}{office.branchType ? ` | ${office.branchType}` : ""}</span></button>)}</div>}
  </div>;
}
