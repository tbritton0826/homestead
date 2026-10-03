const FINAL_POSTER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='190' height='285'%3E%3Crect width='190' height='285' fill='%23151922'/%3E%3C/svg%3E";
export function handlePosterFallback(event, fallback = "/placeholder-poster.jpg") {
  const image = event.currentTarget;
  const current = image.getAttribute('src');
  if (current === FINAL_POSTER) return;
  image.src = current === fallback || image.src.endsWith(fallback) ? FINAL_POSTER : fallback;
}
