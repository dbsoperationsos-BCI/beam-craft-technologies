"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useEffect, useId, useMemo, useState } from "react";
import Image from "next/image";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import TextAreaField from "@/components/shared/TextAreaField";
import useFormErrors from "@/components/shared/useFormErrors";
import { getAssetInspectionContext } from "@/services/assets/assets.service";
import { compressImageFile } from "@/lib/imageCompression";
import { ViewableImage } from "@/components/shared/ImageViewer";
import HelpTip from "@/components/shared/HelpTip";
import { detailHelpFor } from "@/constants/detailHelp";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const allowedTypes = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const conditionOptions = ["Excellent", "Good", "Fair", "Damaged"].map((value) => ({ value, label: value }));
const sections = [["asset-information", "Asset Information"], ["inspection-details", "Inspection Details"], ["inspection-images", "Inspection Images"]];

function metadataKey(image) {
  return [String(image.fileName || "").trim().toLowerCase(), String(image.mimeType || "").toLowerCase(), Number(image.fileSize), image.lastModifiedAt ? new Date(image.lastModifiedAt).getTime() : ""].join("|");
}

// The duplicate fingerprint must describe the file the user picked, not the compressed upload,
// so the original name, type, size and timestamp are kept alongside the shrunken image bytes.
async function readImage(file, slot, source) {
  const compressed = await compressImageFile(file);
  return { slot, imageData: compressed.dataUrl, fileName: file.name, mimeType: file.type, fileSize: file.size, lastModifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null, compressedSize: compressed.byteSize, metadata: { source, originalName: file.name, type: file.type, size: file.size, lastModified: file.lastModified || null, compressedSize: compressed.byteSize, width: compressed.width, height: compressed.height } };
}

function InspectionImageField({ slot, value, error, disabled, previousKeys, currentImages, onChange }) {
  const inputId = useId();
  const cameraInputId = useId();

  async function select(event, source) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!allowedTypes.has(file.type)) return onChange(null, "Choose an AVIF, GIF, JPG, PNG, or WEBP image.");
    if (file.size > MAX_FILE_SIZE) return onChange(null, "Image must be 5 MB or smaller.");
    try {
      const image = await readImage(file, slot, source);
      const key = metadataKey(image);
      if (previousKeys.has(key)) return onChange(image, "This image was taken during the last inspection.");
      if (currentImages.some((item) => item && item.slot !== slot && metadataKey(item) === key)) return onChange(image, "Upload a different image for each inspection slot.");
      return onChange(image, "");
    } catch (readError) {
      return onChange(null, readError.message);
    }
  }

  return <div className="rounded-lg border border-slate-200 p-3"><p className="text-[11px] font-semibold text-slate-600 sm:text-xs">Inspection Image {slot}<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span></p><div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">{value?.imageData ? <ViewableImage images={[value.imageData]} label={`View inspection image ${slot}`} className="shrink-0 rounded-lg"><Image src={value.imageData} alt={`Inspection selection ${slot}`} width={96} height={96} unoptimized className="h-24 w-24 rounded-lg border border-slate-200 object-cover" /></ViewableImage> : <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-[11px] text-slate-400">No image</div>}<div className="flex min-w-0 flex-1 flex-col gap-2"><div className="flex flex-col gap-2 sm:flex-row"><label htmlFor={cameraInputId} className={`cursor-pointer rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-center text-xs font-medium text-blue-700 hover:bg-blue-100 sm:hidden ${disabled ? "pointer-events-none opacity-60" : ""}`}>Take photo</label><label htmlFor={inputId} className={`cursor-pointer rounded-md border border-slate-300 px-3 py-2 text-center text-xs font-medium text-slate-700 hover:bg-slate-50 ${disabled ? "pointer-events-none opacity-60" : ""}`}><span className="sm:hidden">Choose from gallery</span><span className="hidden sm:inline">{value ? "Replace image" : "Choose image"}</span></label></div><input id={inputId} type="file" accept=".avif,.gif,.jpeg,.jpg,.png,.webp" disabled={disabled} onChange={(event) => void select(event, "file-picker")} className="sr-only" /><input id={cameraInputId} type="file" accept="image/*" capture="environment" disabled={disabled} onChange={(event) => void select(event, "camera")} className="sr-only" />{value && <p className="truncate text-[11px] font-normal text-slate-500">{value.fileName} · {Math.ceil(value.fileSize / 1024)} KB{value.compressedSize ? ` → ${Math.ceil(value.compressedSize / 1024)} KB` : ""}</p>}</div></div>{error && <p role="alert" className="mt-2 text-xs font-medium text-red-600">{error}</p>}</div>;
}

export default function AssetInspectionDialog({ asset, employees, saving, error, onClose, onSubmit }) {
  const [condition, setCondition] = useState("");
  const [remarks, setRemarks] = useState("");
  const [inspectedOn, setInspectedOn] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [inspectedById, setInspectedById] = useState("");
  const [images, setImages] = useState([null, null, null]);
  const [imageErrors, setImageErrors] = useState(["", "", ""]);
  const [previousInspections, setPreviousInspections] = useState([]);
  const [contextError, setContextError] = useState("");
  const fields = useFormErrors();

  useEffect(() => {
    let cancelled = false;
    getAssetInspectionContext(asset.id).then((result) => { if (!cancelled) setPreviousInspections(result.data || []); }).catch((requestError) => { if (!cancelled) setContextError(requestError.message || "Unable to check previous inspection images."); });
    return () => { cancelled = true; };
  }, [asset.id]);

  const previousKeys = useMemo(() => new Set(previousInspections.flatMap((inspection) => inspection.images || []).map(metadataKey)), [previousInspections]);

  function updateImage(slot, image, imageError) {
    setImages((current) => current.map((item, index) => index === slot - 1 ? image : item));
    setImageErrors((current) => current.map((item, index) => index === slot - 1 ? imageError : item));
    fields.clear(`image${slot}`);
  }

  function submit(event) {
    event.preventDefault();
    const nextErrors = images.map((image, index) => imageErrors[index] || (!image ? "This inspection image is required." : ""));
    setImageErrors(nextErrors);
    // Each missing answer is said under its own box; the images keep their own messages.
    const ok = fields.check({
      inspectedOn: inspectedOn ? "" : "Choose the inspection date.",
      inspectedById: inspectedById ? "" : "Choose who inspected the asset.",
      condition: condition ? "" : "Choose the asset's condition.",
      remarks: remarks.trim() ? "" : "Enter the remarks.",
      image1: nextErrors[0], image2: nextErrors[1], image3: nextErrors[2],
    });
    if (!ok) return;
    onSubmit({ condition, remarks: remarks.trim(), inspectedOn, inspectedById: Number(inspectedById), images });
  }

  return <SchemaFormPanel title="Start Inspection" description="Record the asset condition and three current inspection images." sections={sections} sidebarAriaLabel="Asset inspection sections" closeAriaLabel="Close asset inspection" onClose={onClose} onSubmit={submit} error={error || contextError || fields.summary} footer={<><Button className="max-sm:flex-1" type="button" onClick={onClose} disabled={saving}>Cancel</Button><Button className="max-sm:flex-1" variant="primary" disabled={saving}>{saving ? "Saving..." : "Complete Inspection"}</Button></>}>
    <section id="asset-information" data-schema-section="asset-information" className="border-b border-slate-200"><div className="w-full max-w-[1040px] px-4 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5"><h2 className="mb-2 text-[11px] font-semibold text-slate-600 sm:text-xs">Asset Information</h2><dl className="grid gap-x-6 gap-y-2 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-[11px] text-slate-600 sm:grid-cols-2 sm:text-xs xl:grid-cols-3"><div><dt className="inline-flex items-center font-semibold text-slate-800">Asset ID<HelpTip text={detailHelpFor("Asset Details", "assetCode")} /> :</dt> <dd className="inline">{asset.assetCode}</dd></div><div><dt className="inline-flex items-center font-semibold text-slate-800">Asset Name<HelpTip text={detailHelpFor("Asset Details", "assetName")} /> :</dt> <dd className="inline">{asset.assetName}</dd></div><div><dt className="inline-flex items-center font-semibold text-slate-800">Inspection Due<HelpTip text={detailHelpFor("Inspection and Purchase", "nextInspectionDate")} /> :</dt> <dd className="inline">{asset.nextInspectionDate ? String(asset.nextInspectionDate).slice(0, 10) : "—"}</dd></div></dl></div></section>
    <SchemaFormSection id="inspection-details" title="Inspection Details"><div className="grid gap-4 md:grid-cols-2"><DateField required label="Inspected On" helperText="The day the asset was checked; the next inspection is counted from it." value={inspectedOn} onChange={(value) => { fields.clear("inspectedOn"); setInspectedOn(value); }} restriction="future" error={fields.errors.inspectedOn} /><Dropdown searchable required label="Inspected By" helperText="The employee who physically checked the asset." value={inspectedById} onChange={(value) => { fields.clear("inspectedById"); setInspectedById(value); }} error={fields.errors.inspectedById} options={employees.map((employee) => ({ value: String(employee.id), label: `${employee.employeeName} (${employee.employeeId || "—"})`, avatar: avatarOf(employee) }))} placeholder="Select employee" /><Dropdown required label="Condition" helperText="The state the asset was found in at this inspection." value={condition} onChange={(value) => { fields.clear("condition"); setCondition(value); }} error={fields.errors.condition} options={conditionOptions} placeholder="Select condition" /><TextAreaField required className="md:col-span-2" label="Remarks" helperText="What was checked and anything found, such as damage or missing parts." value={remarks} onChange={(event) => { fields.clear("remarks"); setRemarks(event.target.value); }} error={fields.errors.remarks} /></div></SchemaFormSection>
    <SchemaFormSection id="inspection-images" title="Inspection Images"><div className="grid gap-4 lg:grid-cols-3">{[1, 2, 3].map((slot) => <InspectionImageField key={slot} slot={slot} value={images[slot - 1]} error={imageErrors[slot - 1]} disabled={saving} previousKeys={previousKeys} currentImages={images} onChange={(image, imageError) => updateImage(slot, image, imageError)} />)}</div><p className="mt-3 text-xs text-slate-500">Image metadata is compared with the current and last two retained inspection image sets. On completion, the oldest set is overwritten.</p></SchemaFormSection>
  </SchemaFormPanel>;
}
