import js from '@eslint/js';
import globals from 'globals';
export default [
  { files: ['src/server/pet-profiles.cjs', 'src/server/comfy-bridge.cjs', 'scripts/test-ios-v37.cjs', 'scripts/test-book-format-recovery.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ['src/utils/mobile-polish.js'], languageOptions: { globals: globals.browser }, rules: js.configs.recommended.rules },
  { files: ['src/server/recipe-edit.cjs', 'scripts/test-mobile-v12.cjs', 'src/server/profile-media-folders.cjs', 'src/server/book-local-files.cjs', 'scripts/test-ios-v36.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node }, rules: js.configs.recommended.rules },
];
