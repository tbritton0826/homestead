"use strict";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };

function cleanToken(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function validDate(value = "") {
  return /^20\d{2}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function addDays(dateText, amount) {
  const date = new Date(`${dateText}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

function parseTesseractTsv(value = "") {
  const rows = String(value || "").replace(/\r/g, "").split("\n");
  const words = [];
  for (const row of rows.slice(1)) {
    const fields = row.split("\t");
    if (fields.length < 12 || Number(fields[0]) !== 5) continue;
    const text = fields.slice(11).join("\t").trim();
    const left = Number(fields[6]); const top = Number(fields[7]); const width = Number(fields[8]); const height = Number(fields[9]);
    if (!text || ![left, top, width, height].every(Number.isFinite)) continue;
    words.push({ page: Number(fields[1]), block: Number(fields[2]), paragraph: Number(fields[3]), line: Number(fields[4]), word: Number(fields[5]), left, top, width, height, right: left + width, bottom: top + height, centerX: left + width / 2, centerY: top + height / 2, confidence: Number(fields[10]), text });
  }
  return words;
}

function tsvPageSize(value = "") {
  for (const row of String(value || "").replace(/\r/g, "").split("\n").slice(1)) {
    const fields = row.split("\t");
    if (fields.length >= 10 && Number(fields[0]) === 1) return { width: Number(fields[8]) || 0, height: Number(fields[9]) || 0 };
  }
  return { width: 0, height: 0 };
}

function tsvToReadableText(words = []) {
  const groups = new Map();
  for (const word of words) {
    const key = `${word.page}:${word.block}:${word.paragraph}:${word.line}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(word);
  }
  return [...groups.values()]
    .map((line) => line.sort((a, b) => a.left - b.left))
    .sort((a, b) => (a[0]?.top || 0) - (b[0]?.top || 0) || (a[0]?.left || 0) - (b[0]?.left || 0))
    .map((line) => line.map((word) => word.text).join(" "))
    .join("\n");
}

function parseTime(hourText, minuteText, meridiemText) {
  let hour = Number(hourText); const minute = Number(minuteText || 0); const meridiem = String(meridiemText || "").toLowerCase().slice(0, 1);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return "";
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTimeRange(value = "") {
  const text = String(value || "").replace(/[|_]/g, " ").replace(/[—–−]/g, "-").replace(/\s+/g, " ");
  const twelveHour = text.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m?\.?|p\.?m?\.?)?\s*(?:-|to)\s*(\d{1,2})(?::([0-5]\d))?\s*(a\.?m?\.?|p\.?m?\.?)\b/i);
  if (twelveHour) {
    const endMarker = twelveHour[6];
    const inferredStart = twelveHour[3] || (/^p/i.test(endMarker) && Number(twelveHour[1]) > Number(twelveHour[4]) ? "a" : endMarker);
    const startTime = parseTime(twelveHour[1], twelveHour[2], inferredStart);
    const endTime = parseTime(twelveHour[4], twelveHour[5], endMarker);
    return startTime && endTime ? { startTime, endTime, sourceText: twelveHour[0] } : null;
  }
  const twentyFourHour = text.match(/\b(\d{1,2}):([0-5]\d)\s*(?:-|to)\s*(\d{1,2}):([0-5]\d)\b/i);
  if (!twentyFourHour) return null;
  const startTime = parseTime(twentyFourHour[1], twentyFourHour[2], "");
  const endTime = parseTime(twentyFourHour[3], twentyFourHour[4], "");
  return startTime && endTime ? { startTime, endTime, sourceText: twentyFourHour[0] } : null;
}

function weekdayFromWord(word = {}) {
  const token = cleanToken(word.text);
  return WEEKDAYS.findIndex((day) => token === day || token === `${day}day` || token.startsWith(day));
}

function clusterByY(words, tolerance = 28) {
  const clusters = [];
  for (const word of [...words].sort((a, b) => a.centerY - b.centerY)) {
    let cluster = clusters.find((item) => Math.abs(item.centerY - word.centerY) <= tolerance);
    if (!cluster) { cluster = { centerY: word.centerY, words: [] }; clusters.push(cluster); }
    cluster.words.push(word);
    cluster.centerY = cluster.words.reduce((sum, item) => sum + item.centerY, 0) / cluster.words.length;
  }
  return clusters;
}

function inferFirstDate(rawText = "", fallback = "") {
  const match = String(rawText || "").match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:\s*[-–—]\s*\d{1,2})?\s*,?\s*(20\d{2})\b/i);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    const date = `${match[3]}-${String(month + 1).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
    if (validDate(date)) return date;
  }
  return validDate(fallback) ? fallback : new Date().toISOString().slice(0, 10);
}

function dateForPersonalListWeekday(dayIndex, firstDate) {
  if (dayIndex < 0 || !validDate(firstDate)) return "";
  const first = new Date(`${firstDate}T12:00:00`);
  const offset = (dayIndex - first.getDay() + 7) % 7;
  return addDays(firstDate, offset);
}

function parsePersonalScheduleText(rawText = "", options = {}) {
  const text = String(rawText || "").replace(/\r/g, "");
  const lines = text.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const firstDate = validDate(options.firstDate || options.weekStart) ? (options.firstDate || options.weekStart) : new Date().toISOString().slice(0, 10);
  const personName = String(options.personName || "").trim().slice(0, 120);
  const shifts = [];
  const datedWeekdays = new Set();
  const coveredDates = [];
  let rememberedDate = "";
  let durationCount = 0;
  let durationTotal = 0;

  for (const line of lines) {
    const dayIndex = WEEKDAYS.findIndex((day) => new RegExp(`\\b${day}(?:day)?\\b`, "i").test(line));
    if (dayIndex >= 0) {
      let datedEntry = dateForPersonalListWeekday(dayIndex, firstDate);
      if (rememberedDate && datedEntry && datedEntry <= rememberedDate) datedEntry = addDays(datedEntry, 7);
      rememberedDate = datedEntry;
      datedWeekdays.add(dayIndex);
      if (datedEntry && !coveredDates.includes(datedEntry)) coveredDates.push(datedEntry);
    }
    const range = parseTimeRange(line);
    if (!range || !rememberedDate) continue;
    const afterRange = line.slice(Math.max(0, line.indexOf(range.sourceText) + range.sourceText.length));
    const durationMatch = afterRange.match(/(?:\[|\()?\s*(\d{1,2}(?:[.,]\d{1,2}))\s*(?:\]|\))?/);
    const printedDuration = durationMatch ? Number(durationMatch[1].replace(",", ".")) : null;
    if (Number.isFinite(printedDuration)) { durationCount += 1; durationTotal += printedDuration; }
    const location = afterRange
      .replace(/(?:\[|\()?\s*\d{1,2}(?:[.,]\d{1,2})\s*(?:\]|\))?/, "")
      .replace(/open\s+shifts?\s+are\s+available/ig, "")
      .replace(/^[-:| ]+|[-:| ]+$/g, "")
      .trim()
      .slice(0, 160);
    const shift = { include: true, date: rememberedDate, startTime: range.startTime, endTime: range.endTime, location, sourceText: range.sourceText };
    if (!shifts.some((item) => item.date === shift.date && item.startTime === shift.startTime && item.endTime === shift.endTime)) shifts.push(shift);
  }

  const personalMarkers = /\bmy\s+schedule\b|open\s+shifts?\s+are\s+available/i.test(text);
  const personalFormat = shifts.length > 0 && (personalMarkers || durationCount >= 2);
  if (!personalFormat) return { personName, matchedPersonName: "", shifts: [], offDays: [], coveredDates: [], rawText: text.slice(0, 30000), recognition: { mode: "not-personal-list", rowMatched: false, headerColumns: 0, printedHours: null, calculatedHours: 0, hoursMatch: null, safeToApprove: false, warnings: [] } };

  const calculatedHours = Number(shifts.reduce((sum, shift) => sum + hoursBetween(shift.startTime, shift.endTime), 0).toFixed(2));
  const printedHours = durationCount === shifts.length ? Number(durationTotal.toFixed(2)) : null;
  const hoursMatch = printedHours == null ? null : Math.abs(printedHours - calculatedHours) <= 0.25;
  const warnings = [];
  if (durationCount !== shifts.length) warnings.push(`Shift lengths were readable for ${durationCount} of ${shifts.length} shifts; compare the calculated total with the screenshot.`);
  if (hoursMatch === false) warnings.push(`The shift times total ${calculatedHours} hours, but the printed shift lengths total ${printedHours} hours.`);
  warnings.push("This is a personal schedule list; verify each recognized date before importing.");
  return {
    personName,
    matchedPersonName: personName,
    shifts: shifts.slice(0, 31),
    offDays: coveredDates.filter((date) => !shifts.some((shift) => shift.date === date)).map((date) => ({ include: true, dayType: "off", date, startTime: "", endTime: "", location: "Off day" })),
    coveredDates,
    rawText: text.slice(0, 30000),
    recognition: {
      mode: "personal-list",
      rowMatched: true,
      headerColumns: datedWeekdays.size,
      recognizedDates: new Set(shifts.map((shift) => shift.date)).size,
      printedHours,
      calculatedHours,
      hoursMatch,
      safeToApprove: shifts.length > 0 && hoursMatch !== false,
      warnings,
    },
  };
}

function regressionSlope(points = []) {
  if (points.length < 2) return 0;
  const meanX = points.reduce((sum, point) => sum + point.centerX, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.centerY, 0) / points.length;
  const numerator = points.reduce((sum, point) => sum + ((point.centerX - meanX) * (point.centerY - meanY)), 0);
  const denominator = points.reduce((sum, point) => sum + ((point.centerX - meanX) ** 2), 0);
  return denominator ? numerator / denominator : 0;
}

function hoursBetween(startTime, endTime) {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  let minutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
}

function nameTokenDistance(left = "", right = "") {
  const a = String(left || ""); const b = String(right || "");
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function meaningfulNameTokenMatch(value = "", wanted = "") {
  const token = cleanToken(value).replace(/\d+$/, "");
  const target = cleanToken(wanted);
  if (!token || !target || token.length < 4 || target.length < 4) return false;
  if (token === target) return true;
  if ((token.startsWith(target) || target.startsWith(token)) && Math.abs(token.length - target.length) <= 2) return true;
  const allowedErrors = Math.min(2, Math.max(1, Math.floor(target.length / 7)));
  return Math.abs(token.length - target.length) <= allowedErrors && nameTokenDistance(token, target) <= allowedErrors;
}

function findPersonWord(words, personName) {
  const wanted = String(personName || "").trim().split(/\s+/).map(cleanToken).filter(Boolean);
  if (!wanted.length) return null;
  const first = wanted[0]; const last = wanted[wanted.length - 1];
  const compactName = wanted.join("");
  const candidates = words.map((word) => {
    const nearby = words.filter((item) => Math.abs(item.centerY - word.centerY) < Math.max(28, word.height * 1.8) && item.left >= word.left && item.left < word.left + 420).sort((a, b) => a.left - b.left);
    const tokens = nearby.map((item) => cleanToken(item.text).replace(/\d+$/, "")).filter(Boolean);
    const joined = tokens.slice(0, Math.max(2, wanted.length)).join("");
    const token = cleanToken(word.text).replace(/\d+$/, "");
    let score = 0;
    if (meaningfulNameTokenMatch(token, first)) score += 60;
    // Phone/employee numbers and underlining often make Tesseract return a
    // person's full name as one token. Accept that combined token while still
    // requiring the complete name evidence, never a short fragment.
    if (wanted.length > 1 && (meaningfulNameTokenMatch(token, compactName) || meaningfulNameTokenMatch(joined, compactName))) score += 140;
    if (wanted.length > 1 && tokens.some((item) => meaningfulNameTokenMatch(item, last))) score += 100;
    return score ? { word, score: score + Number(word.confidence || 0) } : null;
  }).filter(Boolean);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.score - a.score || b.word.top - a.word.top)[0].word;
}

function findHeader(words, personWord) {
  const dayWords = words.filter((word) => word.centerY < personWord.centerY && weekdayFromWord(word) >= 0);
  const clusters = clusterByY(dayWords, 55);
  const candidates = clusters.map((cluster) => {
    const unique = [];
    for (const word of cluster.words.sort((a, b) => a.centerX - b.centerX)) {
      const dayIndex = weekdayFromWord(word);
      if (!unique.some((item) => item.dayIndex === dayIndex)) unique.push({ ...word, dayIndex });
    }
    return { ...cluster, words: unique, distance: personWord.centerY - cluster.centerY };
  }).filter((cluster) => cluster.words.length >= 4 && cluster.distance > 0);
  return candidates.sort((a, b) => a.distance - b.distance || b.words.length - a.words.length)[0] || null;
}

function completeColumnCenters(headerWords = []) {
  const sorted = [...headerWords].sort((a, b) => a.centerX - b.centerX);
  if (sorted.length < 4) return [];
  if (sorted.length === 7) return sorted.map((word) => word.centerX);
  const left = sorted[0].centerX; const right = sorted[sorted.length - 1].centerX;
  const spacing = (right - left) / Math.max(1, sorted.length - 1);
  if (!(spacing > 30)) return [];
  return Array.from({ length: 7 }, (_, index) => left + spacing * index);
}

function parsePositionedSchedule(tsv = "", options = {}) {
  const words = parseTesseractTsv(tsv);
  const pageSize = tsvPageSize(tsv);
  const rawText = tsvToReadableText(words);
  const personName = String(options.personName || "").trim();
  const detectedPersonWord = findPersonWord(words, personName);
  const rowCenterPercent = Number(options.rowCenterPercent);
  const manuallyGuided = Number.isFinite(rowCenterPercent) && rowCenterPercent >= 2 && rowCenterPercent <= 98 && pageSize.height > 0;
  const personWord = manuallyGuided
    ? { left: 0, top: pageSize.height * rowCenterPercent / 100 - 12, width: 20, height: 24, centerX: 10, centerY: pageSize.height * rowCenterPercent / 100, confidence: 100, text: personName }
    : detectedPersonWord;
  const empty = { personName, matchedPersonName: "", shifts: [], offDays: [], coveredDates: [], rawText, recognition: { mode: "positioned-table-row", rowMatched: false, headerColumns: 0, printedHours: null, calculatedHours: 0, hoursMatch: null, safeToApprove: false, warnings: [personName ? `Could not confidently locate ${personName}'s row.` : "Enter the person whose row should be read."] } };
  if (!personWord) return empty;
  const header = findHeader(words, personWord);
  if (!header) return { ...empty, recognition: { ...empty.recognition, rowMatched: true, warnings: ["The employee row was found, but the seven date columns were not clear enough."] } };
  const centers = completeColumnCenters(header.words);
  if (centers.length !== 7) return { ...empty, recognition: { ...empty.recognition, rowMatched: true, headerColumns: header.words.length, warnings: ["The date columns could not be reconstructed safely."] } };
  const firstDate = inferFirstDate(rawText, options.firstDate || options.weekStart);
  const spacing = centers.slice(1).reduce((sum, center, index) => sum + (center - centers[index]), 0) / 6;
  const slope = regressionSlope(header.words);
  const rowTolerance = manuallyGuided ? Math.max(32, pageSize.height * 0.034) : Math.max(32, personWord.height * 2.2);
  const rowWords = words.filter((word) => word.centerX > (personWord.centerX + centers[0]) / 2 && Math.abs(word.centerY - (personWord.centerY + slope * (word.centerX - personWord.centerX))) <= rowTolerance);
  const shifts = [];
  centers.forEach((center, columnIndex) => {
    const cellWords = rowWords.filter((word) => Math.abs(word.centerX - center) <= spacing * 0.48).sort((a, b) => a.left - b.left);
    const cellText = cellWords.map((word) => word.text).join(" ");
    const range = parseTimeRange(cellText);
    if (range) shifts.push({ include: true, date: addDays(firstDate, columnIndex), startTime: range.startTime, endTime: range.endTime, location: "", sourceText: range.sourceText, confidence: Math.round(cellWords.reduce((sum, word) => sum + Math.max(0, word.confidence || 0), 0) / Math.max(1, cellWords.length)) });
  });
  const nameAreaRight = centers[0] - spacing * 0.48;
  const nameArea = words.filter((word) => word.centerX < nameAreaRight && word.centerY >= personWord.centerY - 5 && word.centerY <= personWord.centerY + rowTolerance * 2.6).sort((a, b) => a.top - b.top || a.left - b.left);
  const nameText = nameArea.map((word) => word.text).join(" ");
  const printedHoursMatch = nameText.match(/total\s*hours?\s*[:\-]?\s*(\d+(?:\.\d+)?)/i);
  const printedHours = printedHoursMatch ? Number(printedHoursMatch[1]) : null;
  const calculatedHours = Number(shifts.reduce((sum, shift) => sum + hoursBetween(shift.startTime, shift.endTime), 0).toFixed(2));
  const hoursMatch = printedHours == null ? null : Math.abs(printedHours - calculatedHours) <= 0.25;
  const matchedNameAnchor = detectedPersonWord || personWord;
  const matchedNameWords = words.filter((word) => word.centerX < nameAreaRight && Math.abs(word.centerY - matchedNameAnchor.centerY) <= Math.max(25, matchedNameAnchor.height * 1.6)).sort((a, b) => a.left - b.left).map((word) => word.text).join(" ");
  const recognizedName = matchedNameWords.replace(/\s*\(.*$/, "").replace(/\s+\d{6,}.*$/, "").trim().slice(0, 120);
  // A manual guide confirms geometry, not identity. Keep its user-supplied label
  // instead of claiming a nearby department/role heading was the employee name.
  const matchedPersonName = manuallyGuided ? personName : (recognizedName || personName);
  const warnings = [];
  if (manuallyGuided) warnings.push("A manually positioned row guide was used; compare every result with the photo.");
  if (header.words.length < 7) warnings.push(`Only ${header.words.length} of 7 date headings were directly recognized; column spacing was reconstructed.`);
  if (shifts.length !== 7) warnings.push(`${shifts.length} of 7 day cells contained a readable shift.`);
  if (printedHours == null) warnings.push("The printed Total Hours value could not be read, so the hour total needs manual checking.");
  if (hoursMatch === false) warnings.push(`Calculated ${calculatedHours} hours, but the schedule prints ${printedHours} hours.`);
  const safeToApprove = shifts.length > 0 && hoursMatch !== false;
  return {
    personName,
    matchedPersonName,
    shifts,
    offDays: Array.from({ length: 7 }, (_, index) => addDays(firstDate, index)).filter((date) => !shifts.some((shift) => shift.date === date)).map((date) => ({ include: true, dayType: "off", date, startTime: "", endTime: "", location: "Off day" })),
    coveredDates: Array.from({ length: 7 }, (_, index) => addDays(firstDate, index)),
    rawText,
    recognition: { mode: "positioned-table-row", rowMatched: true, manuallyGuided, headerColumns: header.words.length, printedHours, calculatedHours, hoursMatch, safeToApprove, warnings },
    _geometry: {
      pageWidth: pageSize.width,
      pageHeight: pageSize.height,
      personCenterX: personWord.centerX,
      rowCenterY: personWord.centerY,
      columnCenters: centers,
      spacing,
      slope,
      rowTolerance,
      nameAreaRight,
      firstDate,
    },
  };
}

function applyCellTextRecovery(parsed = {}, cellTexts = [], totalText = "") {
  const geometry = parsed?._geometry;
  if (!geometry || !Array.isArray(cellTexts)) return parsed;
  const recovered = cellTexts.slice(0, 7).map((text, columnIndex) => {
    const range = parseTimeRange(text);
    return range ? {
      include: true,
      date: addDays(geometry.firstDate, columnIndex),
      startTime: range.startTime,
      endTime: range.endTime,
      location: "",
      sourceText: range.sourceText,
      confidence: 0,
    } : null;
  }).filter(Boolean);
  const shifts = recovered.length > (parsed.shifts || []).length ? recovered : (parsed.shifts || []);
  const recoveredHoursMatch = String(totalText || "").replace(/\s+/g, " ").match(/(?:total\s*)?hours?\s*[:\-]?\s*(\d+(?:\.\d+)?)/i);
  const printedHours = recoveredHoursMatch ? Number(recoveredHoursMatch[1]) : parsed.recognition?.printedHours ?? null;
  const calculatedHours = Number(shifts.reduce((sum, shift) => sum + hoursBetween(shift.startTime, shift.endTime), 0).toFixed(2));
  const hoursMatch = printedHours == null ? null : Math.abs(printedHours - calculatedHours) <= 0.25;
  const warnings = (parsed.recognition?.warnings || []).filter((warning) => !/day cells contained a readable shift|printed Total Hours|Calculated .*schedule prints/i.test(warning));
  if (shifts.length !== 7) warnings.push(`${shifts.length} of 7 day cells contained a readable shift.`);
  if (printedHours == null) warnings.push("The printed Total Hours value could not be read, so the hour total needs manual checking.");
  if (hoursMatch === false) warnings.push(`Calculated ${calculatedHours} hours, but the schedule prints ${printedHours} hours.`);
  if (recovered.length > (parsed.shifts || []).length) warnings.unshift(`Targeted row recognition recovered ${recovered.length} of 7 day cells.`);
  return {
    ...parsed,
    shifts,
    offDays: Array.from({ length: 7 }, (_, index) => addDays(geometry.firstDate, index)).filter((date) => !shifts.some((shift) => shift.date === date)).map((date) => ({ include: true, dayType: "off", date, startTime: "", endTime: "", location: "Off day" })),
    coveredDates: Array.from({ length: 7 }, (_, index) => addDays(geometry.firstDate, index)),
    recognition: {
      ...(parsed.recognition || {}),
      printedHours,
      calculatedHours,
      hoursMatch,
      safeToApprove: shifts.length > 0 && hoursMatch !== false,
      warnings,
    },
  };
}

module.exports = { parseTesseractTsv, tsvToReadableText, parseTimeRange, parsePersonalScheduleText, parsePositionedSchedule, applyCellTextRecovery, hoursBetween, inferFirstDate };
