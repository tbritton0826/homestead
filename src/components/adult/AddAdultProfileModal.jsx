import { useEffect, useMemo, useState } from "react";

const PROFILE_TYPES = [
  { id: "personal", icon: "👤", label: "Personal" },
  { id: "performer", icon: "🎭", label: "Performer" },
  { id: "celebrity", icon: "⭐", label: "Celebrity" },
];

const EMPTY_FORM = {
  name: "",
  sortName: "",
  birthday: "",
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
  braSize: "",
  pantySize: "",
  shoeSize: "",
  dressSize: "",
  clothingSize: "",
  hairColor: "",
  eyeColor: "",
  bodySourceName: "Manual entry",
  bodySourceUrl: "",
  folderPath: "",
};

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

export default function AddAdultProfileModal({ open, defaultType = "", initialMedia = [], initialSourceName = "", initialSourceUrl = "", onClose, onSubmit }) {
  const [profileType, setProfileType] = useState(defaultType || "personal");
  const [tab, setTab] = useState("general");
  const [form, setForm] = useState(EMPTY_FORM);
  const [media, setMedia] = useState([]);
  const [imageDestination, setImageDestination] = useState("photos");
  const [urlDraft, setUrlDraft] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setProfileType(defaultType || "personal");
    setTab("general");
    setForm(EMPTY_FORM);
    setMedia(
      Array.isArray(initialMedia)
        ? initialMedia.map((item, index) => ({
            id: item.id || `initial-${index}-${Date.now()}`,
            source: item.source || "url",
            kind: item.kind || "image",
            name: item.name || `Imported image ${index + 1}`,
            url: item.url || item.previewUrl || "",
            previewUrl: item.previewUrl || item.url || "",
            destination: item.destination || "nudes",
            roles: Array.isArray(item.roles) ? item.roles : [],
          }))
        : []
    );
    setImageDestination(
      Array.isArray(initialMedia) && initialMedia.some((item) => item.destination === "nudes")
        ? "nudes"
        : "photos"
    );
    setUrlDraft("");
    setUrlLoading(false);
    setAdvancedOpen(false);
    setSaving(false);
    setError("");
  }, [open, defaultType]);

  useEffect(() => () => {
    media.forEach((item) => item.previewUrl?.startsWith("blob:") && URL.revokeObjectURL(item.previewUrl));
  }, [media]);

  const libraryType = profileType === "celebrity" ? "celebrities" : profileType === "performer" ? "performers" : "personal";
  const suggestedFolder = `/media/${libraryType}/${slugify(form.name)}`;
  const effectiveFolder = form.folderPath || suggestedFolder;
  const artwork = useMemo(() => ({
    poster: media.find((item) => item.roles?.poster),
    banner: media.find((item) => item.roles?.banner),
    headshot: media.find((item) => item.roles?.headshot),
  }), [media]);

  if (!open) return null;

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
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
      destination: mediaKind(file) === "video" ? "videos" : imageDestination,
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
            destination: item.kind === "video" ? "videos" : imageDestination,
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

  function setBulkImageDestination(destination) {
    setImageDestination(destination);
    setMedia((current) => current.map((item) => item.kind === "image" ? { ...item, destination } : item));
  }

  function toggleRole(itemId, role) {
    setMedia((current) => current.map((item) => {
      if (item.id === itemId) return { ...item, roles: { ...item.roles, [role]: !item.roles?.[role] } };
      if (["poster", "banner", "headshot"].includes(role) && item.roles?.[role]) {
        return { ...item, roles: { ...item.roles, [role]: false } };
      }
      return item;
    }));
  }

  function removeMedia(itemId) {
    setMedia((current) => {
      const removed = current.find((item) => item.id === itemId);
      if (removed?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.id !== itemId);
    });
  }

  async function createProfile() {
    if (!form.name.trim()) {
      setError("Display name is required.");
      setTab("general");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit?.({
        ...form,
        name: form.name.trim(),
        profileType,
        libraryType,
        folderPath: effectiveFolder,
        aliases: form.aliases.split(",").map((value) => value.trim()).filter(Boolean),
        tags: form.tags.split(",").map((value) => value.trim()).filter(Boolean),
        mediaQueue: media,
        artworkSelections: {
          posterId: artwork.poster?.id || "",
          bannerId: artwork.banner?.id || "",
          headshotId: artwork.headshot?.id || "",
        },
        metadata: {
          height: form.height,
          weight: form.weight,
          measurements: form.measurements,
          measurementsRaw: form.measurements,
          bust: form.bust,
          waist: form.waist,
          hips: form.hips,
          braSize: form.braSize,
          pantySize: form.pantySize,
          shoeSize: form.shoeSize,
          dressSize: form.dressSize,
          clothingSize: form.clothingSize,
          hairColor: form.hairColor,
          eyeColor: form.eyeColor,
          body: {
            height: form.height,
            weight: form.weight,
            measurementsRaw: form.measurements,
            bust: form.bust,
            waist: form.waist,
            hips: form.hips,
            braSize: form.braSize,
            pantySize: form.pantySize,
            shoeSize: form.shoeSize,
            dressSize: form.dressSize,
            clothingSize: form.clothingSize,
            hairColor: form.hairColor,
            eyeColor: form.eyeColor,
            sourceName: form.bodySourceName || "Manual entry",
            sourceUrl: form.bodySourceUrl,
            confidence: "manual",
          },
          bodyDetails: {
            height: form.height,
            weight: form.weight,
            measurementsRaw: form.measurements,
            bust: form.bust,
            waist: form.waist,
            hips: form.hips,
            braSize: form.braSize,
            pantySize: form.pantySize,
            shoeSize: form.shoeSize,
            dressSize: form.dressSize,
            clothingSize: form.clothingSize,
            hairColor: form.hairColor,
            eyeColor: form.eyeColor,
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

  return (
    <div className="adult-profile-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose?.()}>
      <section className="adult-profile-modal adult-profile-media-create-modal" role="dialog" aria-modal="true" aria-label={`Add ${typeLabel}`}>
        <header className="adult-profile-modal-heading">
          <div>
            <p>Adult Library</p>
            <h2>{PROFILE_TYPES.find((item) => item.id === profileType)?.icon} Add {typeLabel}</h2>
            <span>Create the profile folder and metadata, then import and assign its media in one flow.</span>
          </div>
          <button className="adult-profile-modal-close" type="button" disabled={saving} onClick={onClose}>×</button>
        </header>

        {!defaultType && (
          <div className="adult-profile-type-picker">
            {PROFILE_TYPES.map((type) => (
              <button key={type.id} type="button" className={profileType === type.id ? "active" : ""} onClick={() => setProfileType(type.id)}>
                <span>{type.icon}</span><strong>{type.label}</strong>
              </button>
            ))}
          </div>
        )}

        {defaultType && (
          <div className="adult-profile-context-card"><span>{PROFILE_TYPES.find((item) => item.id === profileType)?.icon}</span><div><strong>{typeLabel}</strong><small>This form was opened from the {typeLabel} library.</small></div></div>
        )}

        <nav className="adult-profile-create-tabs">
          {[
            ["general", "📝", "General"],
            ["sizes", "🏷️", "Sizes"],
            ["media", "🖼️", "Media"],
            ["metadata", "🔎", "Metadata"],
            ["preview", "{}", "Preview"],
          ].map(([id, icon, label]) => <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{icon} {label}</button>)}
        </nav>

        <div className="adult-profile-create-scroll">
          {tab === "general" && <div className="adult-profile-form-grid">
            <label><span>Display Name</span><input autoFocus value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Profile name" /></label>
            <label><span>Sort Name</span><input value={form.sortName} onChange={(event) => update("sortName", event.target.value)} placeholder="Optional sorting name" /></label>
            <label><span>Birthday</span><input value={form.birthday} onChange={(event) => update("birthday", event.target.value)} placeholder="YYYY-MM-DD or MM/DD/YYYY" /></label>
            <label><span>Status</span><select value={form.status} onChange={(event) => update("status", event.target.value)}><option>Active</option><option>Inactive</option><option>Archived</option></select></label>
            <label><span>Relationship Status</span><input value={form.relationshipStatus} onChange={(event) => update("relationshipStatus", event.target.value)} placeholder="Optional" /></label>
            <label><span>Aliases</span><input value={form.aliases} onChange={(event) => update("aliases", event.target.value)} placeholder="Comma-separated names" /></label>
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
              <label><span>Height</span><input value={form.height} onChange={(event) => update("height", event.target.value)} placeholder="5 ft 4 in, 163 cm…" /></label>
              <label><span>Weight</span><input value={form.weight} onChange={(event) => update("weight", event.target.value)} placeholder="120 lb, 54 kg…" /></label>
              <label><span>Measurements</span><input value={form.measurements} onChange={(event) => update("measurements", event.target.value)} placeholder="34-24-35" /></label>
              <label><span>Bra Size</span><input value={form.braSize} onChange={(event) => update("braSize", event.target.value)} placeholder="34C" /></label>
              <label><span>Bust</span><input value={form.bust} onChange={(event) => update("bust", event.target.value)} placeholder="34 in" /></label>
              <label><span>Waist</span><input value={form.waist} onChange={(event) => update("waist", event.target.value)} placeholder="24 in" /></label>
              <label><span>Hips</span><input value={form.hips} onChange={(event) => update("hips", event.target.value)} placeholder="35 in" /></label>
              <label><span>Panty Size</span><input value={form.pantySize} onChange={(event) => update("pantySize", event.target.value)} placeholder="XS, S, 6…" /></label>
              <label><span>Shoe Size</span><input value={form.shoeSize} onChange={(event) => update("shoeSize", event.target.value)} placeholder="US 7" /></label>
              <label><span>Dress Size</span><input value={form.dressSize} onChange={(event) => update("dressSize", event.target.value)} placeholder="US 4" /></label>
              <label><span>Clothing Size</span><input value={form.clothingSize} onChange={(event) => update("clothingSize", event.target.value)} placeholder="XS, S, M…" /></label>
              <label><span>Hair Color</span><input value={form.hairColor} onChange={(event) => update("hairColor", event.target.value)} placeholder="Brown" /></label>
              <label><span>Eye Color</span><input value={form.eyeColor} onChange={(event) => update("eyeColor", event.target.value)} placeholder="Blue" /></label>
              <label><span>Body Data Source</span><input value={form.bodySourceName} onChange={(event) => update("bodySourceName", event.target.value)} placeholder="Manual entry" /></label>
              <label className="wide"><span>Source URL</span><input value={form.bodySourceUrl} onChange={(event) => update("bodySourceUrl", event.target.value)} placeholder="Optional reference URL" /></label>
            </div>
          </div>}

          {tab === "media" && <div className="adult-profile-media-workflow">
            <div className="adult-profile-media-source-grid">
              <label className="adult-profile-media-dropzone">
                <input type="file" accept="image/*,video/*" multiple onChange={(event) => { addDeviceFiles(event.target.files); event.target.value = ""; }} />
                <span>📱</span><strong>Browse This Device</strong><small>Select photos or videos. Multiple files are supported.</small>
              </label>
              <div className="adult-profile-url-import-card">
                <span>🔗</span><strong>Import from URLs</strong><small>Paste one URL per line. Direct media links and supported gallery pages are accepted.</small>
                <div className="adult-profile-url-multi-input"><textarea rows={4} value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} placeholder={"https://example.com/photo-1.jpg\nhttps://example.com/gallery"} /><button type="button" disabled={urlLoading} onClick={addUrls}>{urlLoading ? "Finding…" : "Add URLs"}</button></div>
              </div>
            </div>

            {media.length > 0 ? <>
              <div className="adult-profile-media-help adult-profile-media-bulk-help">
                <div><strong>Choose one destination for this image batch.</strong><span>All images are retained in the selected folder. Poster, banner, and headshot selections also create artwork copies in the profile root.</span></div>
                <label className="adult-profile-media-bulk-destination"><span>Import images to</span><select value={imageDestination} onChange={(event) => setBulkImageDestination(event.target.value)}><option value="photos">Photos</option><option value="nudes">Nudes</option></select></label>
              </div>
              <div className="adult-profile-media-grid">
                {media.map((item) => <article key={item.id} className="adult-profile-media-card">
                  {item.kind === "video" ? <video src={item.previewUrl} muted /> : <img src={item.previewUrl} alt={item.name} />}
                  <div className="adult-profile-media-card-name"><strong>{item.name}</strong><button type="button" onClick={() => removeMedia(item.id)}>×</button></div>
                  {item.kind === "image" && <>
                    <div className="adult-profile-artwork-role-row">
                      {[["poster", "Poster"], ["banner", "Banner"], ["headshot", "Headshot"]].map(([role, label]) => <button key={role} type="button" className={item.roles?.[role] ? "active" : ""} onClick={() => toggleRole(item.id, role)}>{label}</button>)}
                    </div>
                    <div className="adult-profile-media-card-destination">
                      <span>{imageDestination === "nudes" ? "Nudes" : "Photos"}</span>
                      {(item.roles?.poster || item.roles?.banner || item.roles?.headshot) && <small>Also copied to the profile root as selected artwork.</small>}
                    </div>
                  </>}
                  {item.kind === "video" && <div className="adult-profile-media-video-destination">Videos</div>}
                </article>)}
              </div>
            </> : <div className="adult-profile-media-empty">No media selected yet.</div>}

            <details className="adult-profile-advanced-paths" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
              <summary>Advanced folder options</summary>
              <label><span>Profile folder</span><input value={form.folderPath} onChange={(event) => update("folderPath", event.target.value)} placeholder={suggestedFolder} /></label>
              <small>Homestead creates the folder when missing, saves metadata.json, imports selected media, and requests a scanner refresh automatically.</small>
            </details>
          </div>}


          {tab === "metadata" && <div className="adult-profile-metadata-summary">
            <h3>Automatic profile setup</h3>
            <div><strong>Folder creation</strong><span>{effectiveFolder}</span></div>
            <div><strong>metadata.json</strong><span>Created from the General and Sizes fields.</span></div>
            <div><strong>Media import</strong><span>{media.length} queued item{media.length === 1 ? "" : "s"}.</span></div>
            <div><strong>Scanner</strong><span>Runs after the profile and queued media are saved.</span></div>
          </div>}

          {tab === "preview" && <div className="adult-profile-preview-layout">
            <div className="adult-profile-preview-artwork">
              {artwork.poster ? <img src={artwork.poster.previewUrl} alt="Selected poster" /> : <div>{PROFILE_TYPES.find((item) => item.id === profileType)?.icon}</div>}
            </div>
            <div><p>{typeLabel}</p><h3>{form.name || "Untitled profile"}</h3><code>{effectiveFolder}</code><span>{media.length} media item{media.length === 1 ? "" : "s"} queued</span><span>Poster: {artwork.poster?.name || "Not selected"}</span><span>Banner: {artwork.banner?.name || "Not selected"}</span><span>Headshot: {artwork.headshot?.name || "Not selected"}</span></div>
          </div>}
        </div>

        {error && <div className="adult-profile-create-error">{error}</div>}
        <footer className="adult-profile-create-actions">
          <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="button" className="secondary-button" disabled={saving} onClick={() => setTab("preview")}>Preview</button>
          <button type="button" className="primary-button" disabled={saving || !form.name.trim()} onClick={createProfile}>{saving ? "Creating…" : `Create ${typeLabel}`}</button>
        </footer>
      </section>
    </div>
  );
}
