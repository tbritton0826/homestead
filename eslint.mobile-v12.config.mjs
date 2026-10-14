import js from '@eslint/js';
import globals from 'globals';
export default [
  { files: ['src/utils/mobile-polish.js'], languageOptions: { globals: globals.browser }, rules: js.configs.recommended.rules },
  { files: ['src/server/recipe-edit.cjs', 'scripts/test-mobile-v12.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node }, rules: js.configs.recommended.rules },
];
