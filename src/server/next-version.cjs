const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createSubscriptionService } = require("./subscription-entitlements.cjs");

function registerNextVersionRoutes({ app, express, dataDir, readSetupConfig, writeSetupConfig, subscriptionService = createSubscriptionService() }) {
  const stateDir = path.join(dataDir, "next-version");
  const accountsPath = path.join(stateDir, "accounts.json");
  const sessionsPath = path.join(stateDir, "sessions.json");
  const auditPath = path.join(stateDir, "audit.json");
  const cloudRoot = path.join(dataDir, "cloud-drive");
  const cloudPath = path.join(stateDir, "cloud.json");
  const automationPath = path.join(stateDir, "automation.json");
  const bookEditionLinksPath = path.join(stateDir, "book-edition-links.json");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(cloudRoot, { recursive: true });

  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
  };
  const writeJson = (file, value) => {
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
    fs.renameSync(temporary, file);
    return value;
  };
  const id = (prefix) => `${prefix}_${crypto.randomBytes(9).toString("hex")}`;
  const now = () => new Date().toISOString();
  const hashPassword = (password) => {
    const salt = crypto.randomBytes(16).toString("hex");
    return `scrypt:${salt}:${crypto.scryptSync(String(password), salt, 64).toString("hex")}`;
  };
  const verifyPassword = (password, stored = "") => {
    const [, salt, hash] = String(stored).split(":");
    if (!salt || !hash) return false;
    const actual = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  };
  const adultAccessKeys = ["personalProfiles", "performers", "celebrities", "adultPhotos", "adultVideos", "adultTVChannels", "bodyDetails", "timelines", "downloads"];
  const fullAdultSublibraryAccess = () => Object.fromEntries(adultAccessKeys.map((key) => [key, true]));
  const emptyAdultSublibraryAccess = () => Object.fromEntries(adultAccessKeys.map((key) => [key, false]));
  const normalizeAdultAccessMode = (user = {}) => {
    user = user || {};
    if (user.role === "owner" || user.fullAdultAccess === true || user.adultAccessMode === "full") return "full";
    if (user.role === "child") return "none";
    if (user.adultAccessMode === "performers-celebrities") return "performers-celebrities";
    if (user.adultAccessMode === "custom") return "custom";
    if (user.linkedAdultProfileId) return "linked-profile";
    return "none";
  };
  const normalizeAdultSublibraryAccess = (user = {}) => {
    const mode = normalizeAdultAccessMode(user);
    if (mode === "full") return fullAdultSublibraryAccess();
    if (mode === "performers-celebrities") return { ...emptyAdultSublibraryAccess(), performers: true, celebrities: true };
    if (mode === "custom") {
      const requested = user.adultSublibraryAccess && typeof user.adultSublibraryAccess === "object" ? user.adultSublibraryAccess : {};
      return Object.fromEntries(adultAccessKeys.map((key) => [key, requested[key] === true]));
    }
    return emptyAdultSublibraryAccess();
  };
  const hasAnyAdultAccess = (user = {}) => Object.values(normalizeAdultSublibraryAccess(user)).some(Boolean) || Boolean(user.linkedAdultProfileId && user.role !== "child");
  const adultPermissionKeyForLibrary = (value = "") => {
    const normalized = String(value || "").trim().toLowerCase();
    if (["personal", "girls", "personalprofiles"].includes(normalized)) return "personalProfiles";
    if (["performer", "performers"].includes(normalized)) return "performers";
    if (["celebrity", "celebrities", "celebs"].includes(normalized)) return "celebrities";
    if (["adultphotos", "photos", "nudes", "nudesets"].includes(normalized)) return "adultPhotos";
    if (["adultvideos", "videos", "scenes"].includes(normalized)) return "adultVideos";
    if (["adulttv", "adulttvchannels"].includes(normalized)) return "adultTVChannels";
    return "";
  };
  const parseCookies = (req) => Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key]) => key));
  const subscriptionClientId = (req) => {
    const cookies = parseCookies(req);
    return cookies.homestead_session || cookies.homestead_client_id || crypto.createHash("sha256").update(`${req.ip || "local"}|${req.headers?.["user-agent"] || "browser"}`).digest("hex");
  };
  const normalizeHouseholdId = (value = "") => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const publicUser = (user) => {
    if (!user) return null;
    const { passwordHash, ...safe } = user;
    return safe;
  };
  const audit = (event, actor, details = {}) => {
    const records = readJson(auditPath, []);
    records.push({ id: id("audit"), at: now(), event, actorId: actor?.id || "system", actorName: actor?.displayName || actor?.username || "System", details });
    writeJson(auditPath, records.slice(-2000));
  };

  function ensureAccounts() {
    const current = readJson(accountsPath, null);
    if (current?.users?.length) {
      let changed = false;
      current.users = current.users.map((user) => {
        const isOwner = user.id === current.ownerId || user.role === "owner";
        const canReceiveAdultAccess = user.role === "admin" || user.role === "member";
        const adultAccessMode = isOwner ? "full" : (canReceiveAdultAccess ? normalizeAdultAccessMode(user) : "none");
        const adultSublibraryAccess = isOwner ? fullAdultSublibraryAccess() : normalizeAdultSublibraryAccess({ ...user, adultAccessMode });
        const requestedFullAdultAccess = adultAccessMode === "full";
        const allowedLibraries = Array.isArray(user.allowedLibraries) ? user.allowedLibraries.map(String) : [];
        const sanitizedLibraries = requestedFullAdultAccess
          ? allowedLibraries
          : allowedLibraries.filter((libraryId) => libraryId !== "adult");
        const next = {
          ...user,
          signInRequired: user.signInRequired !== false,
          fullAdultAccess: requestedFullAdultAccess,
          adultAccessMode,
          adultSublibraryAccess,
          allowedLibraries: isOwner ? ["*"] : sanitizedLibraries,
          householdId: normalizeHouseholdId(user.householdId || (isOwner ? "primary-home" : "")),
          linkedAdultProfileId: user.role === "child" ? "" : String(user.linkedAdultProfileId || ""),
          linkedAdultProfileConfirmed18Plus: user.role === "child" ? false : Boolean(user.linkedAdultProfileId),
        };
        if (JSON.stringify(next) !== JSON.stringify(user)) changed = true;
        return next;
      });
      if (changed) writeJson(accountsPath, current);
      return current;
    }
    const setup = readSetupConfig() || {};
    const admin = setup.adminAccount || {};
    const owner = {
      id: "owner",
      username: String(admin.username || "owner").trim() || "owner",
      displayName: String(admin.displayName || admin.username || "Homestead Owner").trim(),
      email: String(admin.email || "").trim(),
      role: "owner",
      status: "active",
      passwordHash: admin.passwordHash || "",
      passwordConfigured: Boolean(admin.passwordHash || admin.passwordConfigured),
      signInRequired: true,
      aiAccess: false,
      aiModel: "",
      allowedLibraries: ["*"],
      householdId: "primary-home",
      fullAdultAccess: true,
      adultAccessMode: "full",
      adultSublibraryAccess: fullAdultSublibraryAccess(),
      linkedAdultProfileId: "",
      linkedAdultProfileConfirmed18Plus: false,
      childControls: null,
      createdAt: now(), updatedAt: now(),
    };
    const state = { version: 1, authEnabled: false, ownerId: owner.id, users: [owner], invites: [] };
    writeJson(accountsPath, state);
    audit("accounts.bootstrap", owner, { migratedFromSetup: true });
    return state;
  }

  function currentUser(req) {
    const state = ensureAccounts();
    const token = parseCookies(req).homestead_session;
    const sessions = readJson(sessionsPath, []);
    const session = sessions.find((item) => item.token === token && new Date(item.expiresAt).getTime() > Date.now());
    const resolved = state.users.find((user) => user.id === session?.userId && user.status === "active") || (!state.authEnabled ? state.users.find((user) => user.id === state.ownerId) : null);
    if (resolved && resolved.id !== state.ownerId && !subscriptionService.has("multiUser")) return null;
    return resolved;
  }
  const hasFullAdultAccess = (user) => Boolean(user && normalizeAdultAccessMode(user) === "full");
  const linkedAdultProfileId = (user) => user?.role === "child" ? "" : String(user?.linkedAdultProfileId || "").trim();
  const mediaLibraryPermission = (libraryId) => ({ tv: "tvshows", livetv: "liveTV", girls: "adult", personal: "adult", performers: "adult", celebrities: "adult", adult: "adult" }[String(libraryId || "").toLowerCase()] || String(libraryId || ""));
  const configuredLibraryEnabled = (libraryId) => {
    if (!subscriptionService.allowsLibrary(libraryId)) return false;
    const setup = readSetupConfig() || {};
    const enabled = setup.enabledLibraries || {};
    const family = setup.familySublibraries || {};
    const normalized = String(libraryId || "").trim().toLowerCase();
    if (normalized === "family-home" || normalized === "familyarchive") return enabled.family === true && family.familyArchive !== false;
    if (normalized === "family") return enabled.family === true;
    return true;
  };
  const canAccessLibrary = (user, libraryId) => {
    if (!configuredLibraryEnabled(libraryId)) return false;
    if (!user || user.role === "owner" || user.allowedLibraries?.includes("*")) return true;
    return (user.allowedLibraries || []).includes(mediaLibraryPermission(libraryId));
  };
  const accessContext = (req) => {
    const user = currentUser(req);
    return {
      user,
      authenticated: Boolean(user),
      fullAdultAccess: hasFullAdultAccess(user),
      adultAccessMode: normalizeAdultAccessMode(user),
      adultSublibraryAccess: normalizeAdultSublibraryAccess(user),
      linkedAdultProfileId: linkedAdultProfileId(user),
      subscription: subscriptionService.status(),
    };
  };
  const ownerOnly = (req, res, next) => {
    const user = currentUser(req);
    if (user?.role !== "owner") return res.status(403).json({ ok: false, message: "Owner access is required." });
    req.homesteadUser = user;
    next();
  };
  const accountAdminOnly = (req, res, next) => {
    const user = currentUser(req);
    if (!["owner", "admin"].includes(user?.role)) return res.status(403).json({ ok: false, message: "Administrator access is required." });
    req.homesteadUser = user;
    next();
  };
  const normalizeAdultRecommendationPreferences = (value = {}) => {
    const allowedHeights = new Set(["short", "medium", "tall"]);
    const bodyTypes = Array.isArray(value.bodyTypes) ? value.bodyTypes : ["petite"];
    const breastShapes = Array.isArray(value.breastShapes) ? value.breastShapes : ["perky"];
    const heightCategories = Array.isArray(value.heightCategories) ? value.heightCategories : ["short", "medium"];
    const ethnicityInclude = Array.isArray(value.ethnicityInclude) ? value.ethnicityInclude : [];
    const ethnicityExclude = Array.isArray(value.ethnicityExclude) ? value.ethnicityExclude : [];
    const minAge = Math.max(18, Math.min(100, Number(value.minAge ?? 18) || 18));
    const maxAge = Math.max(minAge, Math.min(100, Number(value.maxAge ?? 35) || 35));
    return {
      enabled: value.enabled !== false,
      gender: ["female", "male", "nonbinary", "any"].includes(value.gender) ? value.gender : "female",
      bodyTypes: bodyTypes.map(String).map((item) => item.trim().toLowerCase()).filter(Boolean).slice(0, 8),
      breastShapes: breastShapes.map(String).map((item) => item.trim().toLowerCase()).filter(Boolean).slice(0, 8),
      heightCategories: heightCategories.map(String).filter((item) => allowedHeights.has(item)).slice(0, 3),
      ethnicityInclude: ethnicityInclude.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 16),
      ethnicityExclude: ethnicityExclude.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 16),
      includeUnknownEthnicity: value.includeUnknownEthnicity !== false,
      maxWeight: Math.max(0, Math.min(1000, Number(value.maxWeight ?? 125) || 0)),
      pantySizeMax: String(value.pantySizeMax ?? "M").trim().slice(0, 20),
      braBandMax: Math.max(0, Math.min(80, Number(value.braBandMax ?? 36) || 0)),
      cupSizeMax: String(value.cupSizeMax ?? "B").trim().toUpperCase().slice(0, 4),
      minAge,
      maxAge,
      requirePoster: value.requirePoster !== false,
      matchMode: value.matchMode === "compatible" ? "compatible" : "strict",
    };
  };
  const normalizeAccountPreferences = (value = {}, existing = {}) => ({
    ...existing,
    displayPreferences: Object.fromEntries(Object.entries({ ...existing.displayPreferences, ...value.displayPreferences }).filter(([key, value]) => ({ dateFormat: ["MMM_D_YYYY", "MM_DD_YYYY_DASH", "MM_DD_YYYY_SLASH", "YYYY_MM_DD_SLASH", "YYYY_MM_DD_DASH", "D_MMM_YYYY", "MMM_D"], heightFormat: ["FT_IN_DASH", "INCHES", "CM"], weightFormat: ["LBS", "KG"], measurementFormat: ["INCHES", "CM"] }[key] || []).includes(value))),
    adultRecommendations: normalizeAdultRecommendationPreferences(value.adultRecommendations || existing.adultRecommendations || {}),
    adultEmptyStates: {
      photos: String(value.adultEmptyStates?.photos ?? existing.adultEmptyStates?.photos ?? "No sex photos found yet.").trim().slice(0, 220),
      videos: String(value.adultEmptyStates?.videos ?? existing.adultEmptyStates?.videos ?? "No sex videos found yet.").trim().slice(0, 220),
    },
    pluginSearch: Object.fromEntries(
      Object.entries({ ...(existing.pluginSearch || {}), ...(value.pluginSearch || {}) })
        .filter(([pluginId]) => /^[a-z0-9][a-z0-9._-]{1,63}$/i.test(pluginId))
        .map(([pluginId, enabled]) => [pluginId, enabled === true])
    ),
    calendarSourceVisibility: Object.fromEntries(
      Object.entries({ ...(existing.calendarSourceVisibility || {}), ...(value.calendarSourceVisibility || {}) })
        .filter(([sourceId]) => /^calendar-source-[a-z0-9-]{4,120}$/i.test(sourceId))
        .map(([sourceId, visible]) => [sourceId, visible !== false])
    ),
    calendarSourceTitleFormats: Object.fromEntries(
      Object.entries({ ...(existing.calendarSourceTitleFormats || {}), ...(value.calendarSourceTitleFormats || {}) })
        .filter(([sourceId, format]) => /^calendar-source-[a-z0-9-]{4,120}$/i.test(sourceId) && ["series", "episode"].includes(format))
        .map(([sourceId, format]) => [sourceId, format])
    ),
    calendarKindVisibility: Object.fromEntries(Object.entries({ ...(existing.calendarKindVisibility || {}), ...(value.calendarKindVisibility || {}) }).filter(([kind]) => /^[a-z0-9-]{1,40}$/i.test(kind)).map(([kind, visible]) => [kind, visible !== false])),
    calendarHiddenSonarrShows: Object.fromEntries(Object.entries({ ...(existing.calendarHiddenSonarrShows || {}), ...(value.calendarHiddenSonarrShows || {}) }).filter(([title]) => String(title).trim().length > 0 && String(title).length <= 240).slice(0, 2000).map(([title, hidden]) => [String(title), hidden === true])),
    calendarView: ["day", "week", "month", "year"].includes(value.calendarView) ? value.calendarView : (["day", "week", "month", "year"].includes(existing.calendarView) ? existing.calendarView : "week"),
    calendarPersonFilter: String(value.calendarPersonFilter ?? existing.calendarPersonFilter ?? "all").trim().slice(0, 120) || "all",
  });

  app.get("/api/platform", (req, res) => {
    const setup = readSetupConfig() || {};
    const configuredOrigin = String(process.env.HOMESTEAD_PUBLIC_ORIGIN || setup.network?.publicOrigin || "").replace(/\/$/, "");
    const subscription = subscriptionService.status();
    res.json({ ok: true, platform: {
      version: "0.6.8.64",
      edition: subscription.tier,
      planLabel: subscription.name,
      publicOrigin: configuredOrigin,
      publicHostnameConfigured: Boolean(configuredOrigin),
      publicHostnamePlaceholder: "https://homestead.example.com",
      authEnabled: ensureAccounts().authEnabled,
      secureCookies: /^https:\/\//i.test(configuredOrigin),
      trustedProxy: process.env.HOMESTEAD_TRUST_PROXY || "loopback",
      subscription,
    }});
  });

  app.get("/api/subscription/status", (req, res) => {
    res.json({ ok: true, subscription: subscriptionService.status() });
  });

  app.post("/api/subscription/playback", (req, res) => {
    const clientId = subscriptionClientId(req);
    if (req.body?.active === false) {
      subscriptionService.releaseStream(clientId);
      return res.json({ ok: true, active: false });
    }
    const claim = subscriptionService.claimStream({ clientId, mediaKey: String(req.body?.mediaKey || "browser-playback") });
    if (!claim.allowed) return res.status(429).json({ ok: false, code: claim.code, limit: claim.limit, message: "Homestead Free supports one active stream at a time." });
    return res.json({ ok: true, active: true });
  });

  app.get("/api/auth/session", (req, res) => {
    const state = ensureAccounts();
    const cookies = parseCookies(req);
    if (!/^[a-f0-9]{32}$/i.test(String(cookies.homestead_client_id || ""))) {
      res.setHeader("Set-Cookie", `homestead_client_id=${crypto.randomBytes(16).toString("hex")}; Path=/; SameSite=Lax; Max-Age=31536000`);
    }
    res.json({ ok: true, authEnabled: state.authEnabled, user: publicUser(currentUser(req)), subscription: subscriptionService.status() });
  });
  app.get("/api/account/preferences", (req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ ok: false, message: "Sign in to Homestead." });
    res.json({ ok: true, preferences: normalizeAccountPreferences(user.preferences || {}, user.preferences || {}) });
  });
  app.patch("/api/account/preferences", (req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ ok: false, message: "Sign in to Homestead." });
    const state = ensureAccounts();
    const index = state.users.findIndex((item) => item.id === user.id);
    if (index < 0) return res.status(404).json({ ok: false, message: "Account not found." });
    const preferences = normalizeAccountPreferences(req.body?.preferences || {}, state.users[index].preferences || {});
    state.users[index] = { ...state.users[index], preferences, updatedAt: now() };
    writeJson(accountsPath, state);
    audit("account.preferences.updated", user, { sections: Object.keys(req.body?.preferences || {}) });
    res.json({ ok: true, preferences });
  });
  app.get("/api/books/edition-links", (req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ ok: false, message: "Sign in to Homestead." });
    const records = readJson(bookEditionLinksPath, {});
    res.json({ ok: true, links: records[user.id] || {} });
  });
  app.put("/api/books/edition-links", express.json({ limit: "256kb" }), (req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ ok: false, message: "Sign in to Homestead." });
    const incoming = req.body?.links && typeof req.body.links === "object" && !Array.isArray(req.body.links) ? req.body.links : {};
    const links = Object.fromEntries(Object.entries(incoming)
      .map(([recordId, groupId]) => [String(recordId).trim().slice(0, 600), String(groupId).trim().slice(0, 600)])
      .filter(([recordId, groupId]) => recordId && groupId)
      .slice(0, 5000));
    const records = readJson(bookEditionLinksPath, {});
    records[user.id] = links;
    writeJson(bookEditionLinksPath, records);
    audit("books.edition-links.updated", user, { linkedRecords: Object.keys(links).length });
    res.json({ ok: true, links });
  });
  app.post("/api/auth/login", (req, res) => {
    const state = ensureAccounts();
    const user = state.users.find((item) => item.username.toLowerCase() === String(req.body?.username || "").trim().toLowerCase() && item.status === "active");
    const credentialsValid = user && (user.signInRequired === false
      ? String(req.body?.password || "") === "" || verifyPassword(req.body?.password || "", user.passwordHash)
      : verifyPassword(req.body?.password || "", user.passwordHash));
    if (!credentialsValid) return res.status(401).json({ ok: false, message: "Invalid username or password." });
    if (user.id !== state.ownerId && !subscriptionService.has("multiUser")) {
      return res.status(402).json({ ok: false, code: "SUBSCRIPTION_REQUIRED", feature: "multiUser", currentTier: subscriptionService.status().tier, message: "Homestead Family is required for additional user accounts." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    const sessions = readJson(sessionsPath, []).filter((item) => new Date(item.expiresAt).getTime() > Date.now());
    sessions.push({ token, userId: user.id, createdAt: now(), expiresAt, ip: req.ip });
    writeJson(sessionsPath, sessions);
    const secure = /^https:\/\//i.test(String(process.env.HOMESTEAD_PUBLIC_ORIGIN || readSetupConfig()?.network?.publicOrigin || ""));
    res.setHeader("Set-Cookie", `homestead_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? "; Secure" : ""}`);
    audit("auth.login", user, { ip: req.ip });
    res.json({ ok: true, user: publicUser(user) });
  });
  app.post("/api/auth/logout", (req, res) => {
    const token = parseCookies(req).homestead_session;
    writeJson(sessionsPath, readJson(sessionsPath, []).filter((item) => item.token !== token));
    res.setHeader("Set-Cookie", "homestead_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    res.json({ ok: true });
  });
  app.post("/api/accounts/complete-owner-setup", (req, res) => {
    const state = ensureAccounts();
    const ownerIndex = state.users.findIndex((item) => item.id === state.ownerId || item.role === "owner");
    if (ownerIndex < 0) return res.status(500).json({ ok: false, message: "Owner account is unavailable." });
    const username = String(req.body?.username || state.users[ownerIndex].username || "owner").trim();
    const password = String(req.body?.password || "");
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(username)) return res.status(400).json({ ok: false, message: "Username must be 3–32 letters, numbers, dots, dashes, or underscores." });
    if (password.length < 8) return res.status(400).json({ ok: false, message: "Use a password with at least 8 characters." });
    state.users[ownerIndex] = {
      ...state.users[ownerIndex],
      username,
      displayName: String(req.body?.displayName || state.users[ownerIndex].displayName || username).trim(),
      passwordHash: hashPassword(password),
      passwordConfigured: true,
      signInRequired: true,
      updatedAt: now(),
    };
    state.authEnabled = true;
    writeJson(accountsPath, state);
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    writeJson(sessionsPath, [{ token, userId: state.users[ownerIndex].id, createdAt: now(), expiresAt, ip: req.ip }]);
    const setup = readSetupConfig() || {};
    writeSetupConfig({ ...setup, adminAccount: { ...(setup.adminAccount || {}), username, displayName: state.users[ownerIndex].displayName, passwordConfigured: true } });
    const secure = /^https:\/\//i.test(String(process.env.HOMESTEAD_PUBLIC_ORIGIN || setup.network?.publicOrigin || ""));
    res.setHeader("Set-Cookie", `homestead_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? "; Secure" : ""}`);
    audit("accounts.owner-setup-completed", state.users[ownerIndex], { authEnabled: true });
    res.json({ ok: true, authEnabled: true, user: publicUser(state.users[ownerIndex]) });
  });

  app.get("/api/accounts", accountAdminOnly, subscriptionService.requireFeature("multiUser"), (req, res) => {
    const state = ensureAccounts();
    res.json({ ok: true, authEnabled: state.authEnabled, users: state.users.map(publicUser), invites: state.invites || [] });
  });
  app.post("/api/accounts/auth-enabled", ownerOnly, (req, res) => {
    const state = ensureAccounts();
    const owner = state.users.find((item) => item.id === state.ownerId);
    if (req.body?.enabled && !owner?.passwordHash) return res.status(400).json({ ok: false, message: "Set the owner password before requiring sign-in." });
    state.authEnabled = req.body?.enabled === true;
    writeJson(accountsPath, state); audit("auth.mode.changed", req.homesteadUser, { enabled: state.authEnabled });
    res.json({ ok: true, authEnabled: state.authEnabled });
  });
  app.post("/api/accounts", accountAdminOnly, subscriptionService.requireFeature("multiUser"), (req, res) => {
    const state = ensureAccounts();
    const role = ["admin", "member", "child"].includes(req.body?.role) ? req.body.role : "member";
    const username = String(req.body?.username || "").trim();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(username)) return res.status(400).json({ ok: false, message: "Username must be 3–32 letters, numbers, dots, dashes, or underscores." });
    if (state.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ ok: false, message: "That username already exists." });
    const linkedProfileId = role === "child" ? "" : String(req.body?.linkedAdultProfileId || "").trim();
    if (linkedProfileId && req.body?.linkedAdultProfileConfirmed18Plus !== true) return res.status(400).json({ ok: false, message: "Confirm that the linked personal profile belongs to an adult (18+)." });
    const requestedMode = role === "child" ? "none" : String(req.body?.adultAccessMode || (req.body?.fullAdultAccess ? "full" : linkedProfileId ? "linked-profile" : "none"));
    const adultAccessMode = ["full", "performers-celebrities", "custom", "linked-profile", "none"].includes(requestedMode) ? requestedMode : "none";
    const adultSublibraryAccess = normalizeAdultSublibraryAccess({ role, adultAccessMode, adultSublibraryAccess: req.body?.adultSublibraryAccess });
    const fullAdultAccess = adultAccessMode === "full";
    const requestedLibraries = Array.isArray(req.body?.allowedLibraries) ? req.body.allowedLibraries.map(String) : [];
    const allowedLibraries = fullAdultAccess ? [...new Set([...requestedLibraries, "adult"])] : requestedLibraries.filter((libraryId) => libraryId !== "adult");
    const user = {
      id: id("user"), username, displayName: String(req.body?.displayName || username).trim(), email: String(req.body?.email || "").trim(), role, status: "active",
      passwordHash: req.body?.password ? hashPassword(req.body.password) : "", passwordConfigured: Boolean(req.body?.password),
      signInRequired: req.body?.signInRequired !== false,
      householdId: normalizeHouseholdId(req.body?.householdId),
      allowedLibraries,
      fullAdultAccess,
      adultAccessMode,
      adultSublibraryAccess,
      aiAccess: req.body?.aiAccess === true, aiModel: req.body?.aiAccess === true ? String(req.body?.aiModel || "") : "",
      linkedAdultProfileId: adultAccessMode === "linked-profile" ? linkedProfileId : "", linkedAdultProfileConfirmed18Plus: Boolean(linkedProfileId && adultAccessMode === "linked-profile"),
      childControls: role === "child" ? { dailyMinutes: Math.max(0, Number(req.body?.dailyMinutes || 60)), bedtimeStart: String(req.body?.bedtimeStart || "20:00"), bedtimeEnd: String(req.body?.bedtimeEnd || "07:00"), requireApproval: req.body?.requireApproval !== false } : null,
      createdAt: now(), updatedAt: now(),
    };
    state.users.push(user); writeJson(accountsPath, state); audit("account.created", req.homesteadUser, { userId: user.id, role });
    res.status(201).json({ ok: true, user: publicUser(user) });
  });
  app.patch("/api/accounts/:userId", accountAdminOnly, subscriptionService.requireFeature("multiUser"), (req, res) => {
    const state = ensureAccounts();
    const index = state.users.findIndex((item) => item.id === req.params.userId);
    if (index < 0) return res.status(404).json({ ok: false, message: "User not found." });
    const existing = state.users[index];
    if (req.homesteadUser.role === "admin" && existing.role === "owner") return res.status(403).json({ ok: false, message: "Administrators cannot edit the owner." });
    if (existing.id === state.ownerId && req.body?.role && req.body.role !== "owner") return res.status(400).json({ ok: false, message: "The Homestead owner role cannot be removed." });
    const role = existing.id === state.ownerId ? "owner" : (["admin", "member", "child"].includes(req.body?.role) ? req.body.role : existing.role);
    const linked = role === "child" ? "" : String(req.body?.linkedAdultProfileId ?? existing.linkedAdultProfileId ?? "").trim();
    if (linked && req.body?.linkedAdultProfileConfirmed18Plus === false) return res.status(400).json({ ok: false, message: "An adult profile link requires 18+ confirmation." });
    const requestedMode = role === "owner" ? "full" : role === "child" ? "none" : String(req.body?.adultAccessMode || (req.body?.fullAdultAccess ? "full" : linked ? "linked-profile" : existing.adultAccessMode || "none"));
    const adultAccessMode = ["full", "performers-celebrities", "custom", "linked-profile", "none"].includes(requestedMode) ? requestedMode : "none";
    const adultSublibraryAccess = normalizeAdultSublibraryAccess({ role, adultAccessMode, adultSublibraryAccess: req.body?.adultSublibraryAccess ?? existing.adultSublibraryAccess });
    const fullAdultAccess = adultAccessMode === "full";
    const requestedLibraries = Array.isArray(req.body?.allowedLibraries) ? req.body.allowedLibraries.map(String) : (existing.allowedLibraries || []);
    const allowedLibraries = role === "owner" ? ["*"] : fullAdultAccess ? [...new Set([...requestedLibraries, "adult"])] : requestedLibraries.filter((libraryId) => libraryId !== "adult");
    state.users[index] = { ...existing, ...req.body, id: existing.id, username: existing.username, role, householdId: normalizeHouseholdId(req.body?.householdId ?? existing.householdId), allowedLibraries, fullAdultAccess, adultAccessMode, adultSublibraryAccess, linkedAdultProfileId: adultAccessMode === "linked-profile" ? linked : "", linkedAdultProfileConfirmed18Plus: Boolean(linked && adultAccessMode === "linked-profile"), passwordHash: req.body?.password ? hashPassword(req.body.password) : existing.passwordHash, passwordConfigured: Boolean(req.body?.password || existing.passwordHash), aiAccess: req.body?.aiAccess === true, aiModel: req.body?.aiAccess === true ? String(req.body?.aiModel || existing.aiModel || "") : "", updatedAt: now() };
    delete state.users[index].password;
    writeJson(accountsPath, state); audit("account.updated", req.homesteadUser, { userId: existing.id, fields: Object.keys(req.body || {}).filter((key) => key !== "password") });
    res.json({ ok: true, user: publicUser(state.users[index]) });
  });
  app.delete("/api/accounts/:userId", accountAdminOnly, subscriptionService.requireFeature("multiUser"), (req, res) => {
    const state = ensureAccounts();
    if (req.params.userId === state.ownerId) return res.status(400).json({ ok: false, message: "The owner account cannot be deleted." });
    const before = state.users.length; state.users = state.users.filter((item) => item.id !== req.params.userId);
    if (state.users.length === before) return res.status(404).json({ ok: false, message: "User not found." });
    writeJson(accountsPath, state); audit("account.deleted", req.homesteadUser, { userId: req.params.userId });
    res.json({ ok: true });
  });
  app.get("/api/accounts/audit", ownerOnly, (req, res) => res.json({ ok: true, records: readJson(auditPath, []).slice(-250).reverse() }));

  const safeCloudPath = (value = "") => {
    const relative = String(value).replaceAll("\\", "/").replace(/^\/+/, "");
    const resolved = path.resolve(cloudRoot, relative);
    if (resolved !== cloudRoot && !resolved.startsWith(`${cloudRoot}${path.sep}`)) throw new Error("Invalid cloud path.");
    return { relative, resolved };
  };
  const cloudState = () => readJson(cloudPath, { version: 1, providers: [], shares: [], devices: [], syncJobs: [] });
  app.get("/api/cloud", subscriptionService.requireFeature("cloud"), (req, res) => {
    const state = cloudState();
    let usedBytes = 0, fileCount = 0;
    const walk = (directory) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isDirectory()) walk(target); else { usedBytes += fs.statSync(target).size; fileCount += 1; } } };
    walk(cloudRoot);
    res.json({ ok: true, summary: { usedBytes, fileCount, providerCount: state.providers.filter((item) => item.enabled).length, shareCount: state.shares.length }, ...state });
  });
  app.get("/api/cloud/files", subscriptionService.requireFeature("cloud"), (req, res) => {
    try {
      const target = safeCloudPath(req.query?.path || "");
      fs.mkdirSync(target.resolved, { recursive: true });
      const files = fs.readdirSync(target.resolved, { withFileTypes: true }).map((entry) => { const filePath = path.join(target.resolved, entry.name); const stat = fs.statSync(filePath); return { name: entry.name, path: path.posix.join(target.relative, entry.name), type: entry.isDirectory() ? "folder" : "file", size: entry.isFile() ? stat.size : 0, modifiedAt: stat.mtime.toISOString() }; }).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
      res.json({ ok: true, path: target.relative, files });
    } catch (error) { res.status(400).json({ ok: false, message: error.message }); }
  });
  app.post("/api/cloud/folders", subscriptionService.requireFeature("cloud"), (req, res) => {
    try { const target = safeCloudPath(path.posix.join(String(req.body?.path || ""), String(req.body?.name || ""))); if (!path.basename(target.relative) || /[<>:"|?*]/.test(path.basename(target.relative))) throw new Error("Enter a valid folder name."); fs.mkdirSync(target.resolved, { recursive: false }); res.status(201).json({ ok: true, path: target.relative }); } catch (error) { res.status(400).json({ ok: false, message: error.message }); }
  });
  app.post("/api/cloud/upload", subscriptionService.requireFeature("cloud"), express.raw({ type: () => true, limit: "2gb" }), (req, res) => {
    try { const target = safeCloudPath(path.posix.join(String(req.get("x-cloud-path") || ""), path.basename(String(req.get("x-cloud-filename") || "upload.bin")))); fs.mkdirSync(path.dirname(target.resolved), { recursive: true }); fs.writeFileSync(target.resolved, req.body); res.status(201).json({ ok: true, file: { name: path.basename(target.resolved), path: target.relative, size: req.body.length } }); } catch (error) { res.status(400).json({ ok: false, message: error.message }); }
  });
  app.get("/api/cloud/download", subscriptionService.requireFeature("cloud"), (req, res) => { try { const target = safeCloudPath(req.query?.path || ""); if (!fs.statSync(target.resolved).isFile()) throw new Error("File not found."); res.download(target.resolved); } catch (error) { res.status(404).json({ ok: false, message: error.message }); } });
  app.delete("/api/cloud/files", ownerOnly, subscriptionService.requireFeature("cloud"), (req, res) => { try { const target = safeCloudPath(req.query?.path || ""); if (target.resolved === cloudRoot) throw new Error("The Cloud root cannot be deleted."); fs.rmSync(target.resolved, { recursive: true, force: false }); audit("cloud.deleted", req.homesteadUser, { path: target.relative }); res.json({ ok: true }); } catch (error) { res.status(400).json({ ok: false, message: error.message }); } });
  app.put("/api/cloud/providers/:providerId", ownerOnly, subscriptionService.requireFeature("cloud"), (req, res) => { const state = cloudState(); const provider = { id: req.params.providerId, name: String(req.body?.name || req.params.providerId), type: String(req.body?.type || "webdav"), enabled: req.body?.enabled === true, endpoint: String(req.body?.endpoint || ""), rootPath: String(req.body?.rootPath || ""), username: String(req.body?.username || ""), secretConfigured: Boolean(req.body?.secret || req.body?.secretConfigured), updatedAt: now() }; const index = state.providers.findIndex((item) => item.id === provider.id); if (index >= 0) state.providers[index] = { ...state.providers[index], ...provider }; else state.providers.push(provider); writeJson(cloudPath, state); audit("cloud.provider.updated", req.homesteadUser, { providerId: provider.id, enabled: provider.enabled }); res.json({ ok: true, provider }); });

  const arrServices = ["jellyseerr", "radarr", "sonarr", "bazarr", "prowlarr", "deluge", "lidarr", "readarr", "whisparr"];
  app.get("/api/automation", subscriptionService.requireFeature("automation"), async (req, res) => {
    const setup = readSetupConfig() || {};
    const stored = readJson(automationPath, { version: 1, rules: [], runs: [] });
    const services = arrServices.map((serviceId) => { const config = setup.integrationSettings?.[serviceId] || {}; return { id: serviceId, name: serviceId === "jellyseerr" ? "Jellyseerr" : serviceId.charAt(0).toUpperCase() + serviceId.slice(1), configured: Boolean(config.url), enabled: config.enabled !== false && Boolean(config.url), url: String(config.url || ""), apiKeyConfigured: Boolean(config.apiKey), status: config.url ? "configured" : "not-configured" }; });
    res.json({ ok: true, services, rules: stored.rules, runs: stored.runs.slice(-50).reverse() });
  });
  app.post("/api/automation/rules", ownerOnly, subscriptionService.requireFeature("automation"), (req, res) => { const state = readJson(automationPath, { version: 1, rules: [], runs: [] }); const rule = { id: id("rule"), name: String(req.body?.name || "New automation").trim(), trigger: String(req.body?.trigger || "manual"), action: String(req.body?.action || "notify"), serviceId: arrServices.includes(req.body?.serviceId) ? req.body.serviceId : "jellyseerr", enabled: req.body?.enabled !== false, requireApproval: req.body?.requireApproval !== false, createdAt: now(), updatedAt: now() }; state.rules.push(rule); writeJson(automationPath, state); audit("automation.rule.created", req.homesteadUser, { ruleId: rule.id }); res.status(201).json({ ok: true, rule }); });
  app.patch("/api/automation/rules/:ruleId", ownerOnly, subscriptionService.requireFeature("automation"), (req, res) => { const state = readJson(automationPath, { version: 1, rules: [], runs: [] }); const index = state.rules.findIndex((item) => item.id === req.params.ruleId); if (index < 0) return res.status(404).json({ ok: false, message: "Rule not found." }); state.rules[index] = { ...state.rules[index], ...req.body, id: state.rules[index].id, updatedAt: now() }; writeJson(automationPath, state); audit("automation.rule.updated", req.homesteadUser, { ruleId: req.params.ruleId }); res.json({ ok: true, rule: state.rules[index] }); });
  app.delete("/api/automation/rules/:ruleId", ownerOnly, subscriptionService.requireFeature("automation"), (req, res) => { const state = readJson(automationPath, { version: 1, rules: [], runs: [] }); state.rules = state.rules.filter((item) => item.id !== req.params.ruleId); writeJson(automationPath, state); audit("automation.rule.deleted", req.homesteadUser, { ruleId: req.params.ruleId }); res.json({ ok: true }); });

  // Everything registered after this point is part of Homestead's protected
  // API surface once the owner enables required sign-in.
  app.use("/api", (req, res, next) => {
    const state = ensureAccounts();
    const access = accessContext(req);
    if (state.authEnabled && !access.user) return res.status(401).json({ ok: false, code: "AUTH_REQUIRED", message: "Sign in to Homestead." });
    if (!access.user || access.fullAdultAccess) return next();

    const isAdultApi = /^\/(?:adult)(?:\/|$)/i.test(req.path);
    const isAdultMetadataApi = /^\/metadata\/adult(?:\/|$)/i.test(req.path);
    const isPersonalProfileCreate = req.method !== "GET" && /^\/profiles\/personal(?:\/|$)/i.test(req.path);
    const isAdultProfileMetadata = /^\/profiles\/metadata(?:\/|$)/i.test(req.path);
    if ((isAdultApi || isAdultMetadataApi || isPersonalProfileCreate) && req.method !== "GET") {
      return res.status(403).json({ ok: false, code: "ADULT_LIBRARY_WRITE_FORBIDDEN", message: "Only an administrator can change Adult profiles, metadata, or media." });
    }
    if (isAdultApi && !hasAnyAdultAccess(access.user)) {
      return res.status(403).json({ ok: false, code: "ADULT_LIBRARY_FORBIDDEN", message: "This account does not have Adult library access." });
    }
    if (isAdultProfileMetadata) {
      const requestedProfileId = String(req.query?.profileId || req.query?.id || "").trim();
      const requestedLibrary = String(req.query?.libraryType || req.query?.library || "personal").toLowerCase();
      const permissionKey = adultPermissionKeyForLibrary(requestedLibrary);
      const hasSublibraryAccess = Boolean(permissionKey && access.adultSublibraryAccess?.[permissionKey]);
      const hasLinkedAccess = Boolean(access.linkedAdultProfileId && ["personal", "girls"].includes(requestedLibrary) && requestedProfileId.toLowerCase() === String(access.linkedAdultProfileId).toLowerCase());
      if (!hasSublibraryAccess && !hasLinkedAccess) {
        return res.status(403).json({ ok: false, code: "ADULT_PROFILE_FORBIDDEN", message: "This Personal profile is not linked to your account." });
      }
    }
    return next();
  });

  const authorizePlayback = (req, res, next, mediaKey = "") => {
    if (/^\/api\/media\/probe(?:\/|\?|$)/i.test(String(req.originalUrl || req.url || req.path || ""))) return next();
    if (!/\.(?:mp4|m4v|mov|mkv|webm|ogv|mp3|m4a|aac|flac|wav|ogg|opus)(?:$|[?#])/i.test(mediaKey)) return next();
    const clientId = subscriptionClientId(req);
    const claim = subscriptionService.claimStream({ clientId, mediaKey });
    if (claim.allowed) return next();
    return res.status(429).json({ ok: false, code: claim.code, limit: claim.limit, message: "Homestead Free supports one active stream at a time." });
  };

  return {
    getCurrentUser(req) {
      return currentUser(req) || null;
    },
    listCalendarAudience(req) {
      const requester = currentUser(req);
      if (!requester) return [];
      return ensureAccounts().users.filter((user) => user.status === "active" && canAccessLibrary(user, "calendar")).map((user) => ({ id: user.id, displayName: user.displayName || user.username, householdId: normalizeHouseholdId(user.householdId) }));
    },
    canAccessLibrary(req, libraryId) {
      return canAccessLibrary(currentUser(req), libraryId);
    },
    accessContext,
    recordAudit(event, req, details = {}) {
      audit(event, req?.homesteadUser || currentUser(req), details);
    },
    requireOwner: ownerOnly,
    requireAdmin: accountAdminOnly,
    requireFeature: subscriptionService.requireFeature,
    subscription: subscriptionService,
    requireSession(req, res, next) {
      const state = ensureAccounts();
      const access = accessContext(req);
      if (state.authEnabled && !access.user) return res.status(401).send("Sign in to Homestead.");
      req.homesteadAccess = access;
      next();
    },
    filterMediaIndex(req, index = {}) {
      const configuredIndex = { ...index, libraries: { ...(index.libraries || {}) } };
      const subscriptionLibraryAliases = {
        photos: ["photos"],
        family: ["family"],
        liveTV: ["liveTV", "livetv"],
        adult: ["adult", "personal", "girls", "performers", "celebrities", "adultPhotos", "adultVideos"],
      };
      Object.entries(subscriptionLibraryAliases).forEach(([libraryId, keys]) => {
        if (configuredLibraryEnabled(libraryId)) return;
        keys.forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(configuredIndex, key)) configuredIndex[key] = Array.isArray(configuredIndex[key]) ? [] : {};
          if (Object.prototype.hasOwnProperty.call(configuredIndex.libraries, key)) configuredIndex.libraries[key] = Array.isArray(configuredIndex.libraries[key]) ? [] : {};
        });
      });
      const access = accessContext(req);
      if (!access.user || access.user.role === "owner" || access.user.allowedLibraries?.includes("*")) return configuredIndex;
      const redactProfile = (profile = {}) => {
        const adultAccess = access.adultSublibraryAccess || emptyAdultSublibraryAccess();
        const bodyKeys = ["height", "weight", "weightUnit", "measurements", "measurementsRaw", "bodyMeasurements", "bust", "waist", "hips", "braBand", "cupSize", "braSize", "pantySize", "pantySizeSystem", "shoeSize", "dressSize", "clothingSize", "hairColor", "eyeColor", "tattoos", "piercings", "body", "bodyDetails", "clothingSizes"];
        const privateKeys = ["privateNotes", "profilePrivateNotes", "profileNotes", "privateNoteCards"];
        const timelineKeys = ["timeline", "timelineEntries", "profileTimeline"];
        const strip = (value = {}) => {
          const next = { ...value };
          privateKeys.forEach((key) => delete next[key]);
          if (!adultAccess.bodyDetails) bodyKeys.forEach((key) => delete next[key]);
          if (!adultAccess.timelines) timelineKeys.forEach((key) => delete next[key]);
          return next;
        };
        const next = strip(profile);
        if (profile.metadata && typeof profile.metadata === "object") next.metadata = strip(profile.metadata);
        return next;
      };
      const redactCollection = (collection = {}) => Object.fromEntries(Object.entries(collection || {}).map(([key, profile]) => [key, redactProfile(profile)]));
      const libraries = { ...(configuredIndex.libraries || {}) };
      const filteredIndex = { ...configuredIndex, libraries };
      for (const libraryId of Object.keys(libraries)) {
        if (!["personal", "girls", "performers", "celebrities", "adult"].includes(libraryId.toLowerCase()) && !canAccessLibrary(access.user, libraryId)) {
          libraries[libraryId] = {};
        }
      }
      const topLevelLibraryKeys = {
        movies: ["movies"],
        tvshows: ["tv", "tvShows"],
        books: ["books"],
        music: ["music", "musicArtists"],
        youtube: ["youtube", "youtubeCreators"],
        photos: ["photos"],
        liveTV: ["liveTV", "livetv"],
      };
      const emptyLike = (value) => Array.isArray(value) ? [] : {};
      Object.entries(topLevelLibraryKeys).forEach(([libraryId, keys]) => {
        if (canAccessLibrary(access.user, libraryId)) return;
        keys.forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(filteredIndex, key)) filteredIndex[key] = emptyLike(filteredIndex[key]);
        });
      });
      if (access.fullAdultAccess) return filteredIndex;
      const adultAccess = access.adultSublibraryAccess || emptyAdultSublibraryAccess();
      const linkedNeedle = String(access.linkedAdultProfileId || "").trim().toLowerCase();
      const personalEntries = [
        ...Object.entries(libraries.personal || {}),
        ...Object.entries(libraries.girls || {}),
      ];
      const linkedEntry = linkedNeedle
        ? personalEntries.find(([profileKey, profile]) => {
            const candidates = [profileKey, profile?.id, profile?.profileId, profile?.slug, profile?.name, profile?.title, profile?.displayName]
              .map((value) => String(value || "").trim().toLowerCase())
              .filter(Boolean);
            return candidates.includes(linkedNeedle);
          })
        : null;
      const linkedKey = linkedEntry?.[0] || "";
      const linkedProfile = linkedEntry?.[1] || null;
      libraries.personal = access.adultAccessMode === "linked-profile"
        ? (linkedProfile ? { [linkedKey]: redactProfile(linkedProfile) } : {})
        : adultAccess.personalProfiles ? redactCollection(libraries.personal || {}) : {};
      // Older Homestead scanners wrote Personal profiles under `girls`. Keep the
      // same one-profile view in both aliases so either client generation works.
      libraries.girls = access.adultAccessMode === "linked-profile"
        ? (linkedProfile ? { [linkedKey]: redactProfile(linkedProfile) } : {})
        : adultAccess.personalProfiles ? redactCollection(libraries.girls || {}) : {};
      libraries.performers = adultAccess.performers ? redactCollection(libraries.performers || {}) : {};
      libraries.celebrities = adultAccess.celebrities ? redactCollection(libraries.celebrities || {}) : {};
      libraries.adultPhotos = adultAccess.adultPhotos ? (libraries.adultPhotos || {}) : {};
      libraries.adultVideos = adultAccess.adultVideos ? (libraries.adultVideos || {}) : {};
      return {
        ...filteredIndex,
        libraries,
        personal: libraries.personal,
        girls: {},
        performers: libraries.performers,
        celebrities: libraries.celebrities,
        adultPhotos: libraries.adultPhotos,
        adultVideos: libraries.adultVideos,
      };
    },
    authorizeMedia(req, res, next) {
      const state = ensureAccounts();
      const access = accessContext(req);
      if (state.authEnabled && !access.user) return res.status(401).send("Sign in to Homestead.");
      let decodedPath = String(req.path || "");
      try { decodedPath = decodeURIComponent(decodedPath); } catch { return res.status(400).send("Invalid media path."); }
      const allow = () => authorizePlayback(req, res, next, decodedPath);
      const rootLibrary = decodedPath.match(/^\/([^/]+)(?:\/|$)/)?.[1] || "";
      if (rootLibrary && !subscriptionService.allowsLibrary(rootLibrary)) return res.status(402).send("Your Homestead plan does not include this library.");
      if (!access.user || access.user.role === "owner" || access.user.allowedLibraries?.includes("*")) return allow();
      const match = decodedPath.match(/^\/(personal|girls|performers|celebrities|adult)(?:\/([^/]+))?(?:\/|$)/i);
      if (match) {
        const library = match[1].toLowerCase();
        const profileId = String(match[2] || "");
        if (access.fullAdultAccess) return allow();
        if (/\/(?:metadata|metadata-candidates)\.json$/i.test(decodedPath)) {
          return res.status(403).send("Use the permission-filtered profile metadata API.");
        }
        const permissionKey = adultPermissionKeyForLibrary(library);
        if (permissionKey && access.adultSublibraryAccess?.[permissionKey]) return allow();
        if ((library === "personal" || library === "girls") && access.linkedAdultProfileId && profileId === access.linkedAdultProfileId) return allow();
        return res.status(403).send("This media is outside your linked Personal profile.");
      }
      if (rootLibrary.toLowerCase() === "family" && !configuredLibraryEnabled("family-home")) return res.status(403).send("Family Archive is disabled.");
      if (rootLibrary && !canAccessLibrary(access.user, rootLibrary)) return res.status(403).send("This library is not assigned to your account.");
      return allow();
    },
    authorizeFile(req, res, next) {
      const state = ensureAccounts();
      const access = accessContext(req);
      if (state.authEnabled && !access.user) return res.status(401).send("Sign in to Homestead.");
      let requested = String(req.query?.path || "").replaceAll("\\", "/").toLowerCase();
      try { requested = decodeURIComponent(requested); } catch { return res.status(400).send("Invalid file path."); }
      const allow = () => authorizePlayback(req, res, next, requested);
      const standardMatch = requested.match(/\/(movies|tvshows|tv|books|music|youtube|photos|livetv|family)(?:\/|$)/i);
      if (standardMatch && !subscriptionService.allowsLibrary(standardMatch[1])) return res.status(402).send("Your Homestead plan does not include this library.");
      if (/(?:^|\/)(?:adult|personal|girls|performers|celebrities|adultphotos|adultvideos)(?:\/|$)/i.test(requested) && !subscriptionService.has("adult")) return res.status(402).send("Homestead Pro is required for Adult libraries.");
      if (!access.user || access.user.role === "owner" || access.user.allowedLibraries?.includes("*")) return allow();
      if (standardMatch?.[1]?.toLowerCase() === "family" && !configuredLibraryEnabled("family-home")) return res.status(403).send("Family Archive is disabled.");
      if (standardMatch && !canAccessLibrary(access.user, standardMatch[1])) {
        return res.status(403).send("This library is not assigned to your account.");
      }
      const adultMatch = requested.match(/\/(personal|girls|performers|celebrities|adultphotos|adultvideos)(?:\/([^/]+))?/i)
        || requested.match(/\/adult\/(photos|videos)(?:\/([^/]+))?/i);
      if (!adultMatch) {
        if (/(?:^|\/)adult(?:\/|$)/i.test(requested)) return res.status(403).send("This Adult media is not shared with your account.");
        return allow();
      }
      const library = adultMatch[1].toLowerCase();
      const profileId = String(adultMatch[2] || "");
      if (access.fullAdultAccess) return allow();
      const permissionKey = adultPermissionKeyForLibrary(library);
      if (permissionKey && access.adultSublibraryAccess?.[permissionKey]) return allow();
      if ((library === "personal" || library === "girls") && access.adultAccessMode === "linked-profile" && access.linkedAdultProfileId && profileId === String(access.linkedAdultProfileId).toLowerCase()) return allow();
      return res.status(403).send("This Adult media is not shared with your account.");
    },
  };
}

module.exports = { registerNextVersionRoutes };
