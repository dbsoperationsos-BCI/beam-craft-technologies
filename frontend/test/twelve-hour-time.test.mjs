import test from "node:test";
import assert from "node:assert/strict";

import {
  HOURS,
  MINUTES,
  angleFor,
  angleOf,
  displayOf,
  hourAt,
  minuteAt,
  partsOf,
  pointAt,
  typedHour,
  typedMinute,
  valueOf,
} from "../src/lib/twelveHourTime.mjs";

/*
 * The 12-hour picker shows an hour, a minute and AM / PM and hands back `HH:MM` on the 24-hour
 * clock. Midnight and noon are where a conversion like this goes wrong, so they are pinned here.
 */

test("a 24-hour value reads as its 12-hour parts", () => {
  assert.deepEqual(partsOf("18:30"), { hour: "6", minute: "30", meridiem: "PM" });
  assert.deepEqual(partsOf("09:05"), { hour: "9", minute: "05", meridiem: "AM" });
  assert.deepEqual(partsOf("00:15"), { hour: "12", minute: "15", meridiem: "AM" });
  assert.deepEqual(partsOf("12:00"), { hour: "12", minute: "00", meridiem: "PM" });
});

test("the parts go back to the 24-hour value the form and the server read", () => {
  assert.equal(valueOf({ hour: "6", minute: "30", meridiem: "PM" }), "18:30");
  assert.equal(valueOf({ hour: "12", minute: "00", meridiem: "AM" }), "00:00", "12 AM is midnight");
  assert.equal(valueOf({ hour: "12", minute: "45", meridiem: "PM" }), "12:45", "12 PM is noon");
  assert.equal(valueOf({ hour: "11", minute: "", meridiem: "AM" }), "11:00", "no minute picked reads as on the hour");
  assert.equal(valueOf({ hour: "", minute: "30", meridiem: "PM" }), "", "no hour is no time yet");
});

test("every value survives the round trip", () => {
  for (let hours = 0; hours < 24; hours += 1) {
    for (const minute of ["00", "07", "30", "59"]) {
      const value = `${String(hours).padStart(2, "0")}:${minute}`;
      assert.equal(valueOf(partsOf(value)), value);
    }
  }
});

test("the field reads the way a clock is spoken", () => {
  assert.equal(displayOf("18:30"), "6:30 PM");
  assert.equal(displayOf("00:05"), "12:05 AM");
  assert.equal(displayOf(""), "");
  assert.equal(displayOf("25:00"), "", "an impossible time is shown as none, not as a wrong one");
  assert.equal(displayOf("#N/A"), "");
});

test("the dial is labelled clockwise from twelve, the minutes every five", () => {
  assert.deepEqual(HOURS, ["12", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
  assert.equal(MINUTES.length, 12);
  assert.equal(MINUTES[0], "00");
  assert.equal(MINUTES[3], "15");
  assert.equal(MINUTES[11], "55");
});

test("where the dial is touched is the hour or minute under the finger", () => {
  // Straight up, right, down and left of the centre - screen `dy` grows downwards.
  assert.equal(Math.round(angleOf(0, -10)), 0);
  assert.equal(Math.round(angleOf(10, 0)), 90);
  assert.equal(Math.round(angleOf(0, 10)), 180);
  assert.equal(Math.round(angleOf(-10, 0)), 270);

  assert.equal(hourAt(0), "12");
  assert.equal(hourAt(90), "3");
  assert.equal(hourAt(180), "6");
  assert.equal(hourAt(210), "7");
  assert.equal(hourAt(350), "12", "just short of twelve is twelve, not eleven");
  assert.equal(hourAt(14), "12");
  assert.equal(hourAt(16), "1");

  assert.equal(minuteAt(0), "00");
  assert.equal(minuteAt(90), "15");
  assert.equal(minuteAt(42), "07", "any minute, not only the five-minute marks");
  assert.equal(minuteAt(358), "00", "just short of the hour wraps to :00");
});

test("the hand points where the chosen hour or minute is", () => {
  assert.equal(angleFor("hour", "12"), 0);
  assert.equal(angleFor("hour", "7"), 210);
  assert.equal(angleFor("minute", "30"), 180);
  assert.equal(angleFor("minute", "07"), 42);
  const top = pointAt(0, 92, 120);
  assert.equal(Math.round(top.x), 120);
  assert.equal(Math.round(top.y), 28);
  const three = pointAt(90, 92, 120);
  assert.equal(Math.round(three.x), 212);
  assert.equal(Math.round(three.y), 120);
});

test("a typed hour or minute is taken only when it is one", () => {
  assert.equal(typedHour("7"), "7");
  assert.equal(typedHour("07"), "7");
  assert.equal(typedHour("12"), "12");
  assert.equal(typedHour("0"), "");
  assert.equal(typedHour("13"), "");
  assert.equal(typedHour(""), "");
  assert.equal(typedMinute("5"), "05");
  assert.equal(typedMinute("0"), "00");
  assert.equal(typedMinute("59"), "59");
  assert.equal(typedMinute("60"), "");
  assert.equal(typedMinute(""), "");
});
