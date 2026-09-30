# Recipe preservation and recovery

Homestead saves complete recipes and quick instructions (including ingredients,
directions, notes, categories, favorites, source links and timers) in
`homestead-recipes.json`. Recipe photos live beside it in `artwork/`. Keep this
whole folder when changing servers or reconfiguring Homestead.

## Unraid: existing installation

After updating the image, edit the **running Homestead** container and add:

| Setting | Value |
| --- | --- |
| Path: host | `/mnt/user/Recipes` |
| Path: container | `/media/recipes` |
| Path access | Read/Write |
| Variable name | `HOMESTEAD_RECIPES_DIR` |
| Variable value | `/media/recipes` |

Apply the container settings, then open Recipes. Keep the existing appdata
mapping during this first run: Homestead imports its old `recipes.json`,
`recipe-categories.json`, and `recipe-artwork/` into the new folder automatically.
It leaves those originals in place. New saves go to the new metadata file.
The updated Community Apps template provides these settings for new installs;
updating the Docker image alone does not add mappings to an existing container.

Confirm `/mnt/user/Recipes/homestead-recipes.json` contains your recipes and that
the Recipes page says it is using your configured recipe folder. The server can
verify the container folder, but cannot verify its host-side bind mount. Check
the mapping in Unraid. Back up the entire Recipes share to another device too.

## After reconfiguration

Mount the same Recipes folder and set the same variable before opening Recipes.
Homestead reads the existing metadata even with completely fresh appdata. Existing
metadata is authoritative; stale legacy appdata is not merged over it. Category
ownership keeps its original account IDs. With newly created accounts, recipes
still appear under All; user-specific category menus may need to be recreated.

Without the variable, the fallback is `<HOMESTEAD_DATA_DIR>/recipe-library`.
That survives container updates only when appdata is mounted persistently and
does not protect against deleting/replacing appdata. The Recipes page explains
when this fallback is being used.

## Interrupted writes or missing recipes

Saves use a flushed temporary file and atomic replacement. The `.bak` file keeps
the previous committed snapshot. If metadata is missing/corrupt, a valid backup
is restored automatically; a damaged original is retained and the UI reports
recovery. The previous snapshot can be one save behind. If neither file can be
read, saving is blocked instead of overwriting recipes with an empty collection.
There is no automatic 5,000-recipe truncation. Run one Homestead writer per folder.

For recipes lost before this feature, look in the former container's appdata
mapping and Unraid appdata backups for `recipes.json`, `recipe-categories.json`,
and `recipe-artwork/`. Preserve copies before recovery. This feature cannot
recreate recipes whose only copy has already been deleted. Do not replace a
nonempty current library with an older file without reviewing/merging the data.

Verification: `node scripts/test-recipe-library.cjs` covers new-appdata recovery,
legacy migration and artwork, corrupt files, backup restoration, overlapping
imports, failed writes, missing folders, and collections larger than 5,000.
