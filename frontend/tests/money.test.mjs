import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/money.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { money } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("integer API shares display exactly: 10000 split three ways", () => {
  assert.deepEqual([3334, 3333, 3333].map((share) => money(share)), ["33.34", "33.33", "33.33"]);
  assert.equal(money(10000), "100");
  assert.equal(money(1), "0.01");
  assert.equal(money(10), "0.10");
  assert.equal(money(0), "0");
  assert.equal(money(-3334), "-33.34");
});

test("decimal input is parsed as digits, including precision-sensitive values", () => {
  for (const [input, expected] of [["100", 10000], ["0.29", 29], ["1.01", 101], ["33.34", 3334],
    ["33,33", 3333], [" 0001.1 ", 110], ["10000000000.00", 1000000000000]]) {
    assert.equal(money(input), expected);
  }
  for (const value of [1, 29, 101, 3333, 3334, 999999999999, 1000000000000]) {
    assert.equal(money(money(value)), value);
  }
});

test("reject ambiguous, excessive and noninteger money instead of rounding", () => {
  for (const input of ["", "0", "0.00", "-1", ".5", "1.", "1.001", "1e2", "NaN", "Infinity", "1,234.56", "10000000000.01"]) {
    assert.throws(() => money(input));
  }
  for (const value of [1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => money(value));
});
