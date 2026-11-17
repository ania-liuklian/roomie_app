import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("shopping deletion retains confirmation and cancellation", () => {
  const dialogStart = source.indexOf('modal === "shopping-delete" && shoppingDeleteTarget');
  assert.ok(dialogStart >= 0);
  const dialog = source.slice(dialogStart, source.indexOf("</Modal>", dialogStart));
  assert.match(dialog, /Видалити покупку\?/);
  assert.match(dialog, /setShoppingDeleteTarget\(null\)[^\n]*Скасувати/);
  assert.match(dialog, /onClick=\{deleteShopping\}[\s\S]*Так, видалити/);
});

test("the donation banner points to the existing monobank jar in a new tab", () => {
  assert.match(source, /profile-donation-title[\s\S]*Подобається Roomie\?/);
  assert.match(source, /href="https:\/\/send\.monobank\.ua\/jar\/e4aq8ngAd"\s+target="_blank"\s+rel="noopener noreferrer"/);
});
