import assert from "node:assert/strict";
import test from "node:test";
import { aiRun } from "./ai-commands.ts";

const fakeExec = (stdout: string) => async (_cmd: string, _args: string[]) => ({ stdout, stderr: "" });
const failingExec = (message: string) => async (_cmd: string, _args: string[]) => {
  throw new Error(message);
};

test("aiRun rejects a missing prompt", async () => {
  const result = await aiRun("/repo", { prompt: "" } as never);
  assert.equal(result.ok, false);
});

test("aiRun rejects an invalid tier", async () => {
  const result = await aiRun("/repo", { prompt: "hi", tier: "ultra" } as never);
  assert.equal(result.ok, false);
});

test("aiRun defaults to the high tier when none is given", async () => {
  let calledModel = "";
  const exec = (async (_cmd: string, args: string[]) => {
    calledModel = args[args.indexOf("--model") + 1]!;
    return { stdout: "ok", stderr: "" };
  }) as never;
  const result = await aiRun("/repo", { prompt: "hi" }, { exec });
  assert.equal(result.ok, true);
  assert.equal(calledModel, "gemini-3.6-flash-high");
});

test("aiRun trims stdout and reports the resolved model on success", async () => {
  const result = await aiRun("/repo", { prompt: "hi", tier: "low" }, { exec: fakeExec("  OK  \n") as never });
  assert.deepEqual(result, { ok: true, output: "OK", model: "gemini-3.6-flash-low" });
});

test("aiRun surfaces a failure when agy is missing or exits non-zero", async () => {
  const result = await aiRun("/repo", { prompt: "hi" }, { exec: failingExec("spawn agy ENOENT") as never });
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /agy run failed.*ENOENT/);
});
