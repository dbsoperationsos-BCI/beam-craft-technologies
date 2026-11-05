"use client";

import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import ImageUploadField from "@/components/shared/ImageUploadField";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";

export const OTHER_TYPE = "Other";

/** What the details step edits, from an event row or from nothing. */
export function detailsFrom(event, defaults) {
  const types = defaults?.general?.eventTypes || [];
  const type = event?.eventType || defaults?.general?.defaultEventType || "";
  const known = !type || types.includes(type);
  return {
    name: event?.name || "",
    // The dropdown's choice, and the free text used when the choice is Other.
    typeChoice: known ? type : OTHER_TYPE,
    customType: known ? "" : type,
    startDate: event?.startDate ? String(event.startDate).slice(0, 10) : "",
    endDate: event?.endDate ? String(event.endDate).slice(0, 10) : "",
    timezone: event?.timezone || defaults?.general?.defaultTimezone || "Asia/Kolkata",
    location: event?.location || "",
    description: event?.description || "",
    // `undefined` means "leave the cover as it is"; null removes it; a data URI replaces it.
    coverImage: undefined,
  };
}

/** The type the server is told: the free text when Other was chosen and filled in. */
export const eventTypeOf = (details) => (details.typeChoice === OTHER_TYPE && details.customType.trim() ? details.customType.trim() : details.typeChoice);

/** The fields the create and update endpoints both take, from the step's state. */
export function detailsPayload(details) {
  const payload = {
    name: details.name.trim(),
    eventType: eventTypeOf(details),
    startDate: details.startDate,
    endDate: details.endDate || null,
    timezone: details.timezone.trim() || undefined,
    location: details.location.trim() || null,
    description: details.description.trim() || null,
  };
  if (details.coverImage !== undefined) payload.coverImage = details.coverImage;
  return payload;
}

/**
 * Step one: what the event is called, what kind it is and when. The type list comes from Event
 * Default Settings; Other opens a free-text field so a studio is never stuck with the list.
 */
export default function DetailsStep({ details, onChange, problems, eventTypes, existingCoverUrl }) {
  const set = (name) => (value) => onChange(name, value);
  const fromInput = (name) => (changeEvent) => onChange(name, changeEvent.target.value);
  const options = [...new Set([...(eventTypes || []), OTHER_TYPE])].map((type) => ({ label: type, value: type }));
  const coverValue = details.coverImage === undefined ? existingCoverUrl || null : details.coverImage;

  return <div className="space-y-4">
    <TextField label="Event Name" required value={details.name} onChange={fromInput("name")} error={problems.name} maxLength={191} placeholder="Arun & Priya's Wedding" autoFocus />
    <div className="grid gap-4 sm:grid-cols-2">
      <Dropdown label="Event Type" required options={options} value={details.typeChoice} onChange={set("typeChoice")} error={problems.eventType} sorted={false} />
      {details.typeChoice === OTHER_TYPE && <TextField label="Which type?" value={details.customType} onChange={fromInput("customType")} maxLength={60} placeholder="Housewarming" />}
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <DateField label="Start Date" required value={details.startDate} onChange={set("startDate")} error={problems.startDate} />
      <DateField label="End Date" value={details.endDate} onChange={set("endDate")} minDate={details.startDate} error={problems.endDate} placeholder="Same day" />
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField label="Timezone" value={details.timezone} onChange={fromInput("timezone")} maxLength={64} placeholder="Asia/Kolkata" />
      <TextField label="Location" value={details.location} onChange={fromInput("location")} maxLength={255} placeholder="Venue, city" />
    </div>
    <TextAreaField label="Description" value={details.description} onChange={fromInput("description")} maxLength={4000} rows={3} placeholder="What guests see under the event name." />
    <ImageUploadField label="Cover Image" value={coverValue} onChange={(dataUrl) => onChange("coverImage", dataUrl || null)} compress={{ maxBytes: 600 * 1024, maxDimension: 2000 }} />
  </div>;
}
