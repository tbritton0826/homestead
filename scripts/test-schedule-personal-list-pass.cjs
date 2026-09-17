"use strict";

const assert = require("node:assert/strict");
const { parsePersonalScheduleText } = require("../src/server/schedule-recognition.cjs");

const clearPhoneSchedule = `
My schedule
Fri
11
Today
Open shifts are available
Sat
12
9:30 AM–8:30 PM [11.00]
Open shifts are available
Sun
13
10:30 AM–6:30 PM [8.00]
Mon
14
1:00 PM–8:30 PM [7.50]
Tue
15
9:30 AM–3:00 PM [5.50]
Wed
16
2:00 PM–8:30 PM [6.50]
`;

const result = parsePersonalScheduleText(clearPhoneSchedule, { firstDate: "2026-09-06", personName: "Andrea" });
assert.equal(result.recognition.mode, "personal-list");
assert.equal(result.recognition.rowMatched, true);
assert.equal(result.recognition.safeToApprove, true);
assert.equal(result.recognition.recognizedDates, 5);
assert.equal(result.recognition.printedHours, 38.5);
assert.equal(result.recognition.calculatedHours, 38.5);
assert.equal(result.recognition.hoursMatch, true);
assert.deepEqual(result.offDays.map((day) => ({ date: day.date, dayType: day.dayType })), [
  { date: "2026-09-11", dayType: "off" },
]);
assert.deepEqual(result.shifts.map(({ date, startTime, endTime }) => ({ date, startTime, endTime })), [
  { date: "2026-09-12", startTime: "09:30", endTime: "20:30" },
  { date: "2026-09-13", startTime: "10:30", endTime: "18:30" },
  { date: "2026-09-14", startTime: "13:00", endTime: "20:30" },
  { date: "2026-09-15", startTime: "09:30", endTime: "15:00" },
  { date: "2026-09-16", startTime: "14:00", endTime: "20:30" },
]);

const bracketOnlySignal = parsePersonalScheduleText("Sat\n9:30 AM-8:30 PM [11.00]\nSun\n10:30 AM-6:30 PM [8.00]", { firstDate: "2026-09-06" });
assert.equal(bracketOnlySignal.recognition.mode, "personal-list");
assert.equal(bracketOnlySignal.shifts.length, 2);

const unrelatedGridText = parsePersonalScheduleText("Employee schedule\nSat 9:30 AM-8:30 PM\nSun 10:30 AM-6:30 PM", { firstDate: "2026-09-06" });
assert.equal(unrelatedGridText.recognition.mode, "not-personal-list");
assert.equal(unrelatedGridText.shifts.length, 0);

console.log("Personal day-by-day schedule recognition checks passed.");
