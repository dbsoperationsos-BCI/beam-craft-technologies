/**
 * A screen in Image Selection that has not been built yet.
 *
 * Deliberately without a `ModulePageHeader` of its own. It is always rendered underneath
 * `ImageSelectionNavigation`, which is the module's header - and rendering a second one put two
 * module headers on the same page. That was invisible while the header held only a title, and
 * stopped being invisible the moment it gained a control: the dashboard showed two Nebula buttons,
 * one from each header.
 *
 * The title is a heading here rather than a header, which is what it always was.
 */
export default function ImageSelectionPlaceholderPage({ title, message }) {
  return <section className="w-full min-w-0 space-y-2"><h1 className="text-md leading-6 tracking-tight text-slate-700">{title}</h1><section className="flex min-h-[18rem] items-center justify-center rounded-lg border border-slate-200 bg-white p-5"><div className="max-w-md text-center"><div aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-xl text-slate-500">⌁</div><h2 className="mt-3 text-base font-semibold text-slate-800">{message}</h2></div></section></section>;
}
