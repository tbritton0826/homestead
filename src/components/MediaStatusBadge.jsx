export default function MediaStatusBadge({ status = "missing" }) {
  const normalized = status === "importing" || status === "scanning" ? "processing" : status === "needs-attention" ? "failed" : status;
  const labels = {
    owned: "Owned",
    partial: "Partially Owned",
    available: "Available",
    requested: "Requested",
    pending: "Pending Approval",
    declined: "Declined",
    downloading: "Downloading",
    processing: status === "scanning" ? "Scanning" : status === "importing" ? "Importing" : "Processing",
    discovery: "Available to Request",
    missing: "Not Owned",
    failed: "Needs Attention",
  };
  return <span className={`media-status-badge ${normalized}`}>{labels[normalized] || labels.missing}</span>;
}
