import { useEffect, useMemo, useState } from "react";

const MEDIA_DESTINATIONS = [
  {
    value: "photos",
    label: "Photos",
    icon: "🖼️",
    description: "Image folders, galleries, albums, and photo sets.",
  },
  {
    value: "videos",
    label: "Videos",
    icon: "🎞️",
    description: "General profile videos and clips.",
  },
  {
    value: "scenes",
    label: "Scenes",
    icon: "▶️",
    description: "Scene-style video folders attached to a profile.",
  },
  {
    value: "sets",
    label: "Sets",
    icon: "📚",
    description: "Named photo/video collections from one folder.",
  },
  {
    value: "artwork",
    label: "Artwork",
    icon: "🌄",
    description: "Poster, banner, headshot, and background images.",
  },
  {
    value: "documents",
    label: "Documents",
    icon: "📄",
    description: "Metadata files, notes, references, and documents.",
  },
  {
    value: "custom",
    label: "Custom Folder",
    icon: "✨",
    description:
      "Create or use a custom folder like gaming, trips, events, or cosplay.",
  },
];

const IMPORT_ACTIONS = [
  {
    value: "move",
    label: "Move",
    icon: "➡️",
    description: "Move files into the selected Homestead profile folder.",
  },
  {
    value: "copy",
    label: "Copy",
    icon: "📋",
    description: "Copy files and leave the original source folder unchanged.",
  },
  {
    value: "link",
    label: "Link Only",
    icon: "🔗",
    description: "Keep files where they are and save the source path.",
  },
];

const PROFILE_TYPE_LABELS = {
  personal: "Personal",
  girls: "Personal",
  performer: "Performer",
  performers: "Performer",
  celebrity: "Celebrity",
  celebrities: "Celebrity",
};

const PROFILE_TYPE_ICONS = {
  personal: "👤",
  girls: "👤",
  performer: "🎭",
  performers: "🎭",
  celebrity: "⭐",
  celebrities: "⭐",
};

const INITIAL_FORM = {
  sourcePath: "",
  selectedProfileId: "",
  destinationFolder: "photos",
  customDestinationFolder: "",
  importAction: "move",
  preserveFolderStructure: true,
  createAlbumFromFolder: true,
  scanAfterImport: true,
  generateThumbnails: true,
  detectDuplicates: true,
  skipExistingFiles: true,
  overwriteExistingFiles: false,
  queueMetadataRefresh: true,
  notes: "",
};

function normalizeProfileType(value) {
  if (value === "girls") return "personal";
  if (value === "performers") return "performer";
  if (value === "celebrities") return "celebrity";
  return value || "personal";
}

function getProfileName(profile) {
  return (
    profile?.displayName ||
    profile?.name ||
    profile?.title ||
    profile?.metadata?.displayName ||
    profile?.metadata?.name ||
    "Unnamed Profile"
  );
}

function getProfileId(profile) {
  const name = getProfileName(profile);
  return (
    profile?.id ||
    profile?.slug ||
    profile?.localId ||
    profile?.path ||
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  );
}

function getProfileType(profile) {
  return normalizeProfileType(
    profile?.profileType ||
      profile?.type ||
      profile?.library ||
      profile?.metadata?.profileType ||
      profile?.metadata?.type ||
      "personal"
  );
}

function getProfilePoster(profile) {
  return (
    profile?.poster ||
    profile?.headshot ||
    profile?.image ||
    profile?.metadata?.poster ||
    profile?.metadata?.headshot ||
    ""
  );
}

function getProfileFolder(profile) {
  return (
    profile?.folderPath ||
    profile?.path ||
    profile?.metadata?.folderPath ||
    profile?.metadata?.path ||
    ""
  );
}

function getDefaultBasePath(profile) {
  const type = getProfileType(profile);
  const id = getProfileId(profile);

  if (getProfileFolder(profile)) {
    return getProfileFolder(profile);
  }

  if (type === "performer") return `/media/adult/performers/${id}`;
  if (type === "celebrity") return `/media/adult/celebrities/${id}`;
  return `/media/adult/personal/${id}`;
}

function getFolderNameFromPath(path) {
  if (!path) return "";
  const clean = path.replace(/[\\/]+$/, "");
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

function uniqueProfiles(profiles = []) {
  const seen = new Set();

  return profiles.filter((profile) => {
    const id = getProfileId(profile);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export default function ImportAdultMediaModal({
  open,
  profiles = [],
  defaultProfileId = "",
  defaultDestination = "photos",
  onClose,
  onSubmit,
  onBrowseSource,
}) {
  const normalizedProfiles = useMemo(() => uniqueProfiles(profiles), [profiles]);

  const [step, setStep] = useState(1);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({
    ...INITIAL_FORM,
    selectedProfileId: defaultProfileId || "",
    destinationFolder: defaultDestination || "photos",
  });
  const [error, setError] = useState("");

  const selectedProfile = useMemo(() => {
    return normalizedProfiles.find(
      (profile) => getProfileId(profile) === form.selectedProfileId
    );
  }, [normalizedProfiles, form.selectedProfileId]);

  const selectedDestination = useMemo(() => {
    return MEDIA_DESTINATIONS.find(
      (destination) => destination.value === form.destinationFolder
    );
  }, [form.destinationFolder]);

  const selectedAction = useMemo(() => {
    return IMPORT_ACTIONS.find((action) => action.value === form.importAction);
  }, [form.importAction]);

  const filteredProfiles = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();

    if (!cleanQuery) return normalizedProfiles;

    return normalizedProfiles.filter((profile) => {
      const name = getProfileName(profile).toLowerCase();
      const type = getProfileType(profile).toLowerCase();
      const id = getProfileId(profile).toLowerCase();

      return (
        name.includes(cleanQuery) ||
        type.includes(cleanQuery) ||
        id.includes(cleanQuery)
      );
    });
  }, [normalizedProfiles, query]);

  const destinationPath = useMemo(() => {
    if (!selectedProfile) return "";

    const basePath = getDefaultBasePath(selectedProfile);
    const customFolder = form.customDestinationFolder
      .trim()
      .replace(/^\/+|\/+$/g, "");

    const folder =
      form.destinationFolder === "custom"
        ? customFolder || "custom"
        : form.destinationFolder;

    return `${basePath.replace(/[\\/]+$/, "")}/${folder}`;
  }, [selectedProfile, form.destinationFolder, form.customDestinationFolder]);

  const sourceFolderName = useMemo(
    () => getFolderNameFromPath(form.sourcePath),
    [form.sourcePath]
  );

  useEffect(() => {
    if (!open) return;

    setStep(1);
    setQuery("");
    setError("");
    setForm({
      ...INITIAL_FORM,
      selectedProfileId: defaultProfileId || "",
      destinationFolder: defaultDestination || "photos",
    });
  }, [open, defaultProfileId, defaultDestination]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("modal-scroll-lock");

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-scroll-lock");
    };
  }, [open, onClose]);

  if (!open) return null;

  function updateField(field, value) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));

    if (error) setError("");
  }

  async function handleBrowseSource() {
    if (!onBrowseSource) return;

    const selectedPath = await onBrowseSource();

    if (selectedPath) {
      updateField("sourcePath", selectedPath);
    }
  }

  function validateStep(targetStep = step) {
    if (targetStep >= 1 && !form.sourcePath.trim()) {
      setError("Choose or enter a source folder first.");
      setStep(1);
      return false;
    }

    if (targetStep >= 2 && !form.selectedProfileId) {
      setError("Select the profile this media belongs to.");
      setStep(2);
      return false;
    }

    if (
      targetStep >= 3 &&
      form.destinationFolder === "custom" &&
      !form.customDestinationFolder.trim()
    ) {
      setError("Enter a custom folder path like gaming, trips, or events/2026.");
      setStep(3);
      return false;
    }

    if (form.overwriteExistingFiles && form.skipExistingFiles) {
      setError("Choose either Skip existing files or Overwrite existing files, not both.");
      setStep(4);
      return false;
    }

    return true;
  }

  function goNext() {
    if (!validateStep(step)) return;
    setStep((prev) => Math.min(prev + 1, 5));
  }

  function goBack() {
    setError("");
    setStep((prev) => Math.max(prev - 1, 1));
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (!validateStep(5)) return;

    const payload = {
      sourcePath: form.sourcePath.trim(),
      sourceFolderName,
      profileId: form.selectedProfileId,
      profileName: selectedProfile ? getProfileName(selectedProfile) : "",
      profileType: selectedProfile ? getProfileType(selectedProfile) : "personal",
      destinationFolder:
        form.destinationFolder === "custom"
          ? form.customDestinationFolder.trim().replace(/^\/+|\/+$/g, "")
          : form.destinationFolder,
      destinationPath,
      importAction: form.importAction,
      options: {
        preserveFolderStructure: form.preserveFolderStructure,
        createAlbumFromFolder: form.createAlbumFromFolder,
        scanAfterImport: form.scanAfterImport,
        generateThumbnails: form.generateThumbnails,
        detectDuplicates: form.detectDuplicates,
        skipExistingFiles: form.skipExistingFiles,
        overwriteExistingFiles: form.overwriteExistingFiles,
        queueMetadataRefresh: form.queueMetadataRefresh,
      },
      notes: form.notes.trim(),
      createdAt: new Date().toISOString(),
    };

    onSubmit?.(payload);
  }

  const previewPayload = {
    sourcePath: form.sourcePath.trim(),
    sourceFolderName,
    profileId: form.selectedProfileId,
    profileName: selectedProfile ? getProfileName(selectedProfile) : "",
    profileType: selectedProfile ? getProfileType(selectedProfile) : "",
    destinationFolder:
      form.destinationFolder === "custom"
        ? form.customDestinationFolder.trim().replace(/^\/+|\/+$/g, "")
        : form.destinationFolder,
    destinationPath,
    importAction: form.importAction,
    options: {
      preserveFolderStructure: form.preserveFolderStructure,
      createAlbumFromFolder: form.createAlbumFromFolder,
      scanAfterImport: form.scanAfterImport,
      generateThumbnails: form.generateThumbnails,
      detectDuplicates: form.detectDuplicates,
      skipExistingFiles: form.skipExistingFiles,
      overwriteExistingFiles: form.overwriteExistingFiles,
      queueMetadataRefresh: form.queueMetadataRefresh,
    },
    notes: form.notes.trim(),
  };

  return (
    <div className="adult-import-modal-overlay" role="dialog" aria-modal="true">
      <button
        type="button"
        className="adult-import-modal-backdrop"
        aria-label="Close import media form"
        onClick={onClose}
      />

      <form className="adult-import-modal-card" onSubmit={handleSubmit}>
        <div className="adult-import-modal-header">
          <div>
            <p className="adult-import-modal-kicker">Adult Library</p>
            <h2>📥 Import Media</h2>
            <p>
              Choose an existing folder, attach it to a profile, select where it
              belongs, then move, copy, or link it.
            </p>
          </div>

          <button
            type="button"
            className="adult-import-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="adult-import-step-row">
          {[
            { number: 1, label: "Source" },
            { number: 2, label: "Profile" },
            { number: 3, label: "Destination" },
            { number: 4, label: "Options" },
            { number: 5, label: "Confirm" },
          ].map((item) => (
            <button
              key={item.number}
              type="button"
              className={
                step === item.number
                  ? "adult-import-step active"
                  : step > item.number
                    ? "adult-import-step complete"
                    : "adult-import-step"
              }
              onClick={() => {
                if (item.number <= step || validateStep(item.number - 1)) {
                  setStep(item.number);
                }
              }}
            >
              <span>{item.number}</span>
              <strong>{item.label}</strong>
            </button>
          ))}
        </div>

        <div className="adult-import-modal-body">
          {step === 1 && (
            <section className="adult-import-step-panel">
              <div className="adult-import-section-header">
                <h3>Source Folder</h3>
                <p>Select the existing folder you want Homestead to import.</p>
              </div>

              <label className="adult-import-field adult-import-wide-field">
                <span>Source Path</span>
                <div className="adult-import-path-row">
                  <input
                    type="text"
                    value={form.sourcePath}
                    onChange={(event) =>
                      updateField("sourcePath", event.target.value)
                    }
                    placeholder="/mnt/user/imports/adult/folder-name"
                    autoFocus
                  />

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleBrowseSource}
                    disabled={!onBrowseSource}
                    title={
                      onBrowseSource
                        ? "Browse for folder"
                        : "Folder browser backend is not wired yet"
                    }
                  >
                    Browse
                  </button>
                </div>
              </label>

              <div className="adult-import-hint-card">
                <strong>Suggested workflow</strong>
                <p>
                  Put unsorted folders in an import area, then use this form to
                  move or copy them into the selected profile.
                </p>
              </div>

              {sourceFolderName && (
                <div className="adult-import-summary-card">
                  <span>Detected Folder Name</span>
                  <strong>{sourceFolderName}</strong>
                </div>
              )}
            </section>
          )}

          {step === 2 && (
            <section className="adult-import-step-panel">
              <div className="adult-import-section-header">
                <h3>Select Profile</h3>
                <p>Choose the existing profile this media belongs to.</p>
              </div>

              <input
                className="adult-import-profile-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search profiles..."
                autoFocus
              />

              {filteredProfiles.length > 0 ? (
                <div className="adult-import-profile-grid">
                  {filteredProfiles.map((profile) => {
                    const id = getProfileId(profile);
                    const name = getProfileName(profile);
                    const type = getProfileType(profile);
                    const poster = getProfilePoster(profile);
                    const isActive = form.selectedProfileId === id;

                    return (
                      <button
                        type="button"
                        key={id}
                        className={
                          isActive
                            ? "adult-import-profile-card active"
                            : "adult-import-profile-card"
                        }
                        onClick={() => updateField("selectedProfileId", id)}
                      >
                        <div className="adult-import-profile-poster">
                          {poster ? (
                            <img src={poster} alt="" />
                          ) : (
                            <span>{PROFILE_TYPE_ICONS[type] || "👤"}</span>
                          )}
                        </div>

                        <div>
                          <strong>{name}</strong>
                          <span>
                            {PROFILE_TYPE_ICONS[type] || "👤"}{" "}
                            {PROFILE_TYPE_LABELS[type] || "Personal"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="adult-import-empty-state">
                  No profiles found. Create the profile first, then return to
                  Import Media.
                </div>
              )}
            </section>
          )}

          {step === 3 && (
            <section className="adult-import-step-panel">
              <div className="adult-import-section-header">
                <h3>Destination</h3>
                <p>Pick where this folder should live inside the profile.</p>
              </div>

              <div className="adult-import-destination-grid">
                {MEDIA_DESTINATIONS.map((destination) => (
                  <button
                    type="button"
                    key={destination.value}
                    className={
                      form.destinationFolder === destination.value
                        ? "adult-import-destination-card active"
                        : "adult-import-destination-card"
                    }
                    onClick={() =>
                      updateField("destinationFolder", destination.value)
                    }
                  >
                    <span>{destination.icon}</span>
                    <strong>{destination.label}</strong>
                    <p>{destination.description}</p>
                  </button>
                ))}
              </div>

              {form.destinationFolder === "custom" && (
                <label className="adult-import-field adult-import-wide-field">
                  <span>Custom Folder Path</span>
                  <input
                    type="text"
                    value={form.customDestinationFolder}
                    onChange={(event) =>
                      updateField("customDestinationFolder", event.target.value)
                    }
                    placeholder="gaming, trips, events/2026, cosplay, vacations"
                    autoFocus
                  />
                  <small className="adult-import-field-hint">
                    Use a simple folder name or a nested path. Example:
                    trips/2026-beach.
                  </small>
                </label>
              )}

              <div className="adult-import-summary-card">
                <span>Destination Path</span>
                <strong>{destinationPath || "Select a profile first"}</strong>
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="adult-import-step-panel">
              <div className="adult-import-section-header">
                <h3>Import Options</h3>
                <p>Choose how Homestead should handle the selected folder.</p>
              </div>

              <div className="adult-import-action-grid">
                {IMPORT_ACTIONS.map((action) => (
                  <button
                    type="button"
                    key={action.value}
                    className={
                      form.importAction === action.value
                        ? "adult-import-action-card active"
                        : "adult-import-action-card"
                    }
                    onClick={() => updateField("importAction", action.value)}
                  >
                    <span>{action.icon}</span>
                    <strong>{action.label}</strong>
                    <p>{action.description}</p>
                  </button>
                ))}
              </div>

              <div className="adult-import-options-grid">
                <label>
                  <input
                    type="checkbox"
                    checked={form.preserveFolderStructure}
                    onChange={(event) =>
                      updateField(
                        "preserveFolderStructure",
                        event.target.checked
                      )
                    }
                  />
                  <span>Preserve folder structure</span>
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={form.createAlbumFromFolder}
                    onChange={(event) =>
                      updateField("createAlbumFromFolder", event.target.checked)
                    }
                  />
                  <span>Create album/set from folder name</span>
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={form.scanAfterImport}
                    onChange={(event) =>
                      updateField("scanAfterImport", event.target.checked)
                    }
                  />
                  <span>Scan after import</span>
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={form.generateThumbnails}
                    onChange={(event) =>
                      updateField("generateThumbnails", event.target.checked)
                    }
                  />
                  <span>Generate thumbnails</span>
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={form.detectDuplicates}
                    onChange={(event) =>
                      updateField("detectDuplicates", event.target.checked)
                    }
                  />
                  <span>Detect duplicates</span>
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={form.queueMetadataRefresh}
                    onChange={(event) =>
                      updateField("queueMetadataRefresh", event.target.checked)
                    }
                  />
                  <span>Queue metadata refresh</span>
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={form.skipExistingFiles}
                    onChange={(event) => {
                      updateField("skipExistingFiles", event.target.checked);
                      if (event.target.checked) {
                        updateField("overwriteExistingFiles", false);
                      }
                    }}
                  />
                  <span>Skip existing files</span>
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={form.overwriteExistingFiles}
                    onChange={(event) => {
                      updateField("overwriteExistingFiles", event.target.checked);
                      if (event.target.checked) {
                        updateField("skipExistingFiles", false);
                      }
                    }}
                  />
                  <span>Overwrite existing files</span>
                </label>
              </div>

              <label className="adult-import-field adult-import-wide-field">
                <span>Import Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                  placeholder="Optional notes about this import"
                  rows={4}
                />
              </label>
            </section>
          )}

          {step === 5 && (
            <section className="adult-import-step-panel">
              <div className="adult-import-section-header">
                <h3>Confirm Import</h3>
                <p>Review the import before Homestead queues the action.</p>
              </div>

              <div className="adult-import-confirm-grid">
                <div className="adult-import-confirm-card">
                  <span>Source</span>
                  <strong>{form.sourcePath || "Missing source path"}</strong>
                </div>

                <div className="adult-import-confirm-card">
                  <span>Profile</span>
                  <strong>
                    {selectedProfile
                      ? `${getProfileName(selectedProfile)} · ${
                          PROFILE_TYPE_LABELS[getProfileType(selectedProfile)] ||
                          "Personal"
                        }`
                      : "No profile selected"}
                  </strong>
                </div>

                <div className="adult-import-confirm-card">
                  <span>Destination</span>
                  <strong>{destinationPath || "Missing destination"}</strong>
                </div>

                <div className="adult-import-confirm-card">
                  <span>Action</span>
                  <strong>
                    {selectedAction?.icon} {selectedAction?.label}
                  </strong>
                </div>
              </div>

              <div className="adult-import-warning-card">
                <strong>
                  {form.importAction === "move"
                    ? "Move will relocate files."
                    : form.importAction === "copy"
                      ? "Copy will duplicate files."
                      : "Link Only will not move files."}
                </strong>
                <p>
                  Backend support can later perform the filesystem operation,
                  update metadata, rescan the profile, and record the import
                  history.
                </p>
              </div>

              <details className="adult-import-preview-details">
                <summary>Preview import payload</summary>
                <pre>{JSON.stringify(previewPayload, null, 2)}</pre>
              </details>
            </section>
          )}
        </div>

        {error && <p className="adult-import-form-error">{error}</p>}

        <div className="adult-import-modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>

          {step > 1 && (
            <button type="button" className="secondary-button" onClick={goBack}>
              Back
            </button>
          )}

          {step < 5 ? (
            <button
              type="button"
              className="request-server-button"
              onClick={goNext}
            >
              Continue
            </button>
          ) : (
            <button type="submit" className="request-server-button">
              Confirm Import
            </button>
          )}
        </div>
      </form>
    </div>
  );
}