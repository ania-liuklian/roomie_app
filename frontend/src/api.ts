const baseUrl = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/$/, "");
const tokenKey = "roomie-access-token";
let accessToken = sessionStorage.getItem(tokenKey);

export function getToken() {
  return accessToken;
}

export function setToken(token: string | null) {
  accessToken = token;
  if (token) sessionStorage.setItem(tokenKey, token);
  else sessionStorage.removeItem(tokenKey);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  const token = authenticated ? getToken() : null;
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Не вдалося з’єднатися із сервером. Спробуйте ще раз.");
  }
  if (!response.ok) {
    if (response.status === 401 && token && getToken() === token) {
      setToken(null);
      window.dispatchEvent(new Event("roomie:unauthorized"));
    }
    // Do not log bodies: future expense payloads can contain private notes.
    const messages: Record<number, string> = {
      401: authenticated ? "Сесія завершилася. Увійдіть знову." : "Невірна пошта або пароль.",
      403: "Немає доступу до цієї кімнати.",
      404: "Кімнату, запрошення або запис не знайдено.",
      409: path === "/auth/register" ? "Ця електронна пошта вже зареєстрована."
        : path.includes("/settlements") ? "Сума перевищує поточний борг або вже очікує підтвердження. Оновіть баланс."
        : "Дані змінилися. Оновіть сторінку та спробуйте ще раз.",
      422: path.startsWith("/auth/") ? "Перевірте введені дані. Пароль: щонайменше 8 символів, до 72 байтів UTF-8." : "Перевірте введені дані та спробуйте ще раз.",
    };
    throw new ApiError(response.status, messages[response.status] || "Не вдалося виконати дію. Спробуйте ще раз.");
  }
  return response.status === 204 ? undefined as T : response.json();
}

export type ApiMember = { id: number; name: string; email: string; color: string;
  eye_style: "plain" | "lashes"; gaze: "straight" | "left" | "right" | "up" | "happy" | "sleepy" };
export type ApiStats = { room_count: number; completed_chores: number;
  workloads: { room_id: number; members: { user_id: number; unfinished_chores: number; workload_percent: number }[] }[] };
export type ApiRoom = { id: number; number: string; accent: string; member_ids: number[]; created_at: string; updated_at: string };
export type InvitePreview = { number: string; accent: string };
export type ChoreFilter = "all" | "mine" | "waiting" | "done";
export type ApiChore = {
  owner?: ApiMember;
  id: number; room_id: number; title: string; owner_id: number; difficulty: number;
  due_at: string; status: "waiting" | "active" | "done";
  repeat: "once" | "weekly"; rotation: "same" | "rotate"; rotation_ids: number[];
};
export type ChoreCreate = Omit<ApiChore, "id" | "room_id" | "status">;
export type ApiExpense = {
  payer?: ApiMember; participants?: ApiMember[];
  id: number; room_id: number; title: string; amount_minor: number; payer_id: number;
  participant_ids: number[]; shares: { user_id: number; share_minor: number }[];
  note: string; occurred_at: string;
};
export type ApiSettlement = {
  debtor?: ApiMember; creditor?: ApiMember;
  id: number; room_id: number; debtor_id: number; creditor_id: number; amount_minor: number;
  status: "requested" | "paid"; requested_at: string; paid_at: string | null;
};
export type ApiDebt = { debtor?: ApiMember; creditor?: ApiMember; debtor_id: number; creditor_id: number; amount_minor: number; requested_minor: number; status: "unpaid" | "requested" };
export type ApiMoney = {
  balances: { user_id: number; balance_minor: number }[]; debts: ApiDebt[];
  owed_by_me: ApiDebt[]; owed_to_me: ApiDebt[];
  total_i_owe_minor: number; total_owed_to_me_minor: number; my_balance_minor: number;
  settlements: ApiSettlement[];
};
export type ApiToday = {
  date: string; week_start: string; chores: ApiChore[];
  weekly_progress: { done: number; total: number; percent: number };
  money: { total_i_owe_minor: number; total_owed_to_me_minor: number; my_balance_minor: number };
  shopping: { total: number; done: number; remaining: number };
};
export type ApiShoppingItem = {
  buyer?: ApiMember | null;
  id: number; room_id: number; title: string; done: boolean;
  buyer_id: number | null; completed_at: string | null;
  created_by_id: number; created_at: string; updated_at: string;
};

export const api = {
  login: (email: string, password: string) => request<{ access_token: string }>("/auth/login", {
    method: "POST", body: JSON.stringify({ email, password }),
  }, false),
  register: (name: string, email: string, password: string) => request<{ access_token: string }>("/auth/register", {
    method: "POST", body: JSON.stringify({ name, email, password }),
  }, false),
  me: (signal?: AbortSignal) => request<ApiMember>("/me", { signal }),
  updateMe: (data: Partial<Pick<ApiMember, "name" | "color" | "eye_style" | "gaze">>, signal?: AbortSignal) => request<ApiMember>("/me", { method: "PATCH", body: JSON.stringify(data), signal }),
  stats: (signal?: AbortSignal) => request<ApiStats>("/me/stats", { signal }),
  rooms: (signal?: AbortSignal) => request<ApiRoom[]>("/rooms", { signal }),
  members: (roomId: number, signal?: AbortSignal) => request<ApiMember[]>(`/rooms/${roomId}/members`, { signal }),
  invite: (roomId: number, signal?: AbortSignal) => request<{ code: string; path: string }>(`/rooms/${roomId}/invite`, { signal }),
  createRoom: (number: string) => request<ApiRoom>("/rooms", { method: "POST", body: JSON.stringify({ number }) }),
  previewInvite: (code: string, signal?: AbortSignal) => request<InvitePreview>(`/invites/${encodeURIComponent(code)}`, { signal }, false),
  joinRoom: (code: string) => request<ApiRoom>(`/invites/${encodeURIComponent(code)}/join`, { method: "POST" }),
  shopping: (roomId: number, signal?: AbortSignal) => request<ApiShoppingItem[]>(`/rooms/${roomId}/shopping-items`, { signal }),
  addShopping: (roomId: number, title: string, signal?: AbortSignal) => request<ApiShoppingItem>(`/rooms/${roomId}/shopping-items`, {
    method: "POST", body: JSON.stringify({ title }), signal,
  }),
  setShoppingDone: (roomId: number, itemId: number, done: boolean, signal?: AbortSignal) => request<ApiShoppingItem>(`/rooms/${roomId}/shopping-items/${itemId}`, {
    method: "PATCH", body: JSON.stringify({ done }), signal,
  }),
  chores: (roomId: number, filter: ChoreFilter = "all", signal?: AbortSignal) => request<ApiChore[]>(`/rooms/${roomId}/chores?filter=${filter}`, { signal }),
  addChore: (roomId: number, data: ChoreCreate, signal?: AbortSignal) => request<ApiChore>(`/rooms/${roomId}/chores`, { method: "POST", body: JSON.stringify(data), signal }),
  choreAction: (roomId: number, id: number, action: "accept" | "complete" | "reopen", signal?: AbortSignal) => request<ApiChore>(`/rooms/${roomId}/chores/${id}/${action}`, { method: "POST", signal }),
  expenses: (roomId: number, signal?: AbortSignal) => request<ApiExpense[]>(`/rooms/${roomId}/expenses`, { signal }),
  expense: (roomId: number, id: number, signal?: AbortSignal) => request<ApiExpense>(`/rooms/${roomId}/expenses/${id}`, { signal }),
  addExpense: (roomId: number, data: { title: string; amount_minor: number; participant_ids: number[]; note: string }, signal?: AbortSignal) => request<ApiExpense>(`/rooms/${roomId}/expenses`, { method: "POST", body: JSON.stringify(data), signal }),
  money: (roomId: number, signal?: AbortSignal) => request<ApiMoney>(`/rooms/${roomId}/money`, { signal }),
  today: (roomId: number, signal?: AbortSignal) => request<ApiToday>(`/rooms/${roomId}/today`, { signal }),
  reportPayment: (roomId: number, creditorId: number, amountMinor: number, signal?: AbortSignal) => request<ApiSettlement>(`/rooms/${roomId}/settlements`, {
    method: "POST", body: JSON.stringify({ creditor_id: creditorId, amount_minor: amountMinor }), signal,
  }),
  confirmPayment: (roomId: number, id: number, signal?: AbortSignal) => request<ApiSettlement>(`/rooms/${roomId}/settlements/${id}/confirm`, { method: "POST", signal }),
};

export function inviteCode(value: string): string {
  const input = value.trim();
  if (!input) return "";
  try {
    const url = new URL(input, window.location.origin);
    const match = url.pathname.match(/\/invite\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : /^[-_a-zA-Z0-9]+$/.test(input) ? input : "";
  } catch {
    return "";
  }
}

export function inviteLink(code: string): string {
  return new URL(`${import.meta.env.BASE_URL}invite/${encodeURIComponent(code)}`, window.location.origin).href;
}

/** Calendar labels and times use Kyiv, independently of the browser's timezone. */
export function formatTimestamp(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const calendar = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const dayNumber = (value: Date) => {
    const parts = calendar.formatToParts(value);
    const part = (type: string) => Number(parts.find((item) => item.type === type)!.value);
    return Date.UTC(part("year"), part("month") - 1, part("day")) / 86400000;
  };
  const difference = dayNumber(date) - dayNumber(now);
  const label = difference === 0 ? "Сьогодні" : difference === 1 ? "Завтра" : difference === -1 ? "Учора"
    : new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "numeric", month: "long" }).format(date);
  const clock = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `${label}, ${clock}`;
}

/** Current Monday–Sunday strip in Kyiv; no fixed demo dates. */
export function currentWeek(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Kyiv", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const part = (type: string) => Number(parts.find((item) => item.type === type)!.value);
  const current = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  const monday = new Date(current);
  monday.setUTCDate(current.getUTCDate() - (current.getUTCDay() + 6) % 7);
  return ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map((label, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return { label, day: date.getUTCDate(), key: date.toISOString().slice(0, 10), current: date.getTime() === current.getTime() };
  });
}
