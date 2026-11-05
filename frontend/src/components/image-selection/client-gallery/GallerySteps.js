const steps = [
["01", "Pick one or multiple categories for each image — like Retouches and Frames simultaneously."], 
["02", "Images are instantly saved into your chosen selections for a streamlined workflow."], 
["03", " View your counts in the sidebar and finalize your choices when the curation is complete"]
];

export default function GallerySteps() {
  return <section aria-label="How to use this gallery" className="relative mx-auto mt-10 grid max-w-[1008px] gap-4 md:grid-cols-3 md:gap-6"><div className="pointer-events-none absolute left-[16.7%] right-[16.7%] top-11 hidden border-t border-dashed border-slate-300 md:block" />{steps.map(([number, title, body]) => <article key={number} className="relative min-h-[154px] rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_12px_32px_rgba(15,23,42,0.04)]"><p className="text-xs font-bold tracking-[0.16em] text-blue-600">{number}</p><h2 className="mt-3 text-sm font-semibold leading-5 text-slate-900">{title}</h2>{body && <p className="mt-2 text-sm leading-6 text-slate-500">{body}</p>}</article>)}</section>;
}
