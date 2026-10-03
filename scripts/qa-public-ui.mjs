// Opt-in synthetic QA data; upload/provider outcomes never reach a real provider.
process.env.HOMESTEAD_QA_EDGES = "1";
await import("./visual-public-ui.mjs");
