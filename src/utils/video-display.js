// Non-destructive filename interpretation. This never renames files or changes IDs.
const EXTENSION = /\.(?:mp4|mkv|avi|mov|m4v|webm|wmv|flv|ts)$/i;
const QUALITY = /\b(?:2160p|1080p|1080i|720p|480p|360p|4k|8k|uhd|fhd|hdtv|web[- .]?dl|webrip|bluray|blu[- .]?ray|x26[45]|h[. ]?26[45]|hevc|av1|aac(?:2[. ]0)?|ac3|ddp[25][. ]?[01]|hdr10?|sdr|[0-9]{2,3}fps)\b/gi;
function clean(value) { return String(value || "").replace(/[._]+/g, " ").replace(/\s*-{2,}\s*/g, " — ").replace(/\s+/g, " ").replace(/^[\s—-]+|[\s—-]+$/g, "").trim(); }
function validDate(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= new Date().getUTCFullYear() + 1 && d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
}
export function parseVideoDisplay(video = {}) {
  const filename = String(video.name || video.filename || video.sourcePath || video.path || "").split(/[\\/]/).pop() || "";
  const stem = filename.replace(EXTENSION, "");
  const metadata = video.metadata || {};
  let title = stem;
  const sourceLabel = (value) => typeof value === "string" ? value : typeof value?.name === "string" ? value.name : "";
  let source = [video.studio, video.source, metadata.studio, metadata.source].map(sourceLabel).find(Boolean)?.trim() || "";
  const taggedSource = title.match(/\[(?:studio|source)\s*:\s*([^\]]+)\]/i);
  if (taggedSource) { if (!source) source = clean(taggedSource[1]); title = title.replace(taggedSource[0], " "); }
  let date = String(video.date || video.releaseDate || metadata.releaseDate || metadata.date || "").trim();
  const quality = [...new Set(stem.match(QUALITY) || [])];
  const sceneCodes = [];
  // Only remove a date when a complete, valid year-month-day is present.
  const dateMatch = title.match(/(?:^|[\s._-])((?:19|20)\d{2})[._-](\d{2})[._-](\d{2})(?=$|[\s._-])/);
  if (dateMatch && validDate(+dateMatch[1], +dateMatch[2], +dateMatch[3])) {
    if (!date) date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    // A domain or a separated prefix before the date is a source hint. Do not
    // assume the first person's name in every filename is a studio.
    const prefix = title.slice(0, dateMatch.index).replace(/[._\s-]+$/, "");
    if (!source && prefix && /[.](?:com|net|org)$/i.test(prefix)) {
      source = prefix; title = title.slice(dateMatch.index);
    }
    title = title.replace(dateMatch[0].trim(), " ");
  }
  const domain = title.match(/(?:^|\s|[\[(])([a-z0-9-]+\.(?:com|net|org))(?:[\])]|[._\s-]|$)/i);
  if (domain) { if (!source) source = domain[1]; title = title.replace(domain[0], " "); }
  title = title.replace(QUALITY, " ").replace(/\[(?:scene|id|code)[-_ :]*([a-z0-9-]+)\]|\b(?:scene|code|id)[-_ ]+(\d{4,})\b/gi, (whole, a, b) => { sceneCodes.push(a || b); return " "; });
  if (source) {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[ ._-]+");
    title = title.replace(new RegExp(`(?:^${escaped}[ ._-]+|[ ._-]+${escaped}$)`, "i"), " ");
  }
  title = clean(title.replace(/[([]\s*[)\]]/g, " "));
  const supplied = String(video.displayTitle || metadata.displayTitle || video.title || metadata.title || "").trim();
  const meaningful = title.replace(/[^\p{L}\p{N}]/gu, "").length >= 3;
  return { displayTitle: supplied && supplied !== filename && supplied !== stem ? supplied : meaningful ? title : clean(stem) || "Untitled video", source, date, quality, sceneCodes, originalFilename: filename, confidence: meaningful ? "parsed" : "fallback" };
}
