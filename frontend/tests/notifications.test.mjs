import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.sessionStorage = { getItem: () => null };
function moduleUrl(file, replacements = {}) {
  const source = fs.readFileSync(new URL(file, import.meta.url), "utf8").replaceAll("import.meta.env", '({VITE_API_BASE_URL:"/api/v1", BASE_URL:"/"})');
  let code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  for (const [from, to] of Object.entries({ react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), ...replacements })) {
    code = code.replaceAll(JSON.stringify(from), JSON.stringify(to));
  }
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const apiUrl = moduleUrl("../src/api.ts");
const avatarUrl = moduleUrl("../src/Avatar.tsx");
const { NotificationItems } = await import(moduleUrl("../src/NotificationBell.tsx", { "./api": apiUrl, "./Avatar": avatarUrl }));
const actor = { name: "Member", color: "#BF8790", eye_style: "plain", gaze: "straight" };
const items = [
  { id: 2, actor, message: "New chore", created_at: "2026-11-14T12:00:00Z", read_at: null },
  { id: 1, actor, message: "Joined room", created_at: "2026-11-13T12:00:00Z", read_at: "2026-11-14T12:30:00Z" },
];

test("notification list displays actor, message, date and backend read state", () => {
  const markup = renderToStaticMarkup(React.createElement(NotificationItems, { items, busy: false, onRead() {} }));
  assert.equal((markup.match(/class="notification-item unread"/g) || []).length, 1);
  assert.match(markup, /New chore/);
  assert.match(markup, /Joined room/);
  assert.match(markup, /Member/);
  assert.ok(markup.indexOf("New chore") < markup.indexOf("Joined room"));
  assert.match(markup, /Непрочитано/);
  assert.match(markup, /Прочитано/);
});

test("notification click passes the actual notification ID and pending actions disable rows", () => {
  let selected;
  const tree = NotificationItems({ items, busy: false, onRead: (item) => { selected = item; } });
  const rows = React.Children.toArray(tree.props.children);
  rows[0].props.children.props.onClick();
  assert.equal(selected.id, 2);
  const markup = renderToStaticMarkup(React.createElement(NotificationItems, { items, busy: true, onRead() {} }));
  assert.equal((markup.match(/disabled=""/g) || []).length, 2);
});
