// Display only: storage keeps ISO dates and explicitly-unit-tagged measurements.
// Never use a formatted label as an input to a save/import operation.
export const DISPLAY_DEFAULTS = Object.freeze({ dateFormat: "MMM_D_YYYY", heightFormat: "FT_IN_DASH", weightFormat: "LBS", measurementFormat: "INCHES" });
const ALLOWED = { dateFormat: ["MMM_D_YYYY", "MM_DD_YYYY_DASH", "MM_DD_YYYY_SLASH", "YYYY_MM_DD_SLASH", "YYYY_MM_DD_DASH", "D_MMM_YYYY", "MMM_D"], heightFormat: ["FT_IN_DASH", "INCHES", "CM"], weightFormat: ["LBS", "KG"], measurementFormat: ["INCHES", "CM"] };
let activeUserPreferences = {};
let globalPreferences = {};
export function normalizeDisplayPreferences(value = {}, fallback = {}) {
  const result = {};
  for (const [key, allowed] of Object.entries(ALLOWED)) {
    const selected = value?.[key] ?? fallback?.[key];
    if (allowed.includes(selected)) result[key] = selected;
  }
  return result;
}
export function setActiveDisplayPreferences(userPreferences = {}, setup = {}) {
  activeUserPreferences = normalizeDisplayPreferences(userPreferences?.displayPreferences || userPreferences);
  globalPreferences = normalizeDisplayPreferences(setup?.displayPreferences || setup, {
    dateFormat: setup?.dateDisplayFormat, heightFormat: setup?.heightDisplayFormat, weightFormat: setup?.weightDisplayFormat,
  });
}
export function getDisplayPreferences(setup = {}) {
  return { ...DISPLAY_DEFAULTS, ...globalPreferences,
    ...normalizeDisplayPreferences(setup?.displayPreferences || setup, { dateFormat: setup?.dateDisplayFormat, heightFormat: setup?.heightDisplayFormat, weightFormat: setup?.weightDisplayFormat }),
    ...activeUserPreferences };
}
export const getHomesteadDateFormat = (setup) => getDisplayPreferences(setup).dateFormat;
export const getHomesteadHeightFormat = (setup) => getDisplayPreferences(setup).heightFormat;
export const getHomesteadWeightFormat = (setup) => getDisplayPreferences(setup).weightFormat;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
function validParts(year, month, day) {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const check = new Date(0); check.setUTCFullYear(year, month - 1, day); check.setUTCHours(12, 0, 0, 0);
  return check.getUTCMonth() + 1 === month && check.getUTCDate() === day ? { year, month, day } : null;
}
export function parseHomesteadDateParts(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date || typeof value === "number") {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : validParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }
  const raw = String(value).trim();
  // Date-only values are calendar dates, not UTC instants. Do not shift birthdays.
  let match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|T)/);
  if (match) return validParts(+match[1], +match[2], +match[3]);
  match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) return validParts(+match[3], +match[1], +match[2]);
  match = raw.match(/^(?:([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4}))$/);
  if (match) {
    const month = MONTHS.findIndex((m) => m.toLowerCase() === (match[1] || match[5]).slice(0, 3).toLowerCase()) + 1;
    return validParts(+(match[3] || match[6]), month, +(match[2] || match[4]));
  }
  return null;
}
export function formatHomesteadDate(value, setup = {}, fallback = "—") {
  const raw = String(value ?? "").trim();
  if (/^\d{4}$/.test(raw)) return raw; // known year, not a fabricated January 1
  const monthOnly = raw.match(/^(\d{4})[-/](\d{2})$/);
  if (monthOnly && +monthOnly[2] >= 1 && +monthOnly[2] <= 12) return `${MONTHS[+monthOnly[2] - 1]} ${monthOnly[1]}`;
  const p = parseHomesteadDateParts(value);
  if (!p) return fallback;
  const mm = pad(p.month), dd = pad(p.day), month = MONTHS[p.month - 1];
  switch (getHomesteadDateFormat(setup)) {
    case "MM_DD_YYYY_DASH": return `${mm}-${dd}-${p.year}`;
    case "MM_DD_YYYY_SLASH": return `${mm}/${dd}/${p.year}`;
    case "YYYY_MM_DD_SLASH": return `${p.year}/${mm}/${dd}`;
    case "YYYY_MM_DD_DASH": return `${p.year}-${mm}-${dd}`;
    case "D_MMM_YYYY": return `${p.day} ${month} ${p.year}`;
    case "MMM_D": return `${month} ${p.day}`;
    default: return `${month} ${p.day}, ${p.year}`;
  }
}
export function formatHomesteadTime(value, options = { hour: "numeric", minute: "2-digit" }, fallback = "—") {
  const date = new Date(value);
  return !value || Number.isNaN(date.getTime()) ? fallback : date.toLocaleTimeString(undefined, options);
}
export function formatHomesteadDateTime(value, setup = {}, fallback = "—") {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return fallback;
  return `${formatHomesteadDate(date, setup, fallback)} · ${formatHomesteadTime(date)}`;
}
export function formatHomesteadPreciseDate(value, precision = "day", setup = {}) {
  if (!value || precision === "unknown") return "Unknown date";
  const p = parseHomesteadDateParts(value);
  if (!p) return "Unknown date";
  if (precision === "year") return String(p.year);
  if (precision === "month") return `${MONTHS[p.month - 1]} ${p.year}`;
  return precision === "time" ? formatHomesteadDateTime(value, setup) : formatHomesteadDate(value, setup);
}
const number = (n) => Number.isFinite(+n) && +n > 0 ? +n : null;
// Canonical physical lengths are cm; canonical mass is kg. Size labels (bra,
// shoe, clothing) are not physical lengths and must retain their stated system.
export function canonicalLength(value, legacyUnit = "in") {
  if (value && typeof value === "object") return canonicalLength(`${value.value ?? value.amount ?? ""} ${value.unit || legacyUnit}`, legacyUnit);
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const feet = raw.match(/^(\d+)\s*(?:ft|feet|'|’|′)\s*[- ]?\s*(\d+(?:\.\d+)?)?\s*(?:in|inches|["”″])?$/);
  if (feet) return { value: (+feet[1] * 12 + +(feet[2] || 0)) * 2.54, unit: "cm" };
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(cm|centimeters?|centimetres?|mm|m|meters?|metres?|in|inch|inches|["”″])?(?:\s*\([^)]*\))?$/);
  if (!match || !number(match[1])) return null;
  const unit = match[2] || legacyUnit;
  const factor = /^(cm|centimet)/.test(unit) ? 1 : unit === "mm" ? 0.1 : /^(m|meters?|metres?)$/.test(unit) ? 100 : 2.54;
  return { value: +match[1] * factor, unit: "cm" };
}
export function canonicalWeight(value, legacyUnit = "lb") {
  if (value && typeof value === "object") return canonicalWeight(`${value.value ?? value.amount ?? ""} ${value.unit || legacyUnit}`, legacyUnit);
  const match = String(value ?? "").trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(kg|kilograms?|g|grams?|lb|lbs|pounds?)?(?:\s*\([^)]*\))?$/);
  if (!match || !number(match[1])) return null;
  const unit = match[2] || legacyUnit;
  return { value: +match[1] * (/^(kg|kilo)/.test(unit) ? 1 : /^(g|gram)/.test(unit) ? 0.001 : 0.45359237), unit: "kg" };
}
export function parseHomesteadHeightInches(value) {
  const bare = typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value ?? "").trim());
  const result = canonicalLength(value, bare && +value > 100 ? "cm" : "in");
  return result ? result.value / 2.54 : null;
}
export const parseHomesteadWeightLbs = (value) => { const c = canonicalWeight(value); return c ? c.value / 0.45359237 : null; };
const rounded = (n, digits = 1) => String(Number(n.toFixed(digits)));
export function formatHomesteadHeight(value, setup = {}, fallback = "—") {
  const inches = parseHomesteadHeightInches(value);
  if (!inches) return fallback;
  const format = getHomesteadHeightFormat(setup);
  if (format === "CM") return `${rounded(inches * 2.54)} cm`;
  if (format === "INCHES") return `${rounded(inches)}\"`;
  const whole = Math.round(inches);
  return `${Math.floor(whole / 12)}'-${whole % 12}\"`;
}
export function formatHomesteadWeight(value, setup = {}, fallback = "—") {
  const canonical = canonicalWeight(value);
  if (!canonical) return fallback;
  return getHomesteadWeightFormat(setup) === "KG" ? `${rounded(canonical.value)} kg` : `${rounded(canonical.value / 0.45359237)} lbs`;
}
export function formatHomesteadMeasurement(value, setup = {}, fallback = "—", legacyUnit = "in") {
  const canonical = canonicalLength(value, legacyUnit);
  if (!canonical) return fallback;
  return getDisplayPreferences(setup).measurementFormat === "CM" ? `${rounded(canonical.value)} cm` : `${rounded(canonical.value / 2.54)} in`;
}
export function formatHomesteadMeasurements(value, setup = {}, fallback = "—") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (!["bust", "waist", "hips"].some((key) => canonicalLength(value[key], value.unit || "in"))) return fallback;
    return ["bust", "waist", "hips"].map((key) => formatHomesteadMeasurement(value[key], setup, "—", value.unit || "in")).join(" / ");
  }
  const raw = String(value ?? "").trim();
  const individual = raw.split(/\s*\/\s*/);
  if (individual.length === 3 && individual.every((part) => canonicalLength(part))) return individual.map((part) => formatHomesteadMeasurement(part, setup)).join(" / ");
  const match = raw.match(/^(\d+(?:\.\d+)?)[-–/\s]+(\d+(?:\.\d+)?)[-–/\s]+(\d+(?:\.\d+)?)(?:\s*(cm|in|inches|"))?$/i);
  return match ? match.slice(1, 4).map((n) => formatHomesteadMeasurement(`${n} ${match[4] || "in"}`, setup)).join(" / ") : fallback;
}
export function normalizeDisplayInput(field, text, original = "", setup = {}) {
  const raw = String(text ?? "").trim(), preferences = getDisplayPreferences(setup);
  if (!raw) return { value: "", valid: true };
  const key = String(field || "").toLowerCase();
  if (/^(birthday|birthdate|dob|deathdate|adoptiondate|purchasedate|releasedate|date)$/.test(key)) {
    const parts = parseHomesteadDateParts(raw);
    if (parts) return { value: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`, valid: true };
    // A short date display hides the year; retain a known original year when editing it.
    const prior = parseHomesteadDateParts(original);
    const short = prior ? parseHomesteadDateParts(`${raw}, ${prior.year}`) : null;
    return short ? { value: `${short.year}-${pad(short.month)}-${pad(short.day)}`, valid: true } : { value: raw, valid: false };
  }
  if (key === "height") {
    const length = canonicalLength(raw, preferences.heightFormat === "CM" ? "cm" : "in");
    return length ? { value: `${rounded(length.value, 4)} cm`, valid: true } : { value: raw, valid: false };
  }
  if (key === "weight") {
    const mass = canonicalWeight(raw, preferences.weightFormat === "KG" ? "kg" : "lb");
    return mass ? { value: `${rounded(mass.value, 5)} kg`, valid: true } : { value: raw, valid: false };
  }
  if (["bust", "waist", "hips", "chest", "inseam", "length", "width", "depth"].includes(key)) {
    const length = canonicalLength(raw, preferences.measurementFormat === "CM" ? "cm" : "in");
    return length ? { value: `${rounded(length.value, 4)} cm`, valid: true } : { value: raw, valid: false };
  }
  if (["measurements", "measurementsraw"].includes(key)) {
    const parts = raw.split(/\s*[/-]\s*/);
    const lastUnit = raw.match(/\b(cm|in|inches)\s*$/i)?.[1] || (preferences.measurementFormat === "CM" ? "cm" : "in");
    const values = parts.map((part) => canonicalLength(part, lastUnit));
    return values.length === 3 && values.every(Boolean) ? { value: `${values.map((part) => rounded(part.value, 4)).join("-")} cm`, valid: true } : { value: raw, valid: false };
  }
  return { value: raw, valid: true };
}
export function formatHomesteadField(key, value, setup = {}, fallback = "—") {
  const field = String(key || "").replace(/[^a-z]/gi, "").toLowerCase();
  if (/^(birthday|birthdate|dateofbirth|dob|deathdate|dateofdeath|adoptiondate|purchasedate|purchdate|acquireddate|acquiredat|releasedate|releaseDate|airdate|firstairdate|lastairdate|date|effectivedate|effectiveat|warrantyexpiry|warrantyexpires|warrantyend|expirationdate|expirydate|expiresat|startdate|enddate|duedate|eventdate)$/.test(field)) return formatHomesteadDate(value, setup, fallback);
  if (/^(recordedat|createdat|updatedat|modifiedat|completedat|requestedat|lastscan|lastscannedat|timestamp)$/.test(field)) return formatHomesteadDateTime(value, setup, fallback);
  if (/^height(?:cm|in|inches)?$/.test(field)) return formatHomesteadHeight(field === "heightcm" && value !== "" ? { value, unit: "cm" } : value, setup, fallback);
  if (/^weight(?:kg|lb|lbs)?$/.test(field)) return formatHomesteadWeight(field === "weightkg" && value !== "" ? { value, unit: "kg" } : value, setup, fallback);
  if (/^(bust|waist|hips|inseam|neck|chest|length|width|depth)(cm|in)?$/.test(field)) return formatHomesteadMeasurement(value, setup, fallback, field.endsWith("cm") ? "cm" : "in");
  if (/^measurements(?:raw)?$/.test(field)) return formatHomesteadMeasurements(value, setup, fallback);
  if (Array.isArray(value)) return value.map((entry) => typeof entry === "object" ? entry.name || entry.label || "" : String(entry)).filter(Boolean).join(", ") || fallback;
  if (value && typeof value === "object") return value.label || value.name || JSON.stringify(value);
  return value === undefined || value === null || value === "" ? fallback : String(value);
}
