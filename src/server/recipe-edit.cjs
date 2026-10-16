"use strict";
function recipeEditable(recipe, user) {
  return recipe?.readOnly !== true && recipe?.canEdit !== false && user?.readOnly !== true &&
    (!user || user.role === "owner" || (user.allowedLibraries || []).some(library => ["*", "family", "recipes"].includes(library)));
}
function recipeEditSupplement(current, input, { categories, cleanValue, cleanLines }) {
  const fields = {};
  if (Object.hasOwn(input, "categoryId")) {
    const id = cleanValue(input.categoryId, 160);
    if (id !== (current.categoryId || "")) {
      const category = categories.find(item => item.id === id);
      if (id && !category) throw new Error("Choose one of your recipe categories.");
      fields.categoryId = category?.id || ""; fields.category = category?.name || "";
    }
  }
  if (Object.hasOwn(input, "tags")) fields.tags = cleanLines(input.tags, 30).map(tag => tag.replace(/^#/, ""));
  if (Object.hasOwn(input, "sourceUrl")) {
    const url = cleanValue(input.sourceUrl, 2000);
    if (url && url !== current.sourceUrl) {
      const address = new URL(url);
      if (!["http:", "https:"].includes(address.protocol)) throw new Error("Use an HTTP or HTTPS recipe source link.");
    }
    fields.sourceUrl = url;
  }
  return fields;
}
module.exports = { recipeEditable, recipeEditSupplement };
