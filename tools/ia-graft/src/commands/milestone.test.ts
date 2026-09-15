import assert from "node:assert/strict";
import test from "node:test";
import { milestoneDueOn, milestoneFields, milestoneList, milestoneNew, milestoneUpdate } from "./milestone.ts";

test("due dates accept only real YYYY-MM-DD calendar dates", () => {
  assert.equal(milestoneDueOn("2026-12-31"), "2026-12-31T00:00:00Z");
  assert.equal(milestoneDueOn("2026-02-30"), undefined);
  assert.equal(milestoneDueOn("31/12/2026"), undefined);
  assert.equal(milestoneDueOn("2026-12-31T10:00:00Z"), undefined);
});

test("milestone fields send strings raw and clear the due date as JSON null", () => {
  assert.deepEqual(milestoneFields({ title: "1.0", state: "closed", dueOn: "2026-12-31" }), {
    ok: true,
    args: ["-f", "title=1.0", "-f", "state=closed", "-f", "due_on=2026-12-31T00:00:00Z"],
  });
  assert.deepEqual(milestoneFields({ dueOn: "none" }), { ok: true, args: ["-F", "due_on=null"] });
});

test("milestone fields reject an empty title, unknown state, and bad due date", () => {
  assert.equal(milestoneFields({ title: "" }).ok, false);
  assert.equal(milestoneFields({ state: "done" as never }).ok, false);
  assert.equal(milestoneFields({ dueOn: "tomorrow" }).ok, false);
});

test("milestone commands validate their input before calling gh", async () => {
  assert.equal((await milestoneList(process.cwd(), { state: "merged" as never })).ok, false);
  assert.equal((await milestoneNew(process.cwd(), { title: "" })).ok, false);
  assert.equal((await milestoneNew(process.cwd(), { title: "1.0", dueOn: "none" })).ok, false);
  assert.equal((await milestoneUpdate(process.cwd(), { number: "" })).ok, false);

  const nothing = await milestoneUpdate(process.cwd(), { number: 3 });
  assert.equal(nothing.ok, false);
  if (!nothing.ok) assert.match(nothing.error, /nothing to update/);
});
