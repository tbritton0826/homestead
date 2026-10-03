// Conditional public-profile enrichment. No login, browser challenge bypass,
// image inference, or bulk crawling. A weak/name-only result contributes nothing.
const clean = (value) => String(value ?? "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []).map((item) => clean(typeof item === "object" ? item.name || item.value || "" : item)).filter(Boolean);
function profileUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && ["models.com", "www.models.com"].includes(url.hostname) && /^\/(?:people|models)\/[^/?#]+\/?$/.test(url.pathname) ? `https://models.com${url.pathname.replace(/\/$/, "")}` : ""; } catch { return ""; }
}
function section(html, heading) {
  const pattern = new RegExp(`<h[1-6]\\b[^>]*>\\s*${heading}\\s*</h[1-6]>([\\s\\S]*?)(?=<h[1-4]\\b|$)`, "i");
  return html.match(pattern)?.[1] || "";
}
function parseModelsProfileHtml(html, url) {
  if (!profileUrl(url) || /cf-chl-|challenge-platform|<title>\s*(?:just a moment|access denied)/i.test(html)) return null;
  const nodes = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const data = JSON.parse(match[1]); nodes.push(...(Array.isArray(data) ? data : data["@graph"] || [data])); } catch {}
  }
  const person = nodes.find((node) => [].concat(node["@type"] || []).includes("Person")) || {};
  const title = clean(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const name = clean(person.name || title.replace(/\s+[-|–]\s+.*$/, ""));
  if (!name || /^(models\.com|not found|page not found|login)$/i.test(name)) return null;
  const canonicalTag = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1];
  const canonical = profileUrl(canonicalTag) || profileUrl(url);
  const textLines = html.replace(/<\/(?:p|div|li|h[1-6]|tr|section)>|<br\s*\/?\s*>/gi, "\n").split("\n").map(clean).filter(Boolean);
  const nationalityLine = textLines.find((line) => /^Nationalit(?:y|ies):/i.test(line)) || "";
  const nationality = list(person.nationality).join(", ") || nationalityLine.replace(/^Nationalit(?:y|ies):\s*/i, "").slice(0, 200);
  const roles = [...new Set([...list(person.jobTitle || person.hasOccupation), ...clean(section(html, "Role")).replace(/Other:/i, ",").split(",").map((value) => value.trim()).filter(Boolean)])].filter((role) => role.length < 90);
  const fields = {};
  const measurementMap = { hair: "hairColor", eyes: "eyeColor", height: "height", bust: "bust", chest: "bust", waist: "waist", hips: "hips", shoe: "shoeSize" };
  function addField(label, value) {
    const normalized = key(label), target = Object.keys(measurementMap).find((field) => normalized === field || normalized.startsWith(`${field} `));
    if (!target || !clean(value)) return;
    const name = measurementMap[target];
    const unit = /\bcm\b/i.test(label) ? "cm" : /\b(?:in|inch|inches)\b/i.test(label) ? "in" : "";
    if (["height", "bust", "waist", "hips"].includes(name)) {
      const numeric = Number(clean(value));
      const explicit = /\b(?:cm|in|ft)\b|['"′″]/i.test(clean(value));
      if (!unit && !explicit) return; // unknown units stay unknown
      const result = unit && Number.isFinite(numeric) ? `${numeric} ${unit}` : clean(value);
      if (!fields[name] || unit === "cm") fields[name] = result;
    } else fields[name] = name === "shoeSize" && /\b(?:us|uk|eu)\b/i.test(label) ? `${clean(value)} ${label.match(/\b(?:us|uk|eu)\b/i)[0].toUpperCase()}` : clean(value);
  }
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => clean(cell[1])));
    if (rows.length >= 2) rows[0].forEach((label, index) => addField(label, rows[1][index]));
  }
  for (const property of [].concat(person.additionalProperty || [])) addField(property.name, `${property.value ?? ""} ${property.unitText || ""}`.trim());
  if (person.height?.value && person.height?.unitText) addField("height", `${person.height.value} ${person.height.unitText}`);
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap((match) => {
    try { const link = new URL(match[1], canonical); return /^https?:$/.test(link.protocol) ? [{ name: clean(match[2]), url: link.href }] : []; } catch { return []; }
  });
  const unique = (entries) => [...new Map(entries.filter((entry) => entry.name && entry.name.length < 200).map((entry) => [entry.url, entry])).values()].slice(0, 24);
  const ownHost = (link) => new URL(link.url).hostname.replace(/^www\./, "") === "models.com";
  const agencies = unique(links.filter((link) => ownHost(link) && /\/(?:agency|agencies)\//i.test(link.url)));
  const clients = unique(links.filter((link) => ownHost(link) && /\/(?:client|clients)\//i.test(link.url)));
  const work = unique(links.filter((link) => ownHost(link) && /\/work\//i.test(link.url)));
  const relatedPeople = unique(links.filter((link) => profileUrl(link.url) && profileUrl(link.url) !== canonical && !/^(profile|work|people|clients|featured)$/i.test(link.name)));
  const socials = {};
  for (const entry of [...links, ...[].concat(person.sameAs || []).map((url) => ({ url }))]) {
    try { const host = new URL(entry.url).hostname.replace(/^www\./, ""); if (["instagram.com", "twitter.com", "x.com", "tiktok.com", "facebook.com", "youtube.com"].includes(host) && !/modelsdot|models\.com|\/modelscom(?:\/|$)/i.test(entry.url)) socials[host] = entry.url; } catch {}
  }
  const biography = clean(person.description || section(html, "Biography")).replace(/^Nationalit(?:y|ies):[^.]*?(?=\s{2}|$)/i, "").slice(0, 5000);
  return { name, title: name, url: canonical, sourceUrl: canonical, id: canonical, provider: "models-com", source: "Models.com", nationality, occupations: roles, occupation: roles.join(", "), biography, description: biography, birthday: String(person.birthDate || ""), birthDate: String(person.birthDate || ""), ...fields, agencies, clients, work, relatedPeople, socials, socialLinks: socials, providerLinks: { "models-com": canonical }, externalLinks: { "models-com": canonical }, providerIds: { "models-com": canonical.split("/").pop() }, metadataCapability: "detail", enrichmentOnly: true, fillMissingOnly: true };
}
function strongModelsMatch(candidate, anchor = {}) {
  if (!candidate || !key(candidate.name) || key(candidate.name) !== key(anchor.name || anchor.title)) return false;
  const metadata = anchor.metadata || anchor;
  const birth = String(metadata.birthday || metadata.birthDate || "").slice(0, 10);
  if (birth && candidate.birthDate && birth !== candidate.birthDate.slice(0, 10)) return false;
  const links = Object.values({ ...metadata.providerLinks, ...metadata.externalLinks }).concat(anchor.url || [], metadata.sourceUrl || []);
  if (links.some((url) => profileUrl(url) && profileUrl(url) === profileUrl(candidate.url))) return true;
  if (birth && candidate.birthDate && birth === candidate.birthDate.slice(0, 10)) return true;
  const socials = Object.values(metadata.socials || metadata.socialLinks || {});
  if (socials.some((url) => Object.values(candidate.socials || {}).some((other) => String(url).replace(/\/$/, "").toLowerCase() === String(other).replace(/\/$/, "").toLowerCase()))) return true;
  const nationalities = key(metadata.nationality).split(/\s*,\s*/);
  const sameNationality = Boolean(metadata.nationality && candidate.nationality && nationalities.includes(key(candidate.nationality)));
  const anchorRoles = list(metadata.occupations || metadata.occupation).join(" ").toLowerCase();
  const sameRole = candidate.occupations.some((role) => /^(model|actor|actress|singer|musician|photographer|designer|athlete)$/i.test(role) && anchorRoles.includes(role.toLowerCase()));
  return key(candidate.name).split(" ").length >= 2 && sameNationality && sameRole;
}
function createModelsLookup({ fetchImpl = fetch, timeoutMs = 6000, now = () => Date.now() } = {}) {
  const cache = new Map();
  return async function lookup(query, anchors = []) {
    const anchorLinks = anchors.flatMap((anchor) => Object.values({ ...anchor.providerLinks, ...anchor.externalLinks })).map(profileUrl).filter(Boolean);
    const slug = key(query).replace(/ /g, "-");
    const initial = anchorLinks[0] || `https://models.com/people/${encodeURIComponent(slug)}`;
    let candidate = cache.get(initial);
    if (!candidate || now() - candidate.cachedAt > 86400000) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let url = initial, response;
        for (let redirects = 0; redirects < 4; redirects++) {
          response = await fetchImpl(url, { headers: { Accept: "text/html", "User-Agent": "Homestead/0.6.8 (conditional public person metadata)" }, signal: controller.signal, redirect: "manual" });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          url = profileUrl(new URL(response.headers.get("location"), url).href);
          if (!url) throw new Error("Models.com redirected outside a public person profile");
        }
        if (!response.ok) throw new Error(`Models.com unavailable (HTTP ${response.status})`);
        const html = await response.text();
        if (html.length > 3000000) throw new Error("Models.com profile response is too large");
        const value = parseModelsProfileHtml(html, url);
        if (!value) throw new Error("Models.com did not return a usable public profile");
        candidate = { value, cachedAt: now() }; cache.set(initial, candidate);
        if (cache.size > 200) cache.delete(cache.keys().next().value);
      } finally { clearTimeout(timer); }
    }
    return anchors.some((anchor) => strongModelsMatch(candidate.value, anchor)) ? { ...candidate.value, confidence: 0.9, matchEvidence: "Exact identity plus corroborating profile metadata", fetchStatus: "complete" } : null;
  };
}
module.exports = { parseModelsProfileHtml, strongModelsMatch, createModelsLookup, profileUrl };
