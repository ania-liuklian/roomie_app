import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = fs.readFileSync(new URL("../src/Avatar.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
} }).outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
const { default: Avatar, AVATAR_COLORS } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const render = (options = {}, props = {}) => renderToStaticMarkup(React.createElement(Avatar, { member: { name: "Roomie", ...options }, ...props }));

test("default SVG preserves rose, plain eyes, existing dimensions and pupil geometry", () => {
  const markup = render();
  assert.match(markup, /fill="#BF8790"/);
  assert.match(markup, /cx="64.5" cy="48.5" r="19.5"/);
  assert.match(markup, /x="17.81" y="20" width="31.08"/);
  assert.match(markup, /avatar-md/);
  assert.equal(markup, render({ color: "#BF8790", eye_style: "plain", gaze: "straight" }));
  assert.doesNotMatch(markup, /<img|href=|<path/);
});

test("eight existing colors and every gaze/eye-style combination render as SVG", () => {
  assert.equal(AVATAR_COLORS.length, 8);
  for (const color of AVATAR_COLORS) for (const eye_style of ["plain", "lashes"]) {
    for (const gaze of ["straight", "left", "right", "up", "happy", "sleepy"]) {
      const markup = render({ color, eye_style, gaze });
      assert.match(markup, new RegExp(`fill="${color}"`));
      assert.match(markup, /<svg/);
      assert.doesNotMatch(markup, /<img/);
      if (eye_style === "lashes") assert.match(markup, /stroke-width="5"/);
      if (gaze === "happy") assert.match(markup, /M20 60 Q50 25 80 60/);
      if (gaze === "sleepy") assert.match(markup, /M2 50 H98/);
    }
  }
});

test("profile and greeting keep their layout classes and reuse the same eyes", () => {
  assert.match(render({}, { variant: "profile" }), /class="profile-roomie-head"/);
  assert.match(render({}, { variant: "peek" }), /class="roomie-peek"/);
  assert.match(render({ gaze: "left" }, { variant: "profile" }), /cx="35"/);
  assert.match(render({ color: "invalid" }), /fill="#BF8790"/);
});
