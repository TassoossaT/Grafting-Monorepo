import assert from "node:assert/strict";
import test from "node:test";
import { parseResearchRegistry } from "../src/research-registry.ts";

test("parses a normal row with a Full reasoning backtick path", () => {
  const markdown = `# Registry

## Some topic

Full reasoning: \`docs/research/some-topic.md\`

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| Widget | MIT | Standby | A plain note |
`;

  const sections = parseResearchRegistry(markdown);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, "Some topic");
  assert.equal(sections[0].sourceDoc, "docs/research/some-topic.md");
  assert.deepEqual(sections[0].rows, [
    {
      candidate: "Widget",
      license: "MIT",
      statusId: "standby",
      statusLabel: "Standby (deferred)",
      statusQualifier: null,
      note: "A plain note",
    },
  ]);
});

test("strips bold markers from the candidate and status cells", () => {
  const markdown = `## Topic

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| **Zvec** | Apache-2.0 | **Standby, preferred pick** | Note text |
`;

  const [section] = parseResearchRegistry(markdown);
  assert.equal(section.rows[0].candidate, "Zvec");
  assert.equal(section.rows[0].statusId, "standby");
  assert.equal(section.rows[0].statusQualifier, "preferred pick");
});

test("parses each real qualifier-separator style used in the registry", () => {
  const markdown = `## Topic

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| A | MIT | Standby, top pick | comma-separated |
| B | MIT | Reference only — superseded | em-dash-separated |
| C | MIT | Reference only (concept) | parenthetical |
`;

  const [section] = parseResearchRegistry(markdown);
  assert.equal(section.rows[0].statusQualifier, "top pick");
  assert.equal(section.rows[1].statusQualifier, "superseded");
  assert.equal(section.rows[2].statusQualifier, "concept");
});

test("recognizes every status in the current legend, including the two new lab statuses", () => {
  const markdown = `## Topic

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| A | MIT | Adopted | n |
| B | MIT | Decided | n |
| C | MIT | In development | n |
| D | MIT | In review | n |
| E | MIT | Standby | n |
| F | MIT | Discarded | n |
| G | MIT | Reference only | n |
`;

  const [section] = parseResearchRegistry(markdown);
  assert.deepEqual(
    section.rows.map((row) => row.statusId),
    ["adopted", "decided", "in-development", "in-review", "standby", "discarded", "reference-only"],
  );
});

test("throws a descriptive error for an unrecognized status", () => {
  const markdown = `## Topic

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| Widget | MIT | Not A Real Status | n |
`;

  assert.throws(() => parseResearchRegistry(markdown), /unrecognized status "Not A Real Status" for candidate "Widget"/);
});

test("sections without a table (e.g. the legend itself) are skipped, not errors", () => {
  const markdown = `## How this file stays current

Just prose here, no table.

## Real topic

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| Widget | MIT | Adopted | n |
`;

  const sections = parseResearchRegistry(markdown);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, "Real topic");
});

test("a Full reasoning line whose only backtick span is a glob inside prose is kept as free text, not mistaken for the real path", () => {
  const markdown = `## Topic

Full reasoning: discussed in conversation 2026-07-31; not (yet) captured in a
dedicated \`docs/research/*.md\` file.

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| Widget | MIT | Standby | n |
`;

  const [section] = parseResearchRegistry(markdown);
  assert.equal(
    section.sourceDoc,
    "discussed in conversation 2026-07-31; not (yet) captured in a dedicated `docs/research/*.md` file.",
  );
});

test("a Full reasoning line without a backtick path is kept as free text", () => {
  const markdown = `## Topic

Full reasoning: discussed in conversation 2026-07-31; no dedicated doc yet.

| Candidate | License | Status | Note |
| --- | --- | --- | --- |
| Widget | MIT | Standby | n |
`;

  const [section] = parseResearchRegistry(markdown);
  assert.equal(section.sourceDoc, "discussed in conversation 2026-07-31; no dedicated doc yet.");
});
