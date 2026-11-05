"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import Dropdown from "@/components/shared/Dropdown";
import TextField from "@/components/shared/TextField";
import TextAreaField from "@/components/shared/TextAreaField";
import ImageUploadField from "@/components/shared/ImageUploadField";
import FileUploadField from "@/components/shared/FileUploadField";
import DateField from "@/components/shared/DateField";
import Button from "@/components/shared/Button";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import IconButton from "@/components/shared/IconButton";
import RadioGroupField from "@/components/shared/RadioGroupField";
import { branchLabel } from "@/lib/branchName";

const sections = [
  ["basic-details", "Basic Details"],
  ["inspection-purchase", "Inspection & Purchase"],
  ["insurance-attachments", "Insurance & Attachments"],
  ["location", "Location & Assignment"],
];

function toDateInput(value) {
  return value ? String(value).slice(0, 10) : "";
}

/*
 * Subcategory "Others": a subcategory not on the list. Chosen, a box beside it asks what it is; the
 * asset is saved under its Category, with the typed name as `subCategoryOther`.
 */
const OTHER_SUBCATEGORY = "__OTHER__";

function getInitialForm(asset, categories = [], prefill = null) {
  const selectedCategory = categories.find((item) => item.id === asset?.categoryId) || asset?.category;
  const other = Boolean(asset?.subCategoryOther);
  return {
    assetName: asset?.assetName || prefill?.assetName || "",
    topCategoryId: rootCategory(selectedCategory)?.id || prefill?.topCategoryId || "",
    categoryId: other ? OTHER_SUBCATEGORY : asset?.categoryId || prefill?.categoryId || "",
    subCategoryOther: asset?.subCategoryOther || "",
    company: asset?.company || "",
    specification: asset?.specification || "",
    color: asset?.color || "",
    serialNumber: asset?.serialNumber || "",
    branchId: String(asset?.branchId || ""),
    assignedPersonId: String(asset?.assignedPersonId || ""),
    managerId: String(asset?.managerId || ""),
    purchaseDate: toDateInput(asset?.purchaseDate),
    inspectionPeriodMonths: asset?.inspectionPeriodMonths ?? "",
    lastInspectedDate: toDateInput(asset?.lastInspectedDate),
    status: asset?.status || "ACTIVE",
    purchasePrice: asset?.purchasePrice ?? "",
    purchasedFrom: asset?.purchasedFrom || "",
    invoiceNumber: asset?.invoiceNumber || "",
    warrantyMonths: asset?.warrantyMonths ?? "",
    insuranceDetails: asset?.insuranceDetails || "",
    insuranceExpiry: toDateInput(asset?.insuranceExpiry),
    remarks: asset?.remarks || "",
    photoData: asset?.photoData || null,
    images: Array.isArray(asset?.images) ? asset.images : [],
    documents: Array.isArray(asset?.documents) ? asset.documents : [],
  };
}

function rootCategory(item) {
  let current = item;
  while (current?.parent) current = current.parent;
  return current;
}

/**
 * Turns the asset request being approved into starting values for this form. The request names a
 * category and optionally a sub category, while the form wants the root category and a *leaf* asset
 * type, so the sub category is only carried over when it has no children of its own — otherwise the
 * admin still has to pick the specific type.
 */
function prefillFromRequest(request, categories = []) {
  if (!request) return null;
  const subCategory = categories.find((item) => item.id === request.subCategoryId) || null;
  return {
    assetName: request.assetName || "",
    topCategoryId: rootCategory(subCategory)?.id || request.categoryId || "",
    categoryId: subCategory && !(subCategory.children || []).length ? subCategory.id : "",
  };
}

/**
 * What Add Asset offers. Single creates one asset from the form below; Bulk creates several that
 * share every field on it except the serial number, brand and colour, which are asked per asset.
 */
const assetEntryTypeChoices = [
  { value: "SINGLE", label: "Single Asset" },
  { value: "BULK", label: "Bulk Assets" },
];

export default function AssetFormDialog({ asset, request, categories, branches, employees, saving, error, onClose, onSave }) {
  const [form, setForm] = useState(() => getInitialForm(asset, categories, prefillFromRequest(request, categories)));
  const [errors, setErrors] = useState({});
  // Approving a request adds the one asset that was asked for, so the choice is not offered there.
  // Otherwise adding starts on Single and the radio at the top of the form switches it.
  const [entryType, setEntryType] = useState("SINGLE");
  const [quantity, setQuantity] = useState("");
  const [bulkItems, setBulkItems] = useState([{ serialNumber: "", company: "", color: "" }]);
  const topCategories = useMemo(() => categories.filter((item) => item.moduleType === "ASSET" && item.level === 1), [categories]);
  const assetTypes = useMemo(() => categories.filter((item) => item.moduleType === "ASSET" && !(item.children || []).length && rootCategory(item)?.id === form.topCategoryId), [categories, form.topCategoryId]);
  const allAssetTypes = useMemo(() => categories.filter((item) => item.moduleType === "ASSET" && !(item.children || []).length), [categories]);

  /** Clears a field's error as soon as the user edits it, so the form stops nagging mid-fix. */
  function clearError(...fields) {
    setErrors((current) => (fields.some((field) => current[field]) ? { ...current, ...Object.fromEntries(fields.map((field) => [field, ""])) } : current));
  }

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    clearError(field);
  }

  function changeCategory(value) {
    setForm((current) => ({ ...current, topCategoryId: value, categoryId: "", subCategoryOther: "" }));
    clearError("topCategoryId");
  }

  function changeAssetType(value) {
    if (value === OTHER_SUBCATEGORY) {
      setForm((current) => ({ ...current, categoryId: OTHER_SUBCATEGORY }));
      clearError("categoryId");
      return;
    }
    const category = categories.find((item) => item.id === value);
    setForm((current) => ({
      ...current,
      categoryId: value,
      subCategoryOther: "",
      topCategoryId: rootCategory(category)?.id || current.topCategoryId,
    }));
    clearError("categoryId", "topCategoryId");
  }

  // Mirrors the server contract in assets.controller.js: everything else on this form is optional.
  function validate(current) {
    return {
      assetName: current.assetName.trim() ? "" : "Asset Name is required.",
      topCategoryId: current.topCategoryId ? "" : "Category is required.",
      categoryId: current.categoryId ? "" : "Subcategory is required.",
      subCategoryOther: current.categoryId === OTHER_SUBCATEGORY && !current.subCategoryOther.trim() ? "Say which subcategory." : "",
      branchId: current.branchId ? "" : "Branch is required.",
    };
  }

  function submit(event) {
    event.preventDefault();
    const nextErrors = validate(form);
    const bulkQuantity = Number(quantity);
    if (!asset && entryType === "BULK") {
      if (!Number.isInteger(bulkQuantity) || bulkQuantity < 2 || bulkQuantity > 100) nextErrors.quantity = "Enter a quantity from 2 to 100.";
      else if (bulkItems.length !== bulkQuantity) nextErrors.bulkItems = `Add details for all ${bulkQuantity} assets.`;
      bulkItems.forEach((item, index) => {
        if (!item.serialNumber.trim()) nextErrors[`serialNumber-${index}`] = "Serial Number is required.";
        if (!item.company.trim()) nextErrors[`company-${index}`] = "Brand Name is required.";
        if (!item.color.trim()) nextErrors[`color-${index}`] = "Color is required.";
      });
    }
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      document.querySelector('[data-schema-section="basic-details"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const payload = {
      assetName: form.assetName,
      // "Others" files the asset under its Category, with the typed name beside it.
      categoryId: form.categoryId === OTHER_SUBCATEGORY ? form.topCategoryId || null : form.categoryId || null,
      subCategoryOther: form.categoryId === OTHER_SUBCATEGORY ? form.subCategoryOther.trim() : null,
      company: form.company || null,
      specification: form.specification || null,
      color: form.color || null,
      serialNumber: form.serialNumber || null,
      branchId: Number(form.branchId),
      assignedPersonId: form.assignedPersonId ? Number(form.assignedPersonId) : null,
      managerId: form.managerId ? Number(form.managerId) : null,
      purchaseDate: form.purchaseDate || null,
      inspectionPeriodMonths: form.inspectionPeriodMonths === "" ? null : Number(form.inspectionPeriodMonths),
      lastInspectedDate: form.lastInspectedDate || null,
      purchasePrice: form.purchasePrice === "" ? null : Number(form.purchasePrice),
      purchasedFrom: form.purchasedFrom || null,
      invoiceNumber: form.invoiceNumber || null,
      warrantyMonths: form.warrantyMonths === "" ? null : Number(form.warrantyMonths),
      insuranceDetails: form.insuranceDetails || null,
      insuranceExpiry: form.insuranceExpiry || null,
      remarks: form.remarks || null,
      photoData: form.photoData || null,
      images: form.images.length ? form.images : null,
      documents: form.documents.length ? form.documents : null,
    };
    if (!asset && entryType === "BULK") payload.bulkItems = bulkItems.map((item) => ({ serialNumber: item.serialNumber.trim(), company: item.company.trim(), color: item.color.trim() }));
    onSave(payload);
  }

  function updateBulkItem(index, field, value) {
    setBulkItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
    clearError(`${field}-${index}`, "bulkItems");
  }

  const isBlankBulkItem = (item) => !item.serialNumber.trim() && !item.company.trim() && !item.color.trim();

  /**
   * Lowering the quantity used to strand the form: Save stayed disabled because the row count no
   * longer matched, "Add asset" stayed disabled because there were already too many, and the
   * mismatch message only rendered after a submit that could never run. Blank trailing rows are
   * now dropped automatically, and anything the user actually typed is kept and reported live.
   */
  function changeQuantity(value) {
    setQuantity(value);
    const target = Number(value);
    if (Number.isInteger(target) && target >= 1) {
      setBulkItems((current) => {
        const next = [...current];
        while (next.length > target && isBlankBulkItem(next[next.length - 1])) next.pop();
        return next.length === current.length ? current : next;
      });
    }
    clearError("quantity", "bulkItems");
  }

  function addBulkItem() {
    const target = Number(quantity);
    if (!Number.isInteger(target) || target < 2 || bulkItems.length >= target) return;
    setBulkItems((current) => [...current, { serialNumber: "", company: "", color: "" }]);
    clearError("bulkItems");
  }

  function removeBulkItem(index) {
    if (bulkItems.length === 1) return;
    setBulkItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  const bulkComplete = entryType !== "BULK" || (Number.isInteger(Number(quantity)) && Number(quantity) >= 2 && bulkItems.length === Number(quantity) && bulkItems.every((item) => item.serialNumber.trim() && item.company.trim() && item.color.trim()));
  // Positive when there are more rows than the quantity asks for, negative when there are fewer.
  const bulkRowGap = entryType === "BULK" && Number.isInteger(Number(quantity)) && Number(quantity) >= 2 ? bulkItems.length - Number(quantity) : 0;
  const bulkRowMessage = bulkRowGap > 0
    ? `Remove ${bulkRowGap} asset${bulkRowGap === 1 ? "" : "s"}, or raise the quantity to ${bulkItems.length}.`
    : bulkRowGap < 0 ? `Add details for ${-bulkRowGap} more asset${bulkRowGap === -1 ? "" : "s"}.` : "";

  return (
    <SchemaFormPanel title={asset ? "Edit Asset" : request ? `Approve ${request.requestCode}` : "Add Asset"} description={request ? "Approving this request adds the asset that was asked for. Fill in the rest of its details." : "Store the most specific asset type for this record."} sections={sections} onClose={onClose} onSubmit={submit} error={error} footer={<><Button className="max-sm:flex-1" type="button" onClick={onClose} disabled={saving}>Cancel</Button><Button className="max-sm:flex-1" variant="primary" disabled={saving || !bulkComplete}>{saving ? "Saving..." : entryType === "BULK" ? `Upload ${quantity || ""} Assets` : request ? "Approve & Add Asset" : asset ? "Update Asset" : "Save Asset"}</Button></>}>
      {/* One asset or many. Above the first heading because it is not one of the Basic Details —
          it is the question the whole form answers, and the fields below react as it changes. */}
      {!asset && !request && <div className="w-full max-w-[1040px] border-b border-slate-200 px-4 py-4 sm:px-6 sm:py-5">
        <RadioGroupField
          label="Entry Type"
          helperText="Single adds one asset; Bulk adds several of the same kind at once."
          value={entryType}
          onChange={(value) => { setEntryType(value); setErrors({}); }}
          options={assetEntryTypeChoices}
          controlClassName="px-0 py-0"
        />
      </div>}
      <SchemaFormSection id="basic-details" title="Basic Details">
        <div className="grid gap-4 md:grid-cols-2">
          {request && <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 sm:text-sm md:col-span-2">Requested by {request.requestedByName || "—"}{request.remarks ? ` — "${request.remarks}"` : ""}</div>}
          {!asset && entryType === "BULK" && <TextField required error={errors.quantity} label="Quantity" helperText="How many of this asset you are adding, between 2 and 100." type="number" min="2" max="100" step="1" value={quantity} onChange={(event) => changeQuantity(event.target.value)} />}
          <TextField label="Asset ID" helperText="The studio's code for this asset, given automatically when it is saved." value={asset?.assetCode || ""} placeholder="Generated on save" readOnly />
          <TextField required error={errors.assetName} label="Asset Name" helperText="What the studio calls this item, shown in the asset list and searches." value={form.assetName} onChange={(event) => update("assetName", event.target.value)} />
          <Dropdown searchable required error={errors.topCategoryId} label="Category" helperText="The main group this asset belongs to; it narrows the subcategory list." value={form.topCategoryId} onChange={changeCategory} placeholder="Select category" options={topCategories.map((item) => ({ value: item.id, label: item.name }))} />
          <Dropdown searchable required error={errors.categoryId} label="Subcategory" helperText="The most specific type of asset; pick Others to type a new one." value={form.categoryId} onChange={changeAssetType} placeholder="Select subcategory" sorted={false} options={[...(form.topCategoryId ? assetTypes : allAssetTypes).map((item) => ({ value: item.id, label: item.name })).sort((a, b) => a.label.localeCompare(b.label)), ...(form.topCategoryId ? [{ value: OTHER_SUBCATEGORY, label: "Others" }] : [])]} />
          {form.categoryId === OTHER_SUBCATEGORY && <TextField required error={errors.subCategoryOther} label="Subcategory (Others)" helperText="The asset type, when none of the listed subcategories fits." placeholder="Type the subcategory" maxLength={191} value={form.subCategoryOther} onChange={(event) => update("subCategoryOther", event.target.value)} />}
          {(asset || entryType === "SINGLE") && <TextField label="Brand Name" helperText="The maker of the item, for example Canon or Sony." value={form.company} onChange={(event) => update("company", event.target.value)} />}
          {(asset || entryType === "SINGLE") && <TextField label="Color" helperText="The item's colour, which helps tell matching assets apart." value={form.color} onChange={(event) => update("color", event.target.value)} />}
          {(asset || entryType === "SINGLE") && <TextField label="Serial Number" helperText="The number printed on the item, used to identify it for warranty and insurance." value={form.serialNumber} onChange={(event) => update("serialNumber", event.target.value)} />}
          <Dropdown searchable required error={errors.branchId} label="Branch" helperText="The branch that holds this asset; it decides who can see it." value={form.branchId} onChange={(value) => update("branchId", value)} placeholder="Select branch" options={branches.map((item) => ({ value: String(item.id), label: branchLabel(item.name) }))} />
          <Dropdown searchable label="Assigned Person" helperText="The employee currently using this asset; leave empty if nobody has it." value={form.assignedPersonId} onChange={(value) => update("assignedPersonId", value)} placeholder="Unassigned" options={employees.map((item) => ({ value: String(item.id), label: `${item.employeeName} (${item.employeeId || "—"})`, avatar: avatarOf(item) }))} />
          <Dropdown searchable label="Manager" helperText="The employee responsible for looking after this asset." value={form.managerId} onChange={(value) => update("managerId", value)} placeholder="No manager" options={employees.map((item) => ({ value: String(item.id), label: `${item.employeeName} (${item.employeeId || "—"})`, avatar: avatarOf(item) }))} />
          <TextAreaField className="md:col-span-2" label="Specification" helperText="Model details such as lens range, storage size or resolution." value={form.specification} onChange={(event) => update("specification", event.target.value)} />
          <TextAreaField className="md:col-span-2" label="Remarks" helperText="Any other note about this asset for whoever handles it next." value={form.remarks} onChange={(event) => update("remarks", event.target.value)} />
        </div>
        {!asset && entryType === "BULK" && <div className="mt-6 border-t border-slate-200 pt-5">
          <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium text-slate-800">Individual asset details</h3><p className="mt-1 text-xs text-slate-500">{bulkItems.length} of {quantity || 0} assets added</p></div><Button type="button" size="sm" variant="secondary" onClick={addBulkItem} disabled={!Number.isInteger(Number(quantity)) || Number(quantity) < 2 || bulkItems.length >= Number(quantity)}> Add asset</Button></div>
          {(bulkRowMessage || errors.bulkItems) && <p role="alert" className="mb-3 text-xs text-red-600">{bulkRowMessage || errors.bulkItems}</p>}
          <div className="space-y-4">{bulkItems.map((item, index) => <div key={index} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:p-4"><div className="mb-3 flex items-center justify-between"><h4 className="text-xs font-semibold text-slate-700 sm:text-sm">Asset {index + 1}</h4>{bulkItems.length > 1 && <IconButton label={`Remove asset ${index + 1}`} size="sm" className="text-red-600 hover:bg-red-50" onClick={() => removeBulkItem(index)}><DeleteOutlineIcon sx={{ fontSize: 19 }} /></IconButton>}</div><div className="grid gap-4 md:grid-cols-3"><TextField required error={errors[`serialNumber-${index}`]} label="Serial Number" helperText="The number printed on this item, to tell it apart from the others." value={item.serialNumber} onChange={(event) => updateBulkItem(index, "serialNumber", event.target.value)} /><TextField required error={errors[`company-${index}`]} label="Brand Name" helperText="The maker of this item, for example Canon or Sony." value={item.company} onChange={(event) => updateBulkItem(index, "company", event.target.value)} /><TextField required error={errors[`color-${index}`]} label="Color" helperText="This item's colour, which helps tell matching assets apart." value={item.color} onChange={(event) => updateBulkItem(index, "color", event.target.value)} /></div></div>)}</div>
        </div>}
      </SchemaFormSection>
      <SchemaFormSection id="inspection-purchase" title="Inspection & Purchase">
        <div className="grid gap-4 md:grid-cols-2">
          <DateField label="Purchase Date" helperText="When the studio bought it; also the start for the first inspection date." value={form.purchaseDate} onChange={(value) => update("purchaseDate", value)} restriction="future" />
          <TextField label="Inspection Period (months)" helperText="How often it should be inspected; sets the next inspection date." type="number" min="0" max="600" step="1" value={form.inspectionPeriodMonths} onChange={(event) => update("inspectionPeriodMonths", event.target.value)} />
          <DateField label="Last Inspected Date" helperText="When it was last checked; the next inspection is counted from here." value={form.lastInspectedDate} onChange={(value) => update("lastInspectedDate", value)} restriction="future" />
          <TextField label="Purchase Price" helperText="What the studio paid for it, in rupees." type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(event) => update("purchasePrice", event.target.value)} />
          <TextField label="Purchased From" helperText="The shop or vendor it was bought from." value={form.purchasedFrom} onChange={(event) => update("purchasedFrom", event.target.value)} />
          <TextField label="Invoice Number" helperText="The number on the purchase bill, for warranty and insurance claims." value={form.invoiceNumber} onChange={(event) => update("invoiceNumber", event.target.value)} />
          <TextField label="Warranty in Months" helperText="How long the maker's warranty lasts from the purchase date." type="number" min="0" value={form.warrantyMonths} onChange={(event) => update("warrantyMonths", event.target.value)} />
        </div>
      </SchemaFormSection>
      <SchemaFormSection id="insurance-attachments" title="Insurance & Attachments">
        <div className="grid gap-4 md:grid-cols-2">
          <TextAreaField label="Insurance Details" helperText="The insurer, policy number and cover for this asset, if insured." value={form.insuranceDetails} onChange={(event) => update("insuranceDetails", event.target.value)} />
          <DateField label="Insurance Expiry" helperText="The date the insurance policy for this asset ends." value={form.insuranceExpiry} onChange={(value) => update("insuranceExpiry", value)} restriction="past" />
          <ImageUploadField label="Primary Image" helperText="The main photo shown for this asset in the list and details." value={form.photoData} onChange={(value) => update("photoData", value)} />
          <FileUploadField label="Images" helperText="More photos of the asset, up to ten, for example its condition." image value={form.images} onChange={(value) => update("images", value)} accept=".avif,.gif,.jpeg,.jpg,.png,.webp" />
          <FileUploadField className="md:col-span-2" label="Documents" helperText="Bills, warranty cards or manuals for this asset, up to ten files." value={form.documents} onChange={(value) => update("documents", value)} accept=".pdf,.doc,.docx,.xls,.xlsx,.txt" />
        </div>
      </SchemaFormSection>
    </SchemaFormPanel>
  );
}
