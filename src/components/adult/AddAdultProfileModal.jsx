import DisplayFieldInput from "../DisplayFieldInput.jsx";
import { normalizeDisplayInput, formatHomesteadDate, formatHomesteadField } from "../../utils/display-format.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const PROFILE_TYPES = [
  { id: "personal", icon: "👤", label: "Personal" },
  { id: "performer", icon: "🎭", label: "Performer" },
  { id: "celebrity", icon: "⭐", label: "Celebrity" },
];

const EMPTY_FORM = {
  name: "",
  sortName: "",
  birthday: "",
  birthName: "", birthPlace: "", nationality: "", ethnicity: "", gender: "", sexualOrientation: "", occupation: "", biography: "",
  careerStart: "", careerEnd: "", yearsActive: "", studios: "", awards: "", careerMilestones: "", relationships: "",
  status: "Active",
  relationshipStatus: "",
  aliases: "",
  tags: "",
  notes: "",
  favorite: false,
  hidden: false,
  privateProfile: true,
  height: "",
  weight: "",
  measurements: "",
  bust: "",
  waist: "",
  hips: "",
  braBand: "",
  cupSize: "",
  braSize: "",
  pantySize: "",
  shoeSize: "",
  dressSize: "",
  clothingSize: "",
  hairColor: "",
  eyeColor: "",
  tattoos: "", piercings: "",
  bodySourceName: "Manual entry",
  bodySourceUrl: "",
  officialWebsite: "",
  instagram: "",
  x: "",
  tiktok: "",
  reddit: "",
  bluesky: "",
  youtube: "",
  onlyfans: "",
  otherSocialLinks: "",
  folderPath: "",
};

function metadataText(value) {
  if (Array.isArray(value)) return value.map((entry) => typeof entry === "object" ? entry.description || entry.name || entry.title || entry.label || "" : entry).filter(Boolean).join(", ");
  if (value && typeof value === "object") return value.description || value.name || value.title || value.label || "";
  return String(value || "");
}

function metadataSocials(metadata = {}) {
  const output = {};
  for (const block of [metadata.socials, metadata.socialLinks, metadata.providerLinks, metadata.externalLinks]) {
    if (Array.isArray(block)) for (const entry of block) { const url = String(entry?.url || entry?.href || "").trim(); const type = String(entry?.type || entry?.provider || "").toLowerCase(); if (url && type && !output[type]) output[type] = url; }
    else if (block && typeof block === "object") for (const [type, value] of Object.entries(block)) { const url = String(value?.url || value || "").trim(); if (url && /^https?:\/\//i.test(url) && !output[String(type).toLowerCase()]) output[String(type).toLowerCase()] = url; }
  }
  if (!output.x && output.twitter) output.x = output.twitter; return output;
}

function slugify(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "profile";
}

function mediaKind(file) {
  return String(file?.type || "").startsWith("video/") ? "video" : "image";
}

function normalizeCandidateMediaUrl(value = "", kind = "image") {
  const raw = String(value?.url || value?.src || value?.image || value?.previewUrl || value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") && /(?:profile|poster|backdrop)_path/i.test(String(value?.type || ""))) {
    return `https://image.tmdb.org/t/p/original${raw}`;
  }
  if (raw.startsWith("/") && kind === "image") return `https://image.tmdb.org/t/p/original${raw}`;
  return /^https?:\/\//i.test(raw) ? raw : "";
}

function candidateMediaEntries(candidate = {}) {
  const output = [];
  const seen = new Set();
  const add = (value, options = {}) => {
    if (value?.minorBlocked === true || value?.ageStatus === "blocked-minor") return;
    const kind = options.kind || value?.kind || value?.mediaType || "image";
    const url = normalizeCandidateMediaUrl(value, kind);
    if (!url || seen.has(url.toLowerCase())) return;
    seen.add(url.toLowerCase());
    output.push({
      id: `candidate-${output.length}-${url}`,
      source: "url",
      sourceName: options.sourceName || value?.source || candidate.sourceName || candidate.source || candidate.provider || "Matched source",
      url,
      previewUrl: value?.previewUrl || url,
      name: options.name || value?.title || value?.name || value?.label || `${kind === "video" ? "Video" : "Artwork"} option ${output.length + 1}`,
      kind: /video|trailer/i.test(String(kind)) ? "video" : "image",
      roles: {},
      selected: value?.selected !== undefined ? value.selected !== false : !(value?.requiresAgeReview || value?.requiresReview),
      destination: /video|trailer/i.test(String(kind)) ? "videos" : "photos",
      ageStatus: value?.ageStatus || "",
      requiresAgeReview: value?.requiresAgeReview === true,
      reviewReason: value?.reviewReason || "",
      sourcePageUrl: value?.sourcePageUrl || value?.sourceUrl || "",
    });
  };
  const primaryArtwork = candidate.imageUrl || candidate.profileImage || candidate.image || candidate.poster || candidate.thumbnail;
  add(primaryArtwork && candidate.mediaReviewRequired ? { url: primaryArtwork, requiresAgeReview: true, selected: false, reviewReason: "This source does not establish when the photo was taken." } : primaryArtwork, { name: "Primary profile artwork" });
  add(candidate.profilePath || candidate.profile_path, { name: "TMDB headshot" });
  add(candidate.banner || candidate.bannerUrl || candidate.backdropPath || candidate.backdrop_path, { name: "Banner option" });
  for (const collection of [candidate.images, candidate.posters, candidate.photos, candidate.artwork, candidate.mediaCandidates]) {
    if (Array.isArray(collection)) collection.forEach((value) => add(value));
  }
  for (const collection of [candidate.trailers, candidate.videos]) {
    if (Array.isArray(collection)) collection.forEach((value) => add(value, { kind: "video" }));
  }
  add(candidate.trailerUrl || candidate.trailer, { kind: "video", name: "Trailer option" });
  return output.slice(0, 36);
}

function normalizeProfileIdentity(value = "") {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export default function AddAdultProfileModal({ open, defaultType = "", initialMedia = [], initialSourceName = "", initialSourceUrl = "", initialCandidate = null, existingProfiles = [], onOpenExisting, onClose, onSubmit }) {
  const [profileType, setProfileType] = useState(defaultType || "personal");
  const [tab, setTab] = useState("general");
  const [form, setForm] = useState(EMPTY_FORM);
  const [manualFields, setManualFields] = useState([]);
  const [media, setMedia] = useState([]);
  const mediaRef = useRef([]);
  const [previewMediaId, setPreviewMediaId] = useState("");
  const [previewLoadFailed, setPreviewLoadFailed] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [metadataQuery, setMetadataQuery] = useState("");
  const [metadataCandidates, setMetadataCandidates] = useState([]);
  const [selectedMetadataCandidate, setSelectedMetadataCandidate] = useState(null);
  const [aggregatedMetadata, setAggregatedMetadata] = useState({});
  const [metadataReview, setMetadataReview] = useState(null);
  const [metadataStatus, setMetadataStatus] = useState("");
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const initialCandidateFetchRef = useRef("");

  useEffect(() => {
    if (!open) return;
    setProfileType(defaultType || "personal");
    setTab((defaultType || "personal") === "personal" || initialCandidate ? "general" : "search");
    setForm({
      ...EMPTY_FORM,
      name: initialCandidate?.name || initialCandidate?.title || "",
      birthday: initialCandidate?.birthday || initialCandidate?.birthDate || "",
      birthPlace: initialCandidate?.birthPlace || initialCandidate?.birthplace || initialCandidate?.placeOfBirth || "",
      nationality: metadataText(initialCandidate?.nationality),
      ethnicity: metadataText(initialCandidate?.ethnicity),
      gender: metadataText(initialCandidate?.gender),
      biography: initialCandidate?.biography || initialCandidate?.bio || initialCandidate?.description || "",
      aliases: metadataText(initialCandidate?.aliases || initialCandidate?.alsoKnownAs),
      height: initialCandidate?.height || (initialCandidate?.heightCm ? `${initialCandidate.heightCm} cm` : ""),
      weight: initialCandidate?.weight || (initialCandidate?.weightLb ? `${initialCandidate.weightLb} lb` : ""),
      braBand: initialCandidate?.braBand || "",
      cupSize: initialCandidate?.cupSize || "",
      pantySize: initialCandidate?.pantySize || "",
      hairColor: initialCandidate?.hairColor || "",
      eyeColor: initialCandidate?.eyeColor || "",
      bodySourceName: initialSourceName || EMPTY_FORM.bodySourceName,
      bodySourceUrl: initialSourceUrl || initialCandidate?.url || initialCandidate?.sourceUrl || "",
    });
    const suppliedMedia = Array.isArray(initialMedia)
        ? initialMedia.map((item, index) => ({
            id: item.id || `initial-${index}-${Date.now()}`,
            source: item.source || "url",
            kind: item.kind || "image",
            name: item.name || `Imported image ${index + 1}`,
            url: item.url || item.previewUrl || "",
            previewUrl: item.previewUrl || item.url || "",
            destination: item.destination || "photos",
            roles: Array.isArray(item.roles) ? Object.fromEntries(item.roles.map((role) => [role, true])) : (item.roles || {}),
            selected: item.selected !== false,
          }))
        : [];
    const discoveredMedia = candidateMediaEntries(initialCandidate || {});
    const combinedMedia = [...suppliedMedia, ...discoveredMedia].filter((item, index, list) => {
      const key = String(item.url || item.previewUrl || item.id || "").toLowerCase();
      return key && list.findIndex((other) => String(other.url || other.previewUrl || other.id || "").toLowerCase() === key) === index;
    });
    setMedia(combinedMedia);
    setPreviewMediaId("");
    setPreviewLoadFailed(false);
    setUrlDraft("");
    setManualFields([]);
    setUrlLoading(false);
    setAdvancedOpen(false);
    setMetadataQuery(initialCandidate?.name || initialCandidate?.title || "");
    setMetadataCandidates(initialCandidate ? [initialCandidate] : []);
    setSelectedMetadataCandidate(initialCandidate || null);
    setAggregatedMetadata(initialCandidate?.metadata || {});
    setMetadataReview(null);
    setMetadataStatus("");
    setMetadataLoading(false);
    setSaving(false);
    setError("");
    initialCandidateFetchRef.current = "";
  }, [open, defaultType, initialSourceName, initialSourceUrl, initialCandidate]);

  useEffect(() => {
    if (!open || !initialCandidate || (defaultType || "personal") === "personal") return;
    const key = `${defaultType || initialCandidate.profileType || initialCandidate.library || "performer"}:${initialCandidate.id || initialCandidate.sourceCandidateId || initialCandidate.url || initialCandidate.name || initialCandidate.title}`;
    if (!key || initialCandidateFetchRef.current === key) return;
    initialCandidateFetchRef.current = key;
    selectAndAggregateMetadata(initialCandidate, {
      profileType: defaultType || initialCandidate.profileType || (initialCandidate.library === "celebrities" ? "celebrity" : "performer"),
      query: initialCandidate.name || initialCandidate.title || "",
    });
  }, [open, initialCandidate, defaultType]);

  useEffect(() => { mediaRef.current = media; }, [media]);
  useEffect(() => { setPreviewLoadFailed(false); }, [previewMediaId]);
  useEffect(() => () => {
    mediaRef.current.forEach((item) => item.previewUrl?.startsWith("blob:") && URL.revokeObjectURL(item.previewUrl));
  }, []);

  useEffect(() => {
    if (!open || !previewMediaId) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") setPreviewMediaId("");
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const images = mediaRef.current.filter((item) => item.kind === "image");
        const index = images.findIndex((item) => item.id === previewMediaId);
        if (index < 0 || images.length < 2) return;
        const offset = event.key === "ArrowLeft" ? -1 : 1;
        setPreviewMediaId(images[(index + offset + images.length) % images.length].id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, previewMediaId]);

  const libraryType = profileType === "celebrity" ? "celebrities" : profileType === "performer" ? "performers" : "personal";
  const suggestedFolder = `/media/${libraryType}/${slugify(form.name)}`;
  const effectiveFolder = form.folderPath || suggestedFolder;
  const artwork = useMemo(() => ({
    poster: media.find((item) => item.selected !== false && item.roles?.poster),
    banner: media.find((item) => item.selected !== false && item.roles?.banner),
    headshot: media.find((item) => item.selected !== false && item.roles?.headshot),
    trailer: media.find((item) => item.selected !== false && item.roles?.trailer),
  }), [media]);
  const selectedMedia = useMemo(() => media.filter((item) => item.selected !== false), [media]);
  const previewImages = useMemo(() => media.filter((item) => item.kind === "image"), [media]);
  const previewIndex = previewImages.findIndex((item) => item.id === previewMediaId);
  const previewMedia = previewIndex >= 0 ? previewImages[previewIndex] : null;
  const duplicateProfile = useMemo(() => {
    const wantedLibrary = profileType === "celebrity" ? "celebrities" : profileType === "performer" ? "performers" : "personal";
    const names = [form.name, ...(Array.isArray(initialCandidate?.aliases) ? initialCandidate.aliases : [])].map(normalizeProfileIdentity).filter(Boolean);
    return (Array.isArray(existingProfiles) ? existingProfiles : []).find((profile) => {
      const profileLibrary = profile.library || profile.libraryType || (profile.profileType === "celebrity" ? "celebrities" : profile.profileType === "performer" ? "performers" : "personal");
      if (profileLibrary !== wantedLibrary) return false;
      const profileNames = [profile.name, profile.title, profile.metadata?.name, ...(profile.metadata?.aliases || [])].map(normalizeProfileIdentity).filter(Boolean);
      return names.some((name) => profileNames.includes(name));
    }) || null;
  }, [existingProfiles, form.name, initialCandidate, profileType]);

  if (!open) return null;

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setManualFields((current) => [...new Set([...current, field])]);
  }

  function addDeviceFiles(files) {
    const entries = Array.from(files || []).map((file, index) => ({
      id: `device-${Date.now()}-${index}-${file.name}`,
      source: "device",
      file,
      name: file.name,
      kind: mediaKind(file),
      previewUrl: URL.createObjectURL(file),
      roles: {},
      selected: true,
      destination: mediaKind(file) === "video" ? "videos" : "photos",
    }));
    setMedia((current) => [...current, ...entries]);
  }

  async function addUrls() {
    const urls = Array.from(new Set(
      String(urlDraft || "")
        .split(/[\n,]+/)
        .map((value) => value.trim())
        .filter(Boolean)
    ));
    const invalid = urls.filter((url) => !/^https?:\/\//i.test(url));
    if (!urls.length || invalid.length) {
      setError(invalid.length ? `Invalid URL: ${invalid[0]}` : "Enter at least one valid http(s) media URL.");
      return;
    }
    setUrlLoading(true);
    setError("");
    const discoveredAll = [];
    const failures = [];
    try {
      for (const url of urls) {
        try {
          const response = await fetch("/api/adult/import-preview-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.ok === false) throw new Error(data.error || data.message || "Unable to inspect that URL.");
          const discovered = Array.isArray(data.media) ? data.media : [];
          if (!discovered.length) throw new Error("No downloadable photos or videos were found.");
          discoveredAll.push(...discovered.map((item) => ({ ...item, sourcePageUrl: url })));
        } catch (urlError) {
          failures.push(`${url}: ${urlError?.message || "Unable to inspect URL"}`);
        }
      }
      setMedia((current) => {
        const existing = new Set(current.map((item) => String(item.url || item.previewUrl || "").toLowerCase()));
        const additions = discoveredAll
          .filter((item) => item?.url && !existing.has(String(item.url).toLowerCase()))
          .map((item, index) => ({
            id: `url-${Date.now()}-${index}`,
            source: "url",
            url: item.url,
            sourcePageUrl: item.sourcePageUrl,
            name: item.name || item.url.split("/").pop()?.split("?")[0] || `Imported media ${index + 1}`,
            kind: item.kind === "video" ? "video" : "image",
            previewUrl: item.previewUrl || item.url,
            roles: {},
            selected: true,
            destination: item.kind === "video" ? "videos" : "photos",
          }));
        return [...current, ...additions];
      });
      if (failures.length) setError(`Added available media. ${failures.length} URL${failures.length === 1 ? "" : "s"} could not be read.`);
      if (discoveredAll.length) setUrlDraft("");
      else throw new Error(failures[0] || "No downloadable media was found.");
    } catch (urlError) {
      setError(urlError?.message || "Unable to import media from those URLs.");
    } finally {
      setUrlLoading(false);
    }
  }

  function setMediaDestination(itemId, destination) {
    if (!['photos', 'nudes'].includes(destination)) return;
    setMedia((current) => current.map((item) => item.id === itemId && item.kind === "image"
      ? { ...item, destination, selected: true }
      : item));
  }

  function toggleRole(itemId, role) {
    setMedia((current) => current.map((item) => {
      if (item.id === itemId) return { ...item, selected: true, roles: { ...item.roles, [role]: !item.roles?.[role] } };
      if (["poster", "banner", "headshot", "trailer"].includes(role) && item.roles?.[role]) {
        return { ...item, roles: { ...item.roles, [role]: false } };
      }
      return item;
    }));
  }

  function toggleMediaSelected(itemId) {
    setMedia((current) => current.map((item) => item.id === itemId
      ? { ...item, selected: item.selected === false, roles: item.selected === false ? item.roles : {} }
      : item));
  }

  function removeMedia(itemId) {
    setMedia((current) => {
      const removed = current.find((item) => item.id === itemId);
      if (removed?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.id !== itemId);
    });
  }

  function moveMediaPreview(offset) {
    if (!previewImages.length) return;
    const currentIndex = previewIndex >= 0 ? previewIndex : 0;
    setPreviewMediaId(previewImages[(currentIndex + offset + previewImages.length) % previewImages.length].id);
  }

  async function searchMetadataCandidates() {
    const query = String(metadataQuery || form.name || "").trim();
    if (!query) {
      setError("Enter a profile name before searching metadata.");
      return;
    }
    setMetadataLoading(true);
    setMetadataStatus("Searching enabled metadata sources…");
    setError("");
    try {
      const response = await fetch(`/api/metadata/adult/person/search?q=${encodeURIComponent(query)}&profileType=${encodeURIComponent(profileType)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.message || "Metadata search failed.");
      const results = Array.isArray(data.candidates) ? data.candidates : Array.isArray(data.results) ? data.results : [];
      setMetadataCandidates(results);
      setSelectedMetadataCandidate(null);
      setMetadataReview(null);
      setMetadataStatus(results.length ? `${results.length} candidate${results.length === 1 ? "" : "s"} found. Choose the correct identity to combine all enabled sources.` : "No matching metadata candidates were found.");
    } catch (searchError) {
      setMetadataCandidates([]);
      setMetadataStatus(searchError.message || "Metadata search failed.");
    } finally {
      setMetadataLoading(false);
    }
  }

  async function selectAndAggregateMetadata(candidate, overrides = {}) {
    const sourceCandidate = candidate?.sourceCandidates?.find((entry) => entry?.externalOnly !== true && entry?.metadataCapability !== "search-only") || candidate?.sourceCandidates?.[0] || candidate;
    const effectiveProfileType = overrides.profileType || profileType;
    const effectiveLibraryType = effectiveProfileType === "celebrity" ? "celebrities" : effectiveProfileType === "performer" ? "performers" : "personal";
    const effectiveQuery = overrides.query || form.name || metadataQuery || candidate.name || candidate.title;
    setSelectedMetadataCandidate(candidate);
    setMetadataLoading(true);
    setMetadataStatus("Combining metadata from all enabled sources…");
    try {
      const response = await fetch("/api/metadata/adult/person/full-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: effectiveQuery,
          profileType: effectiveProfileType,
          libraryType: effectiveLibraryType,
          person: { name: effectiveQuery, profileType: effectiveProfileType, library: effectiveLibraryType, metadata: {} },
          candidate: sourceCandidate,
          identityAnchor: sourceCandidate,
          saveToProfile: false,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.message || "Full metadata fetch failed.");
      const imported = data.metadata || data.aggregation?.metadata || {};
      const importedBody = imported.body || imported.bodyDetails || {};
      const importedSocials = metadataSocials(imported);
      setAggregatedMetadata(imported);
      setMetadataReview(data);
      const discoveredMedia = candidateMediaEntries({
        ...candidate,
        ...(data.best || {}),
        mediaCandidates: data.mediaCandidates || [],
        images: [
          ...(Array.isArray(candidate.images) ? candidate.images : []),
          ...(Array.isArray(imported.images) ? imported.images : []),
          ...(Array.isArray(imported.photos) ? imported.photos : []),
          ...(Array.isArray(imported.artwork) ? imported.artwork : []),
        ],
        videos: [
          ...(Array.isArray(candidate.videos) ? candidate.videos : []),
          ...(Array.isArray(imported.videos) ? imported.videos : []),
          ...(Array.isArray(imported.trailers) ? imported.trailers : []),
        ],
      });
      setMedia((current) => [...current, ...discoveredMedia].filter((item, index, list) => {
        const key = String(item.url || item.previewUrl || item.id || "").toLowerCase();
        return key && list.findIndex((other) => String(other.url || other.previewUrl || other.id || "").toLowerCase() === key) === index;
      }));
      setForm((current) => ({
        ...current,
        name: current.name || imported.name || candidate.name || candidate.title || "",
        birthday: current.birthday || imported.birthday || imported.birthDate || "",
        birthName: current.birthName || imported.birthName || imported.realName || "", birthPlace: current.birthPlace || imported.birthPlace || imported.placeOfBirth || "",
        nationality: current.nationality || imported.nationality || imported.countryOfCitizenship || "", ethnicity: current.ethnicity || imported.ethnicity || "", gender: current.gender || imported.gender || imported.sexOrGender || "", sexualOrientation: current.sexualOrientation || imported.sexualOrientation || imported.orientation || "",
        occupation: current.occupation || metadataText(imported.occupation || imported.occupations), biography: current.biography || imported.biography || imported.description || "",
        careerStart: current.careerStart || imported.careerStart || imported.debut || "", careerEnd: current.careerEnd || imported.careerEnd || "", yearsActive: current.yearsActive || imported.yearsActive || "", studios: current.studios || metadataText(imported.studios), awards: current.awards || metadataText(imported.awards), careerMilestones: current.careerMilestones || metadataText(imported.careerMilestones), relationships: current.relationships || metadataText(imported.relationships),
        aliases: current.aliases || metadataText(imported.aliases || imported.alsoKnownAs),
        height: current.height || imported.height || importedBody.height || "", weight: current.weight || imported.weight || importedBody.weight || "", measurements: current.measurements || imported.measurements || imported.measurementsRaw || importedBody.measurementsRaw || importedBody.measurements || "",
        bust: current.bust || imported.bust || importedBody.bust || "", waist: current.waist || imported.waist || importedBody.waist || "", hips: current.hips || imported.hips || importedBody.hips || "",
        braSize: current.braSize || imported.braSize || importedBody.braSize || "", braBand: current.braBand || imported.braBand || importedBody.braBand || "", cupSize: current.cupSize || imported.cupSize || importedBody.cupSize || "",
        pantySize: current.pantySize || imported.pantySize || importedBody.pantySize || "", shoeSize: current.shoeSize || imported.shoeSize || importedBody.shoeSize || "", dressSize: current.dressSize || imported.dressSize || importedBody.dressSize || "", clothingSize: current.clothingSize || imported.clothingSize || importedBody.clothingSize || "",
        hairColor: current.hairColor || imported.hairColor || importedBody.hairColor || "", eyeColor: current.eyeColor || imported.eyeColor || importedBody.eyeColor || "", tattoos: current.tattoos || metadataText(imported.tattoos || importedBody.tattoos), piercings: current.piercings || metadataText(imported.piercings || importedBody.piercings),
        officialWebsite: current.officialWebsite || imported.officialWebsite || "",
        instagram: current.instagram || importedSocials.instagram || "", x: current.x || importedSocials.x || "", tiktok: current.tiktok || importedSocials.tiktok || "", reddit: current.reddit || importedSocials.reddit || "", bluesky: current.bluesky || importedSocials.bluesky || "", youtube: current.youtube || importedSocials.youtube || "", onlyfans: current.onlyfans || importedSocials.onlyfans || "",
        bodySourceName: imported.metadataAggregation?.bestSource?.source || sourceCandidate.source || sourceCandidate.provider || current.bodySourceName,
        bodySourceUrl: imported.metadataAggregation?.bestSource?.url || sourceCandidate.url || sourceCandidate.sourceUrl || current.bodySourceUrl,
      }));
      const contributingSources = data.coverage?.sources || 0; const availableSources = data.coverage?.availableSources || data.sourceSummary?.length || contributingSources;
      setMetadataStatus(`Combined ${data.coverage?.filledFields || Object.keys(imported).length} profile fields from ${contributingSources} contributing source${contributingSources === 1 ? "" : "s"}. ${availableSources - contributingSources > 0 ? `${availableSources - contributingSources} additional source${availableSources - contributingSources === 1 ? " is" : "s are"} browse/identity-only.` : ""}`.trim());
    } catch (fetchError) {
      setMetadataStatus(fetchError.message || "Full metadata fetch failed.");
    } finally {
      setMetadataLoading(false);
    }
  }

  async function createProfile() {
    const invalid = ["birthday", "height", "weight", "measurements", "bust", "waist", "hips"].find((field) => !normalizeDisplayInput(field, form[field], form[field]).valid);
    if (invalid) { setError(`Please correct ${invalid} before creating this profile.`); setTab(invalid === "birthday" ? "general" : "sizes"); return; }
    if (!form.name.trim()) {
      setError("Display name is required.");
      setTab("general");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const socialLinks = [
        ["official", "Official website", form.officialWebsite],
        ["instagram", "Instagram", form.instagram],
        ["x", "X", form.x],
        ["tiktok", "TikTok", form.tiktok],
        ["reddit", "Reddit", form.reddit],
        ["bluesky", "Bluesky", form.bluesky],
        ["youtube", "YouTube", form.youtube],
        ["onlyfans", "OnlyFans", form.onlyfans],
      ].filter(([, , url]) => String(url || "").trim()).map(([type, label, url]) => ({ type, label, url: String(url).trim() }));
      String(form.otherSocialLinks || "").split(/[\n,]+/).map((url) => url.trim()).filter(Boolean).forEach((url) => socialLinks.push({ type: "other", label: "Other", url }));
      const manualMetadata = {
        birthday: form.birthday,
        birthName: form.birthName, birthPlace: form.birthPlace, placeOfBirth: form.birthPlace, nationality: form.nationality, ethnicity: form.ethnicity, gender: form.gender, sexualOrientation: form.sexualOrientation, occupation: form.occupation, biography: form.biography, description: form.biography,
        careerStart: form.careerStart, careerEnd: form.careerEnd, yearsActive: form.yearsActive,
        studios: form.studios.split(/[,\n]+/).map((value) => value.trim()).filter(Boolean), awards: form.awards.split(/[,\n]+/).map((value) => value.trim()).filter(Boolean), careerMilestones: form.careerMilestones.split(/[,\n]+/).map((value) => value.trim()).filter(Boolean), relationships: form.relationships.split(/[,\n]+/).map((value) => value.trim()).filter(Boolean),
        aliases: form.aliases.split(",").map((value) => value.trim()).filter(Boolean),
        height: form.height,
        weight: form.weight,
        measurements: form.measurements,
        measurementsRaw: form.measurements,
        bust: form.bust,
        waist: form.waist,
        hips: form.hips,
        braSize: form.braSize,
        braBand: form.braBand,
        cupSize: form.cupSize,
        pantySize: form.pantySize,
        shoeSize: form.shoeSize,
        dressSize: form.dressSize,
        clothingSize: form.clothingSize,
        hairColor: form.hairColor,
        eyeColor: form.eyeColor,
        tattoos: form.tattoos.split(/[,\n]+/).map((value) => value.trim()).filter(Boolean), piercings: form.piercings.split(/[,\n]+/).map((value) => value.trim()).filter(Boolean),
        officialWebsite: form.officialWebsite,
        socialLinks,
      };
      const enteredMetadata = Object.fromEntries(Object.entries(manualMetadata).filter(([, value]) => Array.isArray(value) ? value.length : String(value || "").trim()));
      const enteredBody = Object.fromEntries(Object.entries({
        height: form.height, weight: form.weight, measurementsRaw: form.measurements,
        bust: form.bust, waist: form.waist, hips: form.hips, braSize: form.braSize,
        braBand: form.braBand, cupSize: form.cupSize,
        pantySize: form.pantySize, shoeSize: form.shoeSize, dressSize: form.dressSize,
        clothingSize: form.clothingSize, hairColor: form.hairColor, eyeColor: form.eyeColor,
        tattoos: form.tattoos.split(/[,\n]+/).map((value) => ({ description: value.trim(), source: form.bodySourceName || "Manual entry", confidence: "manual" })).filter((value) => value.description),
        piercings: form.piercings.split(/[,\n]+/).map((value) => ({ description: value.trim(), source: form.bodySourceName || "Manual entry", confidence: "manual" })).filter((value) => value.description),
      }).filter(([, value]) => String(value || "").trim()));
      await onSubmit?.({
        ...form,
        name: form.name.trim(),
        profileType,
        libraryType,
        // The suggested path is display-only. An empty value lets the server
        // select the configured/mounted root for this Adult sub-library.
        folderPath: form.folderPath.trim(),
        aliases: form.aliases.split(",").map((value) => value.trim()).filter(Boolean),
        tags: form.tags.split(",").map((value) => value.trim()).filter(Boolean),
        candidate: selectedMetadataCandidate,
        mediaQueue: selectedMedia,
        artworkSelections: {
          posterId: artwork.poster?.id || "",
          bannerId: artwork.banner?.id || "",
          headshotId: artwork.headshot?.id || "",
          trailerId: artwork.trailer?.id || "",
        },
        metadata: {
          ...aggregatedMetadata,
          ...enteredMetadata,
          manualMetadataFields: [...new Set([...(Array.isArray(aggregatedMetadata.manualMetadataFields) ? aggregatedMetadata.manualMetadataFields : []), ...manualFields])],
          manualMetadataUpdatedAt: manualFields.length ? new Date().toISOString() : aggregatedMetadata.manualMetadataUpdatedAt,
          metadataMatch: selectedMetadataCandidate ? {
            provider: selectedMetadataCandidate.provider || selectedMetadataCandidate.source || "manual",
            providerId: selectedMetadataCandidate.sourceCandidateId || selectedMetadataCandidate.id || selectedMetadataCandidate.url || "",
            matchedName: selectedMetadataCandidate.name || selectedMetadataCandidate.title || form.name,
            source: selectedMetadataCandidate.source || selectedMetadataCandidate.provider || "",
            url: selectedMetadataCandidate.url || selectedMetadataCandidate.externalUrl || "",
            confidence: selectedMetadataCandidate.confidence || null,
            matchedAt: new Date().toISOString(),
          } : aggregatedMetadata.metadataMatch,
          trailer: artwork.trailer?.url || aggregatedMetadata.trailer || "",
          body: {
            ...(aggregatedMetadata.body || aggregatedMetadata.bodyDetails || {}),
            ...enteredBody,
            sourceName: form.bodySourceName || "Manual entry",
            sourceUrl: form.bodySourceUrl,
            confidence: "manual",
          },
          bodyDetails: {
            ...(aggregatedMetadata.bodyDetails || aggregatedMetadata.body || {}),
            ...enteredBody,
            sourceName: form.bodySourceName || "Manual entry",
            sourceUrl: form.bodySourceUrl,
            confidence: "manual",
          },
        },
        advanced: { createFolder: true, scanAfterCreate: true },
      });
    } catch (submitError) {
      setError(submitError?.message || "Unable to create this profile.");
    } finally {
      setSaving(false);
    }
  }

  const typeLabel = PROFILE_TYPES.find((item) => item.id === profileType)?.label || "Profile";
  const wizardTabs = profileType === "personal"
    ? [["general", "📝", "General"], ["sizes", "🏷️", "Sizes"], ["media", "🖼️", "Media & Folder"], ["summary", "✓", "Summary"]]
    : [["search", "🔎", "Search"], ["general", "📝", "General"], ["sizes", "🏷️", "Sizes"], ["social", "@", "Social (Optional)"], ["media", "🖼️", "Media & Sources"], ["summary", "✓", "Summary"]];
  const activeTabIndex = Math.max(0, wizardTabs.findIndex(([id]) => id === tab));
  const previousTab = wizardTabs[activeTabIndex - 1]?.[0] || "";
  const nextTab = wizardTabs[activeTabIndex + 1]?.[0] || "";

  function chooseProfileType(typeId) {
    setProfileType(typeId);
    setTab(typeId === "personal" ? "general" : "search");
    setSelectedMetadataCandidate(null);
    setAggregatedMetadata({});
    setMetadataReview(null);
    setMetadataCandidates([]);
    setMetadataStatus("");
  }

  return (
    <div className="adult-profile-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose?.()}>
      <section className="adult-profile-modal adult-profile-media-create-modal" role="dialog" aria-modal="true" aria-label={`Add ${typeLabel}`}>
        <header className="adult-profile-modal-heading">
          <div>
            <p>Adult Library</p>
            <h2>{PROFILE_TYPES.find((item) => item.id === profileType)?.icon} Add {typeLabel}</h2>
            <span>{profileType === "personal" ? "Create a private profile manually, then import from this device or link its existing folder." : "Search every enabled person source, verify the result, add media, and create the profile in one guided flow."}</span>
          </div>
          <button className="adult-profile-modal-close" type="button" disabled={saving} onClick={onClose}>×</button>
        </header>

        {!defaultType && (
          <div className="adult-profile-type-picker">
            {PROFILE_TYPES.map((type) => (
              <button key={type.id} type="button" className={profileType === type.id ? "active" : ""} onClick={() => chooseProfileType(type.id)}>
                <span>{type.icon}</span><strong>{type.label}</strong>
              </button>
            ))}
          </div>
        )}

        {defaultType && (
          <div className="adult-profile-context-card"><span>{PROFILE_TYPES.find((item) => item.id === profileType)?.icon}</span><div><strong>{typeLabel}</strong><small>This form was opened from the {typeLabel} library.</small></div></div>
        )}

        <nav className="adult-profile-create-tabs">
          {wizardTabs.map(([id, icon, label], index) => <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}><span>{index + 1}</span> {icon} {label}</button>)}
        </nav>

        <div className="adult-profile-create-scroll">
          {tab === "general" && <div className="adult-profile-form-grid">
            <label><span>Display Name</span><input autoFocus value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Profile name" /></label>
            <label><span>Sort Name</span><input value={form.sortName} onChange={(event) => update("sortName", event.target.value)} placeholder="Optional sorting name" /></label>
            <label><span>Birthday</span><DisplayFieldInput field="birthday" value={form.birthday} onChange={(event) => update("birthday", event.target.value)} placeholder="YYYY-MM-DD or MM/DD/YYYY" /></label>
            <label><span>Birth / Legal Name</span><input value={form.birthName} onChange={(event) => update("birthName", event.target.value)} placeholder="Source-backed legal or birth name" /></label>
            <label><span>Birthplace</span><input value={form.birthPlace} onChange={(event) => update("birthPlace", event.target.value)} placeholder="City, state/country" /></label>
            <label><span>Nationality</span><input value={form.nationality} onChange={(event) => update("nationality", event.target.value)} placeholder="Nationality" /></label>
            <label><span>Ethnicity</span><input value={form.ethnicity} onChange={(event) => update("ethnicity", event.target.value)} placeholder="Source-backed value" /></label>
            <label><span>Gender</span><input value={form.gender} onChange={(event) => update("gender", event.target.value)} placeholder="Optional" /></label>
            <label><span>Sexual Orientation</span><input value={form.sexualOrientation} onChange={(event) => update("sexualOrientation", event.target.value)} placeholder="Optional source-backed value" /></label>
            <label><span>Occupation</span><input value={form.occupation} onChange={(event) => update("occupation", event.target.value)} placeholder="Performer, model, actor…" /></label>
            <label><span>Status</span><select value={form.status} onChange={(event) => update("status", event.target.value)}><option>Active</option><option>Inactive</option><option>Archived</option></select></label>
            <label><span>Relationship Status</span><input value={form.relationshipStatus} onChange={(event) => update("relationshipStatus", event.target.value)} placeholder="Optional" /></label>
            <label><span>Aliases</span><input value={form.aliases} onChange={(event) => update("aliases", event.target.value)} placeholder="Comma-separated names" /></label>
            <label><span>Career Start</span><input value={form.careerStart} onChange={(event) => update("careerStart", event.target.value)} placeholder="Year or date" /></label>
            <label><span>Career End</span><input value={form.careerEnd} onChange={(event) => update("careerEnd", event.target.value)} placeholder="Optional" /></label>
            <label><span>Years Active</span><input value={form.yearsActive} onChange={(event) => update("yearsActive", event.target.value)} placeholder="Example: 2015–2023" /></label>
            <label><span>Studios</span><input value={form.studios} onChange={(event) => update("studios", event.target.value)} placeholder="Comma-separated studios" /></label>
            <label className="wide"><span>Relationships</span><textarea rows={2} value={form.relationships} onChange={(event) => update("relationships", event.target.value)} placeholder="One public/source-backed relationship per line" /></label>
            <label className="wide"><span>Awards</span><textarea rows={2} value={form.awards} onChange={(event) => update("awards", event.target.value)} placeholder="One award per line" /></label>
            <label className="wide"><span>Career Milestones</span><textarea rows={2} value={form.careerMilestones} onChange={(event) => update("careerMilestones", event.target.value)} placeholder="Debuts, retirements, studio changes, and other dated milestones" /></label>
            <label className="wide"><span>Biography</span><textarea rows={5} value={form.biography} onChange={(event) => update("biography", event.target.value)} placeholder="Source-backed biography" /></label>
            <label className="wide"><span>Tags</span><input value={form.tags} onChange={(event) => update("tags", event.target.value)} placeholder="favorite, priority, collection…" /></label>
            <label className="wide"><span>Notes</span><textarea rows={4} value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Optional notes for this profile" /></label>
            <div className="adult-profile-toggle-row wide">
              <label><input type="checkbox" checked={form.favorite} onChange={(event) => update("favorite", event.target.checked)} /> Favorite</label>
              <label><input type="checkbox" checked={form.hidden} onChange={(event) => update("hidden", event.target.checked)} /> Hide from normal views</label>
              <label><input type="checkbox" checked={form.privateProfile} onChange={(event) => update("privateProfile", event.target.checked)} /> Private profile</label>
            </div>
          </div>}

          {tab === "sizes" && <div className="adult-profile-body-fields">
            <div className="adult-profile-body-intro wide">
              <div><strong>Body dimensions</strong><span>Optional profile measurements. These are saved to both the simple metadata fields and the structured body-details record used by the profile page.</span></div>
            </div>
            <div className="adult-profile-form-grid">
              <label><span>Height</span><DisplayFieldInput field="height" value={form.height} onChange={(event) => update("height", event.target.value)} placeholder="5 ft 4 in, 163 cm…" /></label>
              <label><span>Weight</span><DisplayFieldInput field="weight" value={form.weight} onChange={(event) => update("weight", event.target.value)} placeholder="120 lb, 54 kg…" /></label>
              <label><span>Measurements</span><DisplayFieldInput field="measurements" value={form.measurements} onChange={(event) => update("measurements", event.target.value)} placeholder="34-24-35" /></label>
              <label><span>Bra Band</span><input value={form.braBand} onChange={(event) => update("braBand", event.target.value)} placeholder="34" /></label>
              <label><span>Cup Size</span><input value={form.cupSize} onChange={(event) => update("cupSize", event.target.value)} placeholder="C" /></label>
              <label><span>Combined Bra Size</span><input value={form.braSize} onChange={(event) => update("braSize", event.target.value)} placeholder="34C (optional source value)" /></label>
              <label><span>Bust</span><DisplayFieldInput field="bust" value={form.bust} onChange={(event) => update("bust", event.target.value)} placeholder="34 in" /></label>
              <label><span>Waist</span><DisplayFieldInput field="waist" value={form.waist} onChange={(event) => update("waist", event.target.value)} placeholder="24 in" /></label>
              <label><span>Hips</span><DisplayFieldInput field="hips" value={form.hips} onChange={(event) => update("hips", event.target.value)} placeholder="35 in" /></label>
              <label><span>Panty Size</span><input value={form.pantySize} onChange={(event) => update("pantySize", event.target.value)} placeholder="XS, S, 6…" /></label>
              <label><span>Shoe Size</span><input value={form.shoeSize} onChange={(event) => update("shoeSize", event.target.value)} placeholder="US 7" /></label>
              <label><span>Dress Size</span><input value={form.dressSize} onChange={(event) => update("dressSize", event.target.value)} placeholder="US 4" /></label>
              <label><span>Clothing Size</span><input value={form.clothingSize} onChange={(event) => update("clothingSize", event.target.value)} placeholder="XS, S, M…" /></label>
              <label><span>Hair Color</span><input value={form.hairColor} onChange={(event) => update("hairColor", event.target.value)} placeholder="Brown" /></label>
              <label><span>Eye Color</span><input value={form.eyeColor} onChange={(event) => update("eyeColor", event.target.value)} placeholder="Blue" /></label>
              <label className="wide"><span>Tattoos</span><textarea rows={2} value={form.tattoos} onChange={(event) => update("tattoos", event.target.value)} placeholder="One source-backed description per line" /></label>
              <label className="wide"><span>Piercings</span><textarea rows={2} value={form.piercings} onChange={(event) => update("piercings", event.target.value)} placeholder="One source-backed description per line" /></label>
              <label><span>Body Data Source</span><input value={form.bodySourceName} onChange={(event) => update("bodySourceName", event.target.value)} placeholder="Manual entry" /></label>
              <label className="wide"><span>Source URL</span><input value={form.bodySourceUrl} onChange={(event) => update("bodySourceUrl", event.target.value)} placeholder="Optional reference URL" /></label>
            </div>
          </div>}

          {tab === "social" && <div className="adult-profile-body-fields">
            <div className="adult-profile-body-intro wide">
              <div><strong>Official and social links</strong><span>This step is optional. Links are stored with the profile and do not need to be completed before creation.</span></div>
            </div>
            <div className="adult-profile-form-grid">
              <label className="wide"><span>Official Website</span><input value={form.officialWebsite} onChange={(event) => update("officialWebsite", event.target.value)} placeholder="https://official.example" /></label>
              <label><span>Instagram</span><input value={form.instagram} onChange={(event) => update("instagram", event.target.value)} placeholder="https://instagram.com/…" /></label>
              <label><span>X</span><input value={form.x} onChange={(event) => update("x", event.target.value)} placeholder="https://x.com/…" /></label>
              <label><span>TikTok</span><input value={form.tiktok} onChange={(event) => update("tiktok", event.target.value)} placeholder="https://tiktok.com/@…" /></label>
              <label><span>Reddit</span><input value={form.reddit} onChange={(event) => update("reddit", event.target.value)} placeholder="https://reddit.com/…" /></label>
              <label><span>Bluesky</span><input value={form.bluesky} onChange={(event) => update("bluesky", event.target.value)} placeholder="https://bsky.app/…" /></label>
              <label><span>YouTube</span><input value={form.youtube} onChange={(event) => update("youtube", event.target.value)} placeholder="https://youtube.com/…" /></label>
              <label><span>OnlyFans</span><input value={form.onlyfans} onChange={(event) => update("onlyfans", event.target.value)} placeholder="https://onlyfans.com/…" /></label>
              <label className="wide"><span>Other Links</span><textarea rows={4} value={form.otherSocialLinks} onChange={(event) => update("otherSocialLinks", event.target.value)} placeholder="One URL per line" /></label>
            </div>
          </div>}

          {tab === "media" && <div className="adult-profile-media-workflow">
            <div className="adult-profile-media-source-grid">
              <label className="adult-profile-media-dropzone">
                <input type="file" accept="image/*,video/*" multiple onChange={(event) => { addDeviceFiles(event.target.files); event.target.value = ""; }} />
                <span>📱</span><strong>Browse This Device</strong><small>Select photos or videos with the device's native file picker. Multiple files are supported.</small>
              </label>
              <div className="adult-profile-url-import-card">
                <span>🔗</span><strong>Import from URLs</strong><small>Paste one URL per line. Direct media links and supported gallery pages are accepted.</small>
                <div className="adult-profile-url-multi-input"><textarea rows={4} value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} placeholder={"https://example.com/photo-1.jpg\nhttps://example.com/gallery"} /><button type="button" disabled={urlLoading} onClick={addUrls}>{urlLoading ? "Finding…" : "Add URLs"}</button></div>
              </div>
            </div>

            {media.length > 0 ? <>
              <div className="adult-profile-media-help adult-profile-media-bulk-help">
                <div><strong>Photos is the default folder.</strong><span>Use the destination on each image to send only the photos you choose to Nudes. Poster, banner, and headshot selections also create artwork copies in the profile root.</span></div>
              </div>
              <div className="adult-profile-media-grid">
                {media.map((item) => <article key={item.id} className={`adult-profile-media-card ${item.selected === false ? "is-skipped" : ""}`}>
                  {item.kind === "video" ? <video src={item.previewUrl} muted /> : <button type="button" className="adult-profile-media-preview-button" onClick={() => { setPreviewLoadFailed(false); setPreviewMediaId(item.id); }} aria-label={`View ${item.name || "photo"} full size`}><img src={item.previewUrl} alt={item.name} loading="lazy" referrerPolicy="no-referrer" /><span>View full size</span></button>}
                  <div className="adult-profile-media-card-name"><strong>{item.name}</strong><button type="button" onClick={() => removeMedia(item.id)}>×</button></div>
                  {item.requiresAgeReview && <small className="adult-profile-media-age-review">⚠ Age/date uncertain — review the source before approving this photo.</small>}
                  <label className="adult-profile-media-include"><input type="checkbox" checked={item.selected !== false} onChange={() => toggleMediaSelected(item.id)} /> Import this item</label>
                  {item.kind === "image" && <>
                    <div className="adult-profile-artwork-role-row">
                      {[["poster", "Poster"], ["banner", "Banner"], ["headshot", "Headshot"]].map(([role, label]) => <button key={role} type="button" className={item.roles?.[role] ? "active" : ""} onClick={() => toggleRole(item.id, role)}>{label}</button>)}
                    </div>
                    <label className="adult-profile-media-destination">
                      <span>Save this photo in</span>
                      <select value={item.destination === "nudes" ? "nudes" : "photos"} onChange={(event) => setMediaDestination(item.id, event.target.value)}>
                        <option value="photos">Photos</option>
                        <option value="nudes">Nudes</option>
                      </select>
                      {(item.roles?.poster || item.roles?.banner || item.roles?.headshot) && <small>Also copied to the profile root as selected artwork.</small>}
                    </label>
                  </>}
                  {item.kind === "video" && <>
                    <div className="adult-profile-artwork-role-row"><button type="button" className={item.roles?.trailer ? "active" : ""} onClick={() => toggleRole(item.id, "trailer")}>Trailer</button></div>
                    <div className="adult-profile-media-video-destination">{item.roles?.trailer ? "Trailer + Scenes" : "Scenes"}</div>
                  </>}
                </article>)}
              </div>
            </> : <div className="adult-profile-media-empty">No media selected yet.</div>}

            <details className="adult-profile-advanced-paths" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
              <summary>{profileType === "personal" ? "Link an existing folder or choose a destination" : "Profile folder and source options"}</summary>
              <label><span>{profileType === "personal" ? "Existing or new profile folder" : "Profile folder"}</span><input value={form.folderPath} onChange={(event) => update("folderPath", event.target.value)} placeholder={suggestedFolder} /></label>
              <small>{profileType === "personal" ? "Enter an existing folder to link it in place, or a new path for Homestead to create. Existing media is not copied or moved." : "Homestead creates the folder when missing, saves metadata.json, imports selected media, and requests a scanner refresh automatically."}</small>
            </details>
          </div>}


          {tab === "search" && <div className="adult-profile-metadata-search">
            <div className="adult-profile-metadata-search-heading"><div><h3>Search and combine metadata</h3><p>Choose the correct identity once. Homestead fills individual fields from their highest-priority enabled sources.</p></div></div>
            <div className="adult-profile-metadata-searchbar">
              <input value={metadataQuery} onChange={(event) => setMetadataQuery(event.target.value)} placeholder={form.name || "Profile name"} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); searchMetadataCandidates(); } }} />
              <button type="button" className="primary-button" disabled={metadataLoading || !(metadataQuery || form.name).trim()} onClick={searchMetadataCandidates}>{metadataLoading ? "Searching…" : "Search Sources"}</button>
            </div>
            {metadataStatus && <div className="adult-profile-metadata-status">{metadataStatus}</div>}
            {!!metadataCandidates.length && <div className="adult-profile-metadata-candidates">
              {metadataCandidates.map((candidate, index) => <button key={candidate.id || candidate.sourceCandidateId || `${candidate.provider}-${index}`} type="button" className={selectedMetadataCandidate === candidate ? "active" : ""} onClick={() => selectAndAggregateMetadata(candidate)}>
                <span className="adult-profile-metadata-candidate-art">{candidate.poster || candidate.image || candidate.profileImage ? <img src={candidate.poster || candidate.image || candidate.profileImage} alt="" /> : "👤"}</span>
                <span><strong>{candidate.name || candidate.title || "Unnamed result"}</strong><small>{candidate.matchedSources?.join(" · ") || candidate.sources?.map((source) => source.label || source.name || source.id).filter(Boolean).join(" · ") || candidate.source || candidate.provider || "Metadata source"}{candidate.birthday || candidate.birthDate ? ` · ${formatHomesteadDate(candidate.birthday || candidate.birthDate)}` : ""}</small><small>{candidate.availableSourceCount ? `${candidate.availableSourceCount} enabled sources can be searched for this person` : ""}</small></span>
                <em>{candidate.confidence ? `${Math.round(Number(candidate.confidence) * 100)}%` : "Select"}</em>
              </button>)}
            </div>}
            {metadataReview && <div className="adult-profile-metadata-combined-review">
              <div><strong>{metadataReview.coverage?.filledFields || 0}</strong><span>Fields filled</span></div>
              <div><strong>{metadataReview.coverage?.sources || 0}</strong><span>Contributing sources</span></div>
              <div><strong>{metadataReview.coverage?.conflicts || metadataReview.conflicts?.length || 0}</strong><span>Conflicts</span></div>
              <div><strong>{metadataReview.coverage?.percent || 0}%</strong><span>Coverage</span></div>
            </div>}
            {metadataReview?.sourceSummary?.length > 0 && <details className="adult-profile-metadata-field-group adult-profile-source-coverage" open>
              <summary>Source coverage <span>{metadataReview.coverage?.sources || 0} contributing · {metadataReview.coverage?.availableSources || metadataReview.sourceSummary.length} available</span></summary>
              <div>{metadataReview.sourceSummary.map((source, index) => <p key={`${source.provider || source.source}-${index}`}><span>{source.source || source.provider}</span><strong>{source.status === "external-only" ? "Browse only" : source.status === "identity-only" ? "Identity only" : source.status === "limited" ? "Limited metadata" : "Metadata imported"}</strong><small>{source.meaningfulFields?.length ? source.meaningfulFields.join(", ") : "No profile fields contributed"}</small></p>)}</div>
            </details>}
            {metadataReview?.reviewNotes?.length > 0 && <div className="adult-profile-metadata-review-notes">{metadataReview.reviewNotes.map((note, index) => <p key={`${index}-${note}`}>{note}</p>)}</div>}
            {metadataReview?.conflicts?.length > 0 && <details className="adult-profile-metadata-field-group adult-profile-metadata-conflicts"><summary>Conflicting source values <span>{metadataReview.conflicts.length} to verify</span></summary><div className="adult-profile-conflict-list">{metadataReview.conflicts.map((conflict) => <article key={conflict.field}><span>{conflict.label}</span><strong>Selected: {conflict.chosen || "—"}</strong><small>{conflict.options?.map((option) => `${option.source}: ${option.value || "—"}`).join(" · ")}</small></article>)}</div></details>}
            {metadataReview?.fieldGroups?.map((group) => <details key={group.id} className="adult-profile-metadata-field-group" open={group.id === "identity" || group.id === "body"}>
              <summary>{group.label} <span>{group.fields?.length || 0}</span></summary>
              <div>{group.fields?.map((field) => <p key={field.key}><span>{field.label}</span><strong>{field.chosen?.valuePreview || "—"}</strong><small>{field.chosen?.source || ""}</small></p>)}</div>
            </details>)}
            <div className="adult-profile-metadata-summary">
              <div><strong>Folder creation</strong><span>{effectiveFolder}</span></div>
              <div><strong>metadata.json</strong><span>{selectedMetadataCandidate ? "Composite metadata and source provenance will be saved." : "Manual fields will be saved; matching can be completed later."}</span></div>
              <div><strong>Media import</strong><span>{selectedMedia.length} selected item{selectedMedia.length === 1 ? "" : "s"}; unavailable items can be added later.</span></div>
              <div><strong>Scanner</strong><span>Runs after the profile and queued media are saved.</span></div>
            </div>
          </div>}

          {tab === "summary" && <div className="adult-profile-preview-layout">
            <div className="adult-profile-preview-artwork">
              {artwork.poster ? <img src={artwork.poster.previewUrl} alt="Selected poster" /> : <div>{PROFILE_TYPES.find((item) => item.id === profileType)?.icon}</div>}
            </div>
            <div><p>{typeLabel}</p><h3>{form.name || "Untitled profile"}</h3><code>{effectiveFolder}</code>{profileType !== "personal" && <span>Identity: {selectedMetadataCandidate ? `${selectedMetadataCandidate.name || selectedMetadataCandidate.title} verified from ${selectedMetadataCandidate.matchedSources?.length || selectedMetadataCandidate.sources?.length || 1} source${(selectedMetadataCandidate.matchedSources?.length || selectedMetadataCandidate.sources?.length || 1) === 1 ? "" : "s"}` : "Manual profile; no provider identity selected"}</span>}<span>Body data: {[form.height, form.weight, form.measurements, form.braBand, form.cupSize, form.pantySize].filter(Boolean).length} key field{[form.height, form.weight, form.measurements, form.braBand, form.cupSize, form.pantySize].filter(Boolean).length === 1 ? "" : "s"} filled</span><span>{selectedMedia.length} media item{selectedMedia.length === 1 ? "" : "s"} queued</span><span>Poster: {artwork.poster?.name || "Not selected"}</span><span>Banner: {artwork.banner?.name || "Not selected"}</span><span>Headshot: {artwork.headshot?.name || "Not selected"}</span><span>Trailer: {artwork.trailer?.name || "Not selected"}</span>{duplicateProfile && <div className="adult-profile-duplicate-warning"><strong>Already in Homestead</strong><span>{duplicateProfile.name || duplicateProfile.title} already exists in this profile library. Open it instead of creating a duplicate.</span></div>}</div>
          </div>}
        </div>

        {error && <div className="adult-profile-create-error">{error}</div>}
        <footer className="adult-profile-create-actions">
          <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cancel</button>
          {previousTab && <button type="button" className="secondary-button" disabled={saving} onClick={() => setTab(previousTab)}>Back</button>}
          {nextTab && <button type="button" className="primary-button" disabled={saving || (tab === "general" && !form.name.trim())} onClick={() => setTab(nextTab)}>Continue</button>}
          {!nextTab && duplicateProfile && <button type="button" className="primary-button" disabled={saving} onClick={() => onOpenExisting?.(duplicateProfile)}>Open Existing Profile</button>}
          {!nextTab && !duplicateProfile && <button type="button" className="primary-button" disabled={saving || !form.name.trim()} onClick={createProfile}>{saving ? "Creating…" : `Create ${typeLabel}`}</button>}
        </footer>
      </section>
      {previewMedia && createPortal(
        <div className="adult-profile-photo-viewer" role="dialog" aria-modal="true" aria-label={`Photo preview: ${previewMedia.name || "Photo"}`} onMouseDown={(event) => event.target === event.currentTarget && setPreviewMediaId("")}>
          <section className="adult-profile-photo-viewer-shell">
            <header><div><strong>{previewMedia.name || "Photo"}</strong><span>{previewIndex + 1} / {previewImages.length}</span></div><button type="button" onClick={() => setPreviewMediaId("")} aria-label="Close photo preview">×</button></header>
            {previewImages.length > 1 && <button type="button" className="adult-profile-photo-viewer-nav previous" onClick={() => { setPreviewLoadFailed(false); moveMediaPreview(-1); }} aria-label="Previous photo">‹</button>}
            {previewLoadFailed ? <div className="adult-profile-photo-viewer-error"><strong>Photo preview unavailable</strong><span>The source may block embedded previews. You can still skip the item or open its source page.</span></div> : <img key={previewMedia.id} src={previewMedia.previewUrl || previewMedia.url} alt={previewMedia.name || "Photo preview"} referrerPolicy="no-referrer" onError={() => setPreviewLoadFailed(true)} />}
            {previewImages.length > 1 && <button type="button" className="adult-profile-photo-viewer-nav next" onClick={() => { setPreviewLoadFailed(false); moveMediaPreview(1); }} aria-label="Next photo">›</button>}
            <footer>
              <label><input type="checkbox" checked={previewMedia.selected !== false} onChange={() => toggleMediaSelected(previewMedia.id)} /><span>Import this photo</span></label>
              <label><span>Save in</span><select value={previewMedia.destination === "nudes" ? "nudes" : "photos"} onChange={(event) => setMediaDestination(previewMedia.id, event.target.value)}><option value="photos">Photos</option><option value="nudes">Nudes</option></select></label>
              {previewMedia.sourcePageUrl && <a href={previewMedia.sourcePageUrl} target="_blank" rel="noreferrer">Open source</a>}
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
