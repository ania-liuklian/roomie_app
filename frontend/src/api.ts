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
      409: path === "/auth/register" ? "Ця електронна пошта вже зареєстрована." : "Дані змінилися. Оновіть сторінку та спробуйте ще раз.",
      422: path.startsWith("/auth/") ? "Перевірте введені дані. Пароль: щонайменше 8 символів, до 72 байтів UTF-8." : "Перевірте введені дані та спробуйте ще раз.",
    };
    throw new ApiError(response.status, messages[response.status] || "Не вдалося виконати дію. Спробуйте ще раз.");
  }
  return response.status === 204 ? undefined as T : response.json();
}

export type ApiMember = { id: number; name: string; email: string; color: string };
export type ApiRoom = { id: number; number: string; accent: string; member_ids: number[]; created_at: string; updated_at: string };
export type InvitePreview = { number: string; accent: string };
export type ApiShoppingItem = {
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
