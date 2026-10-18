export async function prepareTcgPhotos(captures) {
  if (captures.length > 4) throw new Error("Choose at most four photos for each printing group.");
  let bytes = 0;
  const result = [];
  for (const capture of captures) {
    if (!/^data:image\/(jpeg|png|webp|gif|heic|heif|avif);base64,/i.test(String(capture.dataUrl || ""))) throw new Error("Choose a valid card image.");
    if (String(capture.dataUrl || "").length > 90 * 1024 * 1024) throw new Error("Choose a smaller card photo.");
    const response = await fetch(capture.dataUrl);
    const blob = await response.blob();
    const image = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not prepare the card photo.");
      context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.78);
      const size = Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4);
      bytes += size;
      if (size > 2 * 1024 * 1024 || bytes > 6 * 1024 * 1024) throw new Error("Choose fewer or smaller photos for this printing.");
      result.push({ ...capture, name: String(capture.name || "card").replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg", size, dataUrl });
    } finally { image.close(); }
  }
  return result;
}
