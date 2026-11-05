import HelpTip from "@/components/shared/HelpTip";
/**
 * @param description Optional help: what the section is for and what changing it affects, in the
 *   studio's words (every Settings screen passes one - `settingsHelp.js`). Kept out of the way as the
 *   ⓘ beside the title, so the section opens on its fields rather than a paragraph.
 */
export default function SchemaFormSection({ id, title, description = "", children, wide = false }) {
  const widthClassName = wide ? "max-w-none" : "max-w-[1040px]";
  return <section id={id} data-schema-section={id} className="relative">
    <div className="sticky top-0 z-20 w-full border-b border-slate-200 bg-white">
      <div className={`w-full ${widthClassName} px-4 py-3.5 sm:px-6`}>
        <h2 className="flex items-center text-base font-medium text-slate-800 sm:text-lg">{title}<HelpTip text={description} /></h2>
      </div>
    </div>
    <div className={`w-full ${widthClassName} px-4 pb-6 pt-4 sm:px-6 sm:pb-7 sm:pt-5`}>
      {children}
    </div>
  </section>;
}
