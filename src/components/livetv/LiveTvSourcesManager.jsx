import { useEffect, useMemo, useState } from "react";

function emptyDraft() {
  return {
    id: "",
    type: "m3u",
    name: "",
    url: "",
    epgUrl: "",
    serverUrl: "",
    username: "",
    password: "",
    enabled: true,
  };
}

export default function LiveTvSourcesManager() {
  const [sources, setSources] = useState([]);
  const [draft, setDraft] = useState(emptyDraft());
  const [editingId, setEditingId] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [sourceChannels, setSourceChannels] = useState([]);
  const [channelSearch, setChannelSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadSources() {
    const res = await fetch("/api/livetv/sources");
    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to load Live TV sources");
    }

    setSources(data.sources || []);
  }

  async function loadSourceChannels(sourceId) {
    if (!sourceId) return;

    const res = await fetch(`/api/livetv/sources/${sourceId}/channels`);
    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to load source channels");
    }

    setSourceChannels(data.channels || []);
  }

  useEffect(() => {
    loadSources().catch((error) => {
      setStatus(`Source load failed: ${error.message}`);
    });
  }, []);

async function saveSource() {
  if ((draft.type || "m3u") === "m3u" && !draft.url.trim()) {
    setStatus("M3U URL is required.");
    return;
  }

  if (
    draft.type === "xtream" &&
    (!draft.serverUrl.trim() || !draft.username.trim() || !draft.password.trim())
  ) {
    setStatus("Server URL, username, and password are required.");
    return;
  }

    try {
      setLoading(true);
      setStatus(editingId ? "Saving source..." : "Adding source...");

      const payload = {
  type: draft.type || "m3u",
  name: draft.name || (draft.type === "xtream" ? "IPTV Login" : "M3U Source"),
  url: draft.type === "m3u" ? draft.url : "",
  serverUrl: draft.type === "xtream" ? draft.serverUrl : "",
  username: draft.type === "xtream" ? draft.username : "",
  password: draft.type === "xtream" ? draft.password : "",
  epgUrl: draft.epgUrl || "",
  enabled: draft.enabled !== false,
};

      const res = await fetch(
        editingId ? `/api/livetv/sources/${editingId}` : "/api/livetv/sources",
        {
          method: editingId ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to save source");
      }

      setSources(data.sources || []);
      setDraft(emptyDraft());
      setEditingId("");
      setStatus(editingId ? "Source updated." : "Source added.");
    } catch (error) {
      setStatus(`Save failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function scanSource(sourceId) {
    try {
      setLoading(true);
      setStatus("Scanning source...");

      const res = await fetch(`/api/livetv/sources/${sourceId}/scan`, {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Scan failed");
      }

      setSources(data.sources || []);
      setStatus(`Source scanned. ${data.scannedCount} channels found.`);

      if (selectedSourceId === sourceId) {
        await loadSourceChannels(sourceId);
      }
    } catch (error) {
      setStatus(`Scan failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function scanAllSources() {
    try {
      setLoading(true);
      setStatus("Scanning all sources...");

      const res = await fetch("/api/livetv/sources/scan-all", {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Scan all failed");
      }

      setSources(data.sources || []);
      setStatus(
        `Scan complete. ${data.channelCount} channels saved from ${data.rawChannelCount} raw channels.`
      );

      if (selectedSourceId) {
        await loadSourceChannels(selectedSourceId);
      }
    } catch (error) {
      setStatus(`Scan all failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteSource(sourceId) {
    if (!confirm("Delete this Live TV source?")) return;

    try {
      setLoading(true);
      setStatus("Deleting source...");

      const res = await fetch(`/api/livetv/sources/${sourceId}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Delete failed");
      }

      setSources(data.sources || []);

      if (selectedSourceId === sourceId) {
        setSelectedSourceId("");
        setSourceChannels([]);
      }

      setStatus("Source deleted.");
    } catch (error) {
      setStatus(`Delete failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function toggleSourceEnabled(source) {
    try {
      const res = await fetch(`/api/livetv/sources/${source.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: !source.enabled,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Toggle failed");
      }

      setSources(data.sources || []);
    } catch (error) {
      setStatus(`Toggle failed: ${error.message}`);
    }
  }

  async function setChannelVisible(channel, visible) {
    try {
      const res = await fetch("/api/livetv/channel-overrides", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channelKey: channel.key,
          override: {
            visible,
          },
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Channel update failed");
      }

      setSourceChannels((current) =>
        current.map((item) =>
          item.key === channel.key ? { ...item, visible } : item
        )
      );
    } catch (error) {
      setStatus(`Channel update failed: ${error.message}`);
    }
  }

  async function setChannelFavorite(channel, favorite) {
    try {
      const res = await fetch("/api/livetv/channel-overrides", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channelKey: channel.key,
          override: {
            favorite,
          },
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Favorite update failed");
      }

      setSourceChannels((current) =>
        current.map((item) =>
          item.key === channel.key ? { ...item, favorite } : item
        )
      );
    } catch (error) {
      setStatus(`Favorite update failed: ${error.message}`);
    }
  }

function editSource(source) {
  setEditingId(source.id);
  setDraft({
    id: source.id,
    type: source.type || "m3u",
    name: source.name || "",
    url: source.url || "",
    epgUrl: source.epgUrl || "",
    serverUrl: source.serverUrl || "",
    username: source.username || "",
    password: source.password || "",
    enabled: source.enabled !== false,
  });
}

  function addNewUrl() {
    setEditingId("");
    setDraft(emptyDraft());
    setStatus("");
  }

  async function openChannels(sourceId) {
    setSelectedSourceId(sourceId);
    setChannelSearch("");
    await loadSourceChannels(sourceId);
  }

  const filteredSourceChannels = useMemo(() => {
    const search = channelSearch.trim().toLowerCase();

    return sourceChannels.filter((channel) => {
      if (!search) return true;

      return (
        String(channel.name || "").toLowerCase().includes(search) ||
        String(channel.group || "").toLowerCase().includes(search)
      );
    });
  }, [sourceChannels, channelSearch]);

  return (
    <div className="livetv-source-manager">
      <h3>M3U Sources</h3>
      <p className="small-muted">
        Add public M3U playlists, xTeVe playlists, or other authorized M3U sources.
      </p>

      <div className="settings-config-section">
        <label className="settings-field">
          Source Name
          <input
            value={draft.name}
            placeholder="Example: US Public Channels"
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
          />
        </label>
				
		{draft.type === "xtream" && (
  <>
    <label className="settings-field">
      Server URL
      <input
        value={draft.serverUrl}
        placeholder="http://example.com:8080"
        onChange={(event) =>
          setDraft((current) => ({ ...current, serverUrl: event.target.value }))
        }
      />
    </label>

    <label className="settings-field">
      Username
      <input
        value={draft.username}
        placeholder="Username"
        onChange={(event) =>
          setDraft((current) => ({ ...current, username: event.target.value }))
        }
      />
    </label>

    <label className="settings-field">
      Password
      <input
        type="password"
        value={draft.password}
        placeholder="Password"
        onChange={(event) =>
          setDraft((current) => ({ ...current, password: event.target.value }))
        }
      />
    </label>
  </>
)}
		
		
		<label className="settings-field">
  Source Type
  <select
    value={draft.type || "m3u"}
    onChange={(event) =>
      setDraft((current) => ({ ...current, type: event.target.value }))
    }
  >
    <option value="m3u">M3U Playlist / xTeVe</option>
    <option value="xtream">IPTV Login / Smarters-style</option>
  </select>
</label>
		
{(draft.type || "m3u") === "m3u" && (
  <label className="settings-field">
    M3U URL
    <input
      value={draft.url}
      placeholder="https://example.com/playlist.m3u"
      onChange={(event) =>
        setDraft((current) => ({ ...current, url: event.target.value }))
      }
    />
  </label>
)}

        <label className="settings-field">
          EPG URL Optional
          <input
            value={draft.epgUrl}
            placeholder="Optional XMLTV guide URL"
            onChange={(event) =>
              setDraft((current) => ({ ...current, epgUrl: event.target.value }))
            }
          />
        </label>
      </div>

      <div className="modal-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={saveSource}
          disabled={loading}
        >
          {editingId ? "Save Source" : "Add Source"}
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={addNewUrl}
          disabled={loading}
        >
          + Add URL
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={scanAllSources}
          disabled={loading || !sources.length}
        >
          Scan All Sources
        </button>
      </div>

      {status && <p className="small-muted">{status}</p>}

      <h3>Saved Sources</h3>

      <div className="livetv-source-list">
        {sources.map((source) => (
          <div key={source.id} className="livetv-source-card">
            <div className="livetv-source-main">
              <label className="livetv-source-enabled">
                <input
                  type="checkbox"
                  checked={source.enabled !== false}
                  onChange={() => toggleSourceEnabled(source)}
                />
                <span>{source.name}</span>
              </label>

              <p>
                {source.channelCount || 0} channels
				{source.epgProgramCount ? ` · ${source.epgProgramCount} guide programs` : ""}
                {source.lastScan ? ` · Last scanned ${new Date(source.lastScan).toLocaleString()}` : " · Not scanned yet"}
              </p>

              <p className="small-muted">{source.url}</p>
            </div>

            <div className="livetv-source-actions">
              <button type="button" onClick={() => editSource(source)}>
                Edit
              </button>

              <button type="button" onClick={() => scanSource(source.id)}>
                Scan
              </button>

              <button type="button" onClick={() => openChannels(source.id)}>
                Channels
              </button>

              <button type="button" onClick={() => deleteSource(source.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}

        {!sources.length && (
          <p className="small-muted">
            No Live TV sources added yet. Paste an M3U URL above and click Add Source.
          </p>
        )}
      </div>

      {selectedSourceId && (
        <div className="livetv-channel-manager">
          <h3>Source Channels</h3>

          <input
            className="livetv-channel-search"
            value={channelSearch}
            placeholder="Search this source..."
            onChange={(event) => setChannelSearch(event.target.value)}
          />

          <div className="livetv-channel-list">
            {filteredSourceChannels.map((channel) => (
              <div key={channel.key} className="livetv-channel-row">
                <div>
                  <strong>{channel.name}</strong>
                  <p>
                    {channel.group || "Other"} · {channel.sourceName}
                  </p>
                </div>

                <div className="livetv-channel-row-actions">
                  <button
                    type="button"
                    onClick={() => setChannelVisible(channel, !channel.visible)}
                  >
                    {channel.visible === false ? "Show" : "Hide"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setChannelFavorite(channel, !channel.favorite)}
                  >
                    {channel.favorite ? "★ Favorite" : "☆ Favorite"}
                  </button>
                </div>
              </div>
            ))}

            {!filteredSourceChannels.length && (
              <p className="small-muted">No channels found for this source.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}