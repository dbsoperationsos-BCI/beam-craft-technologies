"use client";

import Dropdown from "@/components/shared/Dropdown";
import TextField from "@/components/shared/TextField";
import ChipListField from "./ChipListField";
import NumberSetting from "./NumberSetting";
import SettingsCard from "./SettingsCard";

/**
 * General: what a new event starts as before anybody has typed - its type, its timezone, how many
 * days it runs - and the list of types the wizard's Event Type picker offers.
 *
 * The default type is chosen from the types listed, so the type that is the default cannot be
 * taken off the list; pick another default first.
 */
export default function GeneralSettings({ values, onChange, readOnly = false }) {
  const general = values.general || {};
  const eventTypes = general.eventTypes || [];
  const options = eventTypes.map((type) => ({ label: type, value: type }));
  // A default the list no longer names - saved before the type was removed by hand elsewhere - is
  // still shown, so the picker never draws an empty box over a value that is in fact stored.
  if (general.defaultEventType && !eventTypes.includes(general.defaultEventType)) options.unshift({ label: general.defaultEventType, value: general.defaultEventType });

  return <div className="space-y-4">
    <SettingsCard title="New event defaults" description="Pre-filled in the Create Event wizard. Every value can still be changed for the event being created.">
      <div className="grid gap-4 py-4 sm:grid-cols-2">
        <Dropdown label="Default event type" helperText="The type a new event starts with in the Create Event wizard." options={options} value={general.defaultEventType || ""} readOnly={readOnly} onChange={(value) => onChange("general", "defaultEventType", value)} sorted={false} />
        <TextField label="Default timezone" helperText="Time zone new events start with, written like Asia/Kolkata." readOnly={readOnly} value={general.defaultTimezone || ""} maxLength={64} placeholder="Asia/Kolkata" onChange={(event) => onChange("general", "defaultTimezone", event.target.value)} />
        <NumberSetting label="Default event duration" unit="days" min={1} max={30} readOnly={readOnly} value={general.defaultDurationDays} onChange={(value) => onChange("general", "defaultDurationDays", value)} description="How many days a new event is assumed to run; the wizard sets its end date from this." />
      </div>
    </SettingsCard>
    <SettingsCard title="Available event types" description="The types the wizard offers. Stored as a list - add one at a time, remove one with its ×.">
      <div className="py-4">
        <ChipListField
          label="Event types"
          values={eventTypes}
          onChange={(list) => onChange("general", "eventTypes", list)}
          placeholder="e.g. Anniversary"
          addLabel="Add event type"
          max={40}
          maxLength={60}
          min={1}
          disabled={readOnly}
          protect={(item) => item === general.defaultEventType}
          protectedReason="This is the default event type. Choose another default before removing it."
        />
      </div>
    </SettingsCard>
  </div>;
}
