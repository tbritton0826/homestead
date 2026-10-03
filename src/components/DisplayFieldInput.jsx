import { useEffect, useRef, useState } from "react";
import { formatHomesteadField, getDisplayPreferences, normalizeDisplayInput } from "../utils/display-format.js";
// value remains canonical in the parent; the local editing buffer follows units
// and date appearance. Unparseable legacy values remain editable, never guessed.
export default function DisplayFieldInput({ field, value = "", onChange, type = "text", ...props }) {
  const supported = /^(birthday|birthdate|dob|deathdate|adoptiondate|purchasedate|releasedate|date|height|weight|bust|waist|hips|chest|inseam|measurements|measurementsraw|length|width|depth)$/i.test(field || "");
  const label = () => supported ? formatHomesteadField(field, value, {}, String(value || "")) : String(value ?? "");
  const [text, setText] = useState(label), [invalid, setInvalid] = useState(false);
  const editing = useRef(false), input = useRef(null);
  const preferences = JSON.stringify(getDisplayPreferences());
  useEffect(() => { if (!editing.current) { setText(label()); setInvalid(false); input.current?.setCustomValidity(""); } }, [value, field, preferences]);
  if (!supported) return <input {...props} type={type} value={value} onChange={onChange} />;
  return <input {...props} ref={input} type="text" value={text} aria-invalid={invalid || undefined}
    onFocus={() => { editing.current = true; }}
    onChange={(event) => {
      const raw = event.target.value, result = normalizeDisplayInput(field, raw, value);
      setText(raw); setInvalid(!result.valid);
      event.target.setCustomValidity(result.valid ? "" : "Enter a valid date or measurement with units.");
      onChange?.({ target: { value: result.value }, currentTarget: { value: result.value } });
    }}
    onBlur={() => { editing.current = false; if (!invalid) setText(label()); }} />;
}
