const PROVIDERS = [
  [/(?:xfinity|comcast)/i, "Xfinity / Comcast"],
  [/duquesne\s+(?:light|electric)/i, "Duquesne Light"],
  [/(?:verizon|fios)/i, "Verizon"],
  [/(?:at&t|att wireless)/i, "AT&T"],
  [/t-?mobile/i, "T-Mobile"],
  [/peoples\s+(?:natural\s+)?gas/i, "Peoples Gas"],
  [/american\s+water/i, "American Water"],
];

function cleanText(value = "") {
  return String(value || "").replace(/\0/g, "").replace(/\r/g, "").trim();
}

function parseDateToken(value = "", referenceDate = new Date()) {
  const text = cleanText(value).replace(/[,]/g, " ").replace(/\s+/g, " ");
  const numeric = text.match(/\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])(?:[\/-](20\d{2}|\d{2}))?\b/);
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3]) : referenceDate.getFullYear();
    if (year < 100) year += 2000;
    const candidate = new Date(year, Number(numeric[1]) - 1, Number(numeric[2]), 12);
    if (!Number.isNaN(candidate.getTime())) return `${year}-${String(numeric[1]).padStart(2, "0")}-${String(numeric[2]).padStart(2, "0")}`;
  }
  const words = text.match(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+([0-3]?\d)(?:st|nd|rd|th)?(?:\s+(20\d{2}))?/i);
  if (words) {
    const monthAndDay = words[0].replace(/\s+20\d{2}\s*$/i, "");
    const parsed = new Date(`${monthAndDay} ${words[2] || referenceDate.getFullYear()} 12:00:00`);
    if (!Number.isNaN(parsed.getTime())) return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }
  return "";
}

function parseBillOcrText(value = "", referenceDate = new Date()) {
  const rawText = cleanText(value);
  const provider = PROVIDERS.find(([pattern]) => pattern.test(rawText))?.[1]
    || rawText.split("\n").map((line) => line.trim()).find((line) => /[a-z]{3}/i.test(line) && line.length <= 60)
    || "Bill";
  const amountPatterns = [
    /(?:amount\s+due|total\s+due|payment\s+due|balance\s+due|new\s+balance)\s*[:$ ]*\$?\s*([0-9]{1,6}(?:[,.][0-9]{2}))/i,
    /\$\s*([0-9]{1,6}(?:,[0-9]{3})*(?:\.[0-9]{2}))/,
  ];
  let amount = "";
  for (const pattern of amountPatterns) {
    const match = rawText.match(pattern);
    if (!match) continue;
    const parsed = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(parsed) && parsed >= 0 && parsed < 1000000) { amount = parsed.toFixed(2); break; }
  }
  const dueContext = rawText.match(/(?:due\s+(?:date|by)|payment\s+due|please\s+pay\s+by)\s*[:\-]?\s*([^\n]{3,40})/i)?.[1] || "";
  const dueDate = parseDateToken(dueContext, referenceDate) || parseDateToken(rawText, referenceDate);
  return {
    provider: provider.slice(0, 120),
    amount,
    dueDate,
    title: `${provider}${amount ? ` · $${amount}` : ""}`.slice(0, 180),
    confidence: [provider !== "Bill", Boolean(amount), Boolean(dueDate)].filter(Boolean).length,
  };
}

module.exports = { parseBillOcrText, parseDateToken };
