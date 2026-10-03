// Synthetic, non-explicit visual fixtures. Start the isolated checkout API on 7313 first.
// Then: node scripts/visual-public-ui.mjs; browser audit at http://localhost:7314/.
process.env.HOMESTEAD_PROFILE_VISUAL = '1';
process.env.HOMESTEAD_PROFILE_PROFILES = '4';
await import('./profile-public-ui.mjs');
