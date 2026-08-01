import assert from "node:assert/strict";
import test from "node:test";
import { reminderFor } from "./third-party-attribution-reminder.mjs";

const writeHook = (content) => ({
  hook_event_name: "PostToolUse",
  tool_name: "Write",
  tool_input: { content },
});

const editHook = (newString) => ({
  hook_event_name: "PostToolUse",
  tool_name: "Edit",
  tool_input: { new_string: newString },
});

test("ignores non-PostToolUse events", () => {
  const input = { ...writeHook("// Adapted from deck.gl (https://example.com)."), hook_event_name: "PreToolUse" };
  assert.equal(reminderFor(input), null);
});

test("ignores tools other than Write/Edit", () => {
  assert.equal(
    reminderFor({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
    }),
    null,
  );
});

test("ignores ordinary content with no adaptation marker", () => {
  assert.equal(reminderFor(writeHook("export const x = 1;")), null);
});

test("reminds when Write content contains the adaptation marker", () => {
  const content = "// Adapted from deck.gl (https://github.com/visgl/deck.gl).\nexport function extrude() {}";
  const reminder = reminderFor(writeHook(content));
  assert.match(reminder, /deck\.gl/);
  assert.match(reminder, /THIRD_PARTY_NOTICES\.md/);
});

test("reminds when Edit new_string contains the adaptation marker", () => {
  const content = "# Adapted from noise-rs (https://github.com/Razaekel/noise-rs).\n";
  const reminder = reminderFor(editHook(content));
  assert.match(reminder, /noise-rs/);
});

test("returns null when tool_input has no content or new_string", () => {
  assert.equal(reminderFor({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: {} }), null);
});
