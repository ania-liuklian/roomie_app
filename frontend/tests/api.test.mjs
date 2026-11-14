import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const storage = new Map();
globalThis.sessionStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
globalThis.window = new EventTarget();
window.location = { origin: "http://localhost:8443" };
const source = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8")
  .replaceAll("import.meta.env", '({ VITE_API_BASE_URL: "/api/v1", BASE_URL: "/" })');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { api, setToken, getToken, inviteCode, inviteLink, formatTimestamp } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

beforeEach(() => setToken(null));

test("JWT is sent for private calls, never for public auth/preview", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ access_token: "new-token" });
  };
  setToken("jwt-token");
  await api.me();
  await api.rooms();
  await api.members(7);
  await api.invite(7);
  await api.login("user@example.com", "password123");
  await api.register("User", "user@example.com", "password123");
  await api.previewInvite("abc_123");
  assert.deepEqual(calls.map((call) => call.url), ["/api/v1/me", "/api/v1/rooms", "/api/v1/rooms/7/members", "/api/v1/rooms/7/invite", "/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/invites/abc_123"]);
  for (const { options } of calls.slice(0, 4)) assert.equal(options.headers.get("Authorization"), "Bearer jwt-token");
  for (const { options } of calls.slice(4)) assert.equal(options.headers.get("Authorization"), null);
  assert.equal(storage.get("roomie-access-token"), "jwt-token");
});

test("create and join send the expected mutation payloads", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ id: 7 });
  };
  setToken("token");
  await api.createRoom("214");
  await api.joinRoom("random-code");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { number: "214" });
  assert.equal(calls[1].url, "/api/v1/invites/random-code/join");
  assert.equal(calls[1].options.method, "POST");
});

test("shopping uses room-scoped authenticated calls and explicit done/undone", async () => {
  const calls = [];
  const controller = new AbortController();
  const item = { id: 12, room_id: 7, title: "Soap", done: false, buyer_id: null, completed_at: null };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "PATCH") {
      const { done } = JSON.parse(options.body);
      return Response.json({ ...item, done, buyer_id: done ? 3 : null, completed_at: done ? "2026-11-14T12:00:00Z" : null });
    }
    return Response.json(options.method === "POST" ? item : [item]);
  };
  setToken("shopping-token");
  assert.deepEqual(await api.shopping(7, controller.signal), [item]);
  assert.deepEqual(await api.addShopping(7, "Soap", controller.signal), item);
  const bought = await api.setShoppingDone(7, 12, true, controller.signal);
  assert.equal(bought.buyer_id, 3); // Preserve the server's buyer rather than guessing locally.
  const undone = await api.setShoppingDone(7, 12, false, controller.signal);
  assert.equal(undone.buyer_id, null);
  assert.equal(undone.completed_at, null);
  assert.deepEqual(calls.map(({ url }) => url), ["/api/v1/rooms/7/shopping-items", "/api/v1/rooms/7/shopping-items", "/api/v1/rooms/7/shopping-items/12", "/api/v1/rooms/7/shopping-items/12"]);
  assert.deepEqual(calls.slice(1).map(({ options }) => [options.method, JSON.parse(options.body)]), [
    ["POST", { title: "Soap" }], ["PATCH", { done: true }], ["PATCH", { done: false }],
  ]);
  for (const { options } of calls) {
    assert.equal(options.headers.get("Authorization"), "Bearer shopping-token");
    assert.equal(options.signal, controller.signal);
  }
});

test("shopping failures reject with actionable errors without changing the session", async () => {
  setToken("shopping-token");
  globalThis.fetch = async () => Response.json({}, { status: 403 });
  await assert.rejects(api.shopping(7), { status: 403 });
  globalThis.fetch = async () => Response.json({}, { status: 422 });
  await assert.rejects(api.addShopping(7, ""), (error) => error.status === 422 && !error.message.includes("Пароль"));
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  await assert.rejects(api.setShoppingDone(7, 12, true), { status: 0 });
  assert.equal(getToken(), "shopping-token");
});

test("chore filters and create preserve backend enums, rotation order and ISO due dates", async () => {
  const calls = [];
  const controller = new AbortController();
  const item = { id: 9, room_id: 7, title: "Clean", owner_id: 3, difficulty: 4,
    due_at: "2026-11-18T16:00:00.000Z", status: "waiting", repeat: "weekly", rotation: "rotate", rotation_ids: [3, 1, 2] };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json(options.method === "POST" ? item : [item]);
  };
  setToken("chores-token");
  for (const filter of ["all", "mine", "waiting", "done"]) {
    const rows = await api.chores(7, filter, controller.signal);
    assert.equal(rows[0].status, "waiting");
    assert.equal(calls.at(-1).url, `/api/v1/rooms/7/chores?filter=${filter}`);
  }
  const { id, room_id, status, ...payload } = item;
  const result = await api.addChore(7, payload, controller.signal);
  assert.deepEqual(result, item);
  assert.equal(calls.at(-1).url, "/api/v1/rooms/7/chores");
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), payload);
  for (const { options } of calls) {
    assert.equal(options.headers.get("Authorization"), "Bearer chores-token");
    assert.equal(options.signal, controller.signal);
  }
});

test("chore actions use dedicated endpoints and return server status without generating successors locally", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ id: 9, status: url.endsWith("/complete") ? "done" : "active" });
  };
  setToken("chores-token");
  for (const action of ["accept", "complete", "reopen"]) {
    const result = await api.choreAction(7, 9, action);
    assert.equal(result.status, action === "complete" ? "done" : "active");
    assert.equal(calls.at(-1).url, `/api/v1/rooms/7/chores/9/${action}`);
    assert.equal(calls.at(-1).options.method, "POST");
    assert.equal(calls.at(-1).options.body, undefined);
  }
  globalThis.fetch = async () => Response.json({}, { status: 403 });
  await assert.rejects(api.choreAction(7, 9, "accept"), { status: 403 });
  globalThis.fetch = async () => Response.json({}, { status: 409 });
  await assert.rejects(api.choreAction(7, 9, "reopen"), { status: 409 });
});

test("private 401 clears the session; login failures do not clear it", async () => {
  let expired = 0;
  const listener = () => expired++;
  window.addEventListener("roomie:unauthorized", listener);
  globalThis.fetch = async () => Response.json({ detail: "Unauthorized" }, { status: 401 });
  setToken("jwt-token");
  await assert.rejects(api.login("user@example.com", "badpassword"), { status: 401 });
  assert.equal(getToken(), "jwt-token");
  await assert.rejects(api.me(), { status: 401 });
  assert.equal(getToken(), null);
  assert.equal(storage.size, 0);
  assert.equal(expired, 1);
  window.removeEventListener("roomie:unauthorized", listener);
});

test("late 401 from an old session cannot log out the next user", async () => {
  let finish;
  globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
  setToken("old-token");
  const pending = api.me();
  setToken("next-token");
  finish(Response.json({}, { status: 401 }));
  await assert.rejects(pending, { status: 401 });
  assert.equal(getToken(), "next-token");
});

test("network failures are retryable, aborts remain distinguishable", async () => {
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(api.rooms(), { status: 0 });
  const controller = new AbortController();
  globalThis.fetch = async (_, options) => {
    assert.equal(options.signal, controller.signal);
    throw new DOMException("Aborted", "AbortError");
  };
  await assert.rejects(api.rooms(controller.signal), { name: "AbortError" });
});

test("invite links preserve codes, work locally and reject invalid input", () => {
  assert.equal(inviteCode("http://localhost:8443/invite/a_b-123"), "a_b-123");
  assert.equal(inviteCode("a_b-123"), "a_b-123");
  assert.equal(inviteCode("https://example.com/subpath/invite/code"), "code");
  assert.equal(inviteCode("bad code!"), "");
  assert.equal(inviteCode(""), "");
  assert.equal(inviteLink("abc"), "http://localhost:8443/invite/abc");
});

test("ISO labels use Kyiv calendar dates, including midnight and DST", () => {
  const now = new Date("2026-11-14T10:00:00Z");
  assert.equal(formatTimestamp("2026-11-14T17:00:00Z", now), "Сьогодні, 19:00");
  assert.equal(formatTimestamp("2026-11-13T17:00:00Z", now), "Учора, 19:00");
  assert.equal(formatTimestamp("2026-11-14T22:00:00Z", now), "Завтра, 00:00");
  assert.equal(formatTimestamp("2026-03-29T15:00:00Z", new Date("2026-03-29T09:00:00Z")), "Сьогодні, 18:00");
  assert.equal(formatTimestamp("invalid", now), "");
});
