export default function MediaStatusBadge({ status = "missing" }) {
  const statusMap = {
    owned: "Owned",
    available: "Available",
    requested: "Requested",
    downloading: "Downloading",
    processing: "Processing",
    missing: "Not Owned",
    failed: "Failed",
  };

  return (
    <span className={`media-status-badge ${status}`}>
      {statusMap[status] || "Not Owned"}
    </span>
  );
}