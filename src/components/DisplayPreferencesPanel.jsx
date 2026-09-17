import { useEffect, useState } from "react";
import { getDisplayPreferences, normalizeDisplayPreferences } from "../utils/display-format.js";
const OPTIONS = {
  dateFormat: [["MMM_D_YYYY", "Aug 26, 1993"], ["MM_DD_YYYY_DASH", "08-26-1993"], ["MM_DD_YYYY_SLASH", "08/26/1993"], ["YYYY_MM_DD_SLASH", "1993/08/26"], ["YYYY_MM_DD_DASH", "1993-08-26"], ["D_MMM_YYYY", "26 Aug 1993"], ["MMM_D", "Aug 26"]],
  heightFormat: [["FT_IN_DASH", "Feet / inches"], ["INCHES", "Total inches"], ["CM", "Centimeters"]],
  weightFormat: [["LBS", "Pounds"], ["KG", "Kilograms"]],
  measurementFormat: [["INCHES", "Inches"], ["CM", "Centimeters"]],
};
const LABELS = { dateFormat: "Date display", heightFormat: "Height display", weightFormat: "Weight display", measurementFormat: "Body / physical measurements" };
export default function DisplayPreferencesPanel({ preferences = {}, setupConfig = {}, onSaved }) {
  const [draft, setDraft] = useState(() => getDisplayPreferences(setupConfig));
  const [busy, setBusy] = useState(false), [status, setStatus] = useState("");
  useEffect(() => { setDraft(getDisplayPreferences(setupConfig)); }, [preferences, setupConfig]);
  async function save() {
    setBusy(true); setStatus("");
    try {
      const response = await fetch("/api/account/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: { displayPreferences: normalizeDisplayPreferences(draft) } }) });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.message || "Could not save display preferences.");
      onSaved?.(data.preferences); setStatus("Saved for your account. Stored dates and measurements are unchanged.");
    } catch (error) { setStatus(error.message || "Could not save display preferences."); }
    finally { setBusy(false); }
  }
  return <section className="panel display-preferences-panel"><h3>My Display Preferences</h3><p>Used across Homestead for your account. Date-entry controls keep calendar values; size labels such as shoes and bras retain their original sizing system.</p>
    <div className="display-preference-options">{Object.entries(OPTIONS).map(([key, options]) => <label key={key}><span>{LABELS[key]}</span><select value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}</div>
    <footer><button className="primary-button" type="button" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save Display Preferences"}</button><span role="status">{status}</span></footer>
  </section>;
}
