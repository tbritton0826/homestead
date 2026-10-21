import js from '@eslint/js';
import globals from 'globals';
export default [
  { files: ["src/server/pet-photo-groups.cjs", "src/server/pet-profile-worker.cjs", "scripts/test-v318.cjs"], languageOptions: { sourceType: "commonjs", globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ["scripts/verify-v318-browser.mjs"], languageOptions: { globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ["src/utils/client-request-id.js"], languageOptions: { globals: globals.browser }, rules: js.configs.recommended.rules },
  { files: ["scripts/test-v317.cjs"], languageOptions: { sourceType: "commonjs", globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ["src/utils/media-folder-tabs.js", "scripts/verify-v317-browser.mjs"], languageOptions: { globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ["src/server/profile-import-artwork.cjs", "scripts/test-profile-wizard-artwork.cjs"], languageOptions: { sourceType: "commonjs", globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ["scripts/verify-profile-wizard-browser.mjs"], languageOptions: { globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ["src/server/photo-library.cjs", "src/server/image-preview.cjs", "scripts/test-v315.cjs"], languageOptions: { sourceType: "commonjs", globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ['src/server/tcg-price-lookup.cjs', 'scripts/test-v314.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ['scripts/verify-book-reader-browser.mjs'], languageOptions: { globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ['scripts/verify-tcg-intake-browser.mjs'], languageOptions: { globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ['src/server/native-inventory.cjs', 'src/server/tcg-pricing.cjs', 'src/server/tcg-organizations.cjs', 'scripts/test-native-inventory.cjs', 'scripts/test-tcg-intake.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ['src/server/pet-profiles.cjs', 'src/server/comfy-bridge.cjs', 'scripts/test-ios-v37.cjs', 'scripts/test-book-format-recovery.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ['src/utils/mobile-polish.js'], languageOptions: { globals: globals.browser }, rules: js.configs.recommended.rules },
  { files: ['src/server/recipe-edit.cjs', 'scripts/test-mobile-v12.cjs', 'src/server/profile-media-folders.cjs', 'src/server/book-local-files.cjs', 'scripts/test-ios-v36.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node }, rules: js.configs.recommended.rules },
];
