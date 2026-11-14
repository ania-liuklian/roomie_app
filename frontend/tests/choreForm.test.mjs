import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = fs.readFileSync(new URL("../src/choreForm.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { localDateTime, dueForSave } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("edit form preserves original ISO precision when due date is unchanged", () => {
  const original = "2026-11-18T16:00:00.123Z";
  const local = localDateTime(original);
  assert.match(local, /^2026-11-18T\d{2}:\d{2}:00$/);
  assert.equal(dueForSave(local, original), original);
});

test("editing due date converts device-local input to an ISO instant", () => {
  const original = "2026-11-18T16:00:00Z";
  const input = "2026-11-20T19:30:00";
  assert.equal(dueForSave(input, original), new Date(input).toISOString());
  assert.throws(() => dueForSave("invalid", original));
});
