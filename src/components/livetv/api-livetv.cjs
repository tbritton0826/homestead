// src/api/livetv.js

export async function getLiveTvConfig() {
  const res = await fetch("/api/livetv/config");
  if (!res.ok) throw new Error("Failed to load Live TV config");
  return res.json();
}

export async function saveLiveTvConfig(config) {
  const res = await fetch("/api/livetv/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });

  if (!res.ok) throw new Error("Failed to save Live TV config");
  return res.json();
}

export async function testLiveTvPlaylist(playlistUrl) {
  const res = await fetch("/api/livetv/playlist/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ playlistUrl }),
  });

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Failed to test playlist");
  }

  return data;
}

export async function refreshLiveTvPlaylist() {
  const res = await fetch("/api/livetv/playlist/refresh", {
    method: "POST",
  });

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Failed to refresh playlist");
  }

  return data;
}

export async function getLiveTvChannels() {
  const res = await fetch("/api/livetv/channels");
  if (!res.ok) throw new Error("Failed to load Live TV channels");
  return res.json();
}