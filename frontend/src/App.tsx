import { FormEvent, useEffect, useRef, useState } from "react";
import { GoogleSignIn } from "./GoogleSignIn";
import { api, getToken, setToken, inviteCode, inviteLink, formatTimestamp, currentWeek, type ApiChore, type ApiMember, type ApiRoom, type ApiShoppingItem, type InvitePreview } from "./api";
import type { ApiDebt, ApiExpense, ApiMoney, ApiSettlement, ApiStats, ApiToday } from "./api";
import { money } from "./money";
import Avatar, { avatarOptions, type AvatarOptions } from "./Avatar";
import AvatarPicker from "./AvatarPicker";
import NotificationBell from "./NotificationBell";
import { dueForSave, localDateTime } from "./choreForm";

type Page = "today" | "chores" | "shopping" | "money" | "room" | "profile";
type ModalName = "invite" | "join" | "room" | "chore" | "chore-edit" | "chore-delete" | "expense" | "shopping" | "shopping-delete" | null;
type Member = AvatarOptions & {
  id: number;
  name: string;
  initials: string;
  color: string;
  email: string;
};
type Room = { id: number; number: string; memberIds: number[]; accent: string };
type Chore = {
  id: number;
  roomId: number;
  title: string;
  ownerId: number;
  difficulty: number;
  due: string;
  dueAt: string;
  status: "waiting" | "active" | "done";
  repeat: "Один раз" | "Щотижня";
  rotation: "same" | "rotate";
  rotationIds: number[];
};
type Expense = {
  id: number;
  roomId: number;
  title: string;
  amount: string;
  shares: { user_id: number; share_minor: number }[];
  payerId: number;
  participantIds: number[];
  note: string;
  date: string;
};
type DebtView = { id: string; debtorId: number; creditorId: number; amount: string;
  availableMinor: number; requestedMinor: number; status: "unpaid" | "requested"; pending: ApiSettlement[] };
type ShoppingItem = { id: number; roomId: number; title: string; done: boolean; buyerId?: number };

const nav: { id: Page; label: string; icon: string }[] = [
  { id: "today", label: "Сьогодні", icon: "spark" },
  { id: "chores", label: "Обов’язки", icon: "tasks" },
  { id: "money", label: "Гроші", icon: "wallet" },
  { id: "shopping", label: "Покупки", icon: "bag" },
  { id: "room", label: "Мешканці", icon: "users" },
];

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    spark: (
      <>
        <path d="M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2L12 3Z" />
        <path d="m19 3 .7 1.8L22 6l-2.3 1.2L19 9l-.7-1.8L16 6l2.3-1.2L19 3Z" />
      </>
    ),
    tasks: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="3" />
        <path d="m8 11 2 2 5-5M8 17h8" />
      </>
    ),
    bag: (
      <>
        <path d="M5 8h14l-1 13H6L5 8Z" />
        <path d="M9 9V6a3 3 0 0 1 6 0v3" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19v16H6.5A2.5 2.5 0 0 1 4 17.5v-11Z" />
        <path d="M4 7h13M15 12h6v5h-6a2.5 2.5 0 0 1 0-5Z" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.8M16 3.2a4 4 0 0 1 0 7.6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    down: <path d="m6 9 6 6 6-6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </>
    ),
    camera: (
      <>
        <path d="M14.5 5 13 3h-2L9.5 5H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4.5Z" />
        <circle cx="12" cy="12" r="4" />
      </>
    ),
    rotate: (
      <>
        <path d="M20 7h-6V1" />
        <path d="M20 7a9 9 0 1 0 1 8" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
      </>
    ),
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    receipt: (
      <>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
        <path d="M9 8h6M9 12h6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    dots: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
        <circle cx="19" cy="12" r="1" fill="currentColor" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17l5-5-5-5M15 12H3" />
        <path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Stars({ value, onChange }: { value: number; onChange?: (value: number) => void }) {
  return (
    <span className={`stars ${onChange ? "editable" : ""}`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          type="button"
          key={star}
          className={star <= value ? "on" : ""}
          onClick={() => onChange?.(star)}
          aria-label={`${star} з 5`}
        >
          ★
        </button>
      ))}
    </span>
  );
}

function Modal({
  title,
  note,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  note?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className={`modal ${wide ? "modal-wide" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {note && <p>{note}</p>}
          </div>
          <button className="icon-button" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function toMember(user: ApiMember): Member {
  return { ...user, initials: user.name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() };
}

function mergeMembers(existing: Member[], users: (ApiMember | null | undefined)[]): Member[] {
  const byId = new Map(existing.map((user) => [user.id, user]));
  for (const user of users) if (user) byId.set(user.id, toMember(user));
  return [...byId.values()];
}

function toRoom(room: ApiRoom): Room {
  return { id: room.id, number: room.number, accent: room.accent, memberIds: room.member_ids };
}

function toShoppingItem(item: ApiShoppingItem): ShoppingItem {
  return { id: item.id, roomId: item.room_id, title: item.title, done: item.done, buyerId: item.buyer_id ?? undefined };
}

function toChore(item: ApiChore): Chore {
  return { id: item.id, roomId: item.room_id, title: item.title, ownerId: item.owner_id,
    difficulty: item.difficulty, due: formatTimestamp(item.due_at), dueAt: item.due_at, status: item.status,
    repeat: item.repeat === "weekly" ? "Щотижня" : "Один раз", rotation: item.rotation, rotationIds: item.rotation_ids };
}

function toExpense(item: ApiExpense, detail = false): Expense {
  return { id: item.id, roomId: item.room_id, title: item.title, amount: money(item.amount_minor),
    payerId: item.payer_id, participantIds: item.participant_ids, shares: item.shares,
    note: detail ? item.note : "", date: formatTimestamp(item.occurred_at) };
}

function debtViews(items: ApiDebt[], summary: ApiMoney): DebtView[] {
  return items.map((item) => ({ id: `${item.debtor_id}-${item.creditor_id}`,
    debtorId: item.debtor_id, creditorId: item.creditor_id, amount: money(item.amount_minor),
    availableMinor: item.amount_minor - item.requested_minor, requestedMinor: item.requested_minor, status: item.status,
    pending: summary.settlements.filter((payment) => payment.status === "requested" && payment.debtor_id === item.debtor_id && payment.creditor_id === item.creditor_id) }));
}

function SessionPanel({ children }: { children: React.ReactNode }) {
  return <div className="modal-backdrop"><section className="modal">
    <header><div><h2>Roomie</h2><p>Ваш спільний простір</p></div></header>
    {children}
  </section></div>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const email = String(data.get("email")).trim();
      const password = String(data.get("password"));
      const result = register
        ? await api.register(String(data.get("name")).trim(), email, password)
        : await api.login(email, password);
      onAuthenticated(result.access_token);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не вдалося увійти.");
    } finally {
      setBusy(false);
    }
  };
  return <SessionPanel>
    <form className="form" onSubmit={submit} aria-busy={busy}>
      <h3>{register ? "Створити акаунт" : "Увійти"}</h3>
      {inviteCode(window.location.href) && <p>Увійдіть або зареєструйтеся, щоб приєднатися за запрошенням.</p>}
      {register && <label>Ім’я<input name="name" autoComplete="name" required maxLength={100} disabled={busy} /></label>}
      <label>Електронна пошта<input name="email" type="email" autoComplete="email" required disabled={busy} /></label>
      <label>Пароль<input name="password" type="password" minLength={8} required autoComplete={register ? "new-password" : "current-password"} disabled={busy} /></label>
      {error && <p role="alert">{error}</p>}
      <button className="primary-button" style={{ justifySelf: "center" }} disabled={busy}>{busy ? "Зачекайте…" : register ? "Зареєструватися" : "Увійти"}</button>
      <button className="ghost-button" type="button" disabled={busy} onClick={() => { setRegister(!register); setError(""); }}>
        {register ? "Вже є акаунт? Увійти" : "Немає акаунта? Зареєструватися"}
      </button>
      {import.meta.env.VITE_GOOGLE_CLIENT_ID && <>
      <p style={{ textAlign: "center", margin: "4px 0", color: "var(--muted)" }}>або</p>
      <GoogleSignIn disabled={busy} onCredential={async (credential) => {
        setBusy(true);
        setError("");
        try {
          const result = await api.googleLogin(credential);
          onAuthenticated(result.access_token);
        } catch (error) {
          setError(error instanceof Error ? error.message : "Не вдалося увійти через Google.");
        } finally {
          setBusy(false);
        }
      }} />
      </>}
    </form>
  </SessionPanel>;
}

export default function App() {
  const [token, setAccessToken] = useState(getToken);
  const [me, setMe] = useState<Member | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const logout = () => { setToken(null); setAccessToken(null); setMe(null); setError(""); };

  useEffect(() => {
    const expired = () => { setAccessToken(null); setMe(null); };
    window.addEventListener("roomie:unauthorized", expired);
    return () => window.removeEventListener("roomie:unauthorized", expired);
  }, []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setMe(null);
    setError("");
    api.me(controller.signal).then((user) => {
      if (!controller.signal.aborted) setMe(toMember(user));
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [token, retry]);

  if (!token) return <AuthScreen onAuthenticated={(value) => { setToken(value); setAccessToken(value); }} />;
  if (!me) return <SessionPanel><div className="form">
    {error ? <><p role="alert">{error}</p><button className="primary-button" onClick={() => setRetry(retry + 1)}>Спробувати ще раз</button></> : <p role="status">Завантаження профілю…</p>}
    <button className="ghost-button" onClick={logout}>Вийти</button>
  </div></SessionPanel>;
  return <ConnectedApp key={token} currentUser={me} onLogout={logout} onProfileSaved={(user) => setMe(toMember(user))} />;
}

function ConnectedApp({ currentUser, onLogout, onProfileSaved }: { currentUser: Member; onLogout: () => void; onProfileSaved: (user: ApiMember) => void }) {
  const currentUserId = currentUser.id;
  const [page, setPage] = useState<Page>("today");
  const [modal, setModal] = useState<ModalName>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState(0);
  const [members, setMembers] = useState<Member[]>([currentUser]);
  const [profileName, setProfileName] = useState(currentUser.name);
  const [profileAvatar, setProfileAvatar] = useState(() => avatarOptions(currentUser));
  const [todayResult, setTodayResult] = useState<{ roomId: number; data: ApiToday } | null>(null);
  const [todayLoading, setTodayLoading] = useState(false);
  const [todaySaving, setTodaySaving] = useState(false);
  const [todayError, setTodayError] = useState("");
  const [todayReload, setTodayReload] = useState(0);
  const todayRequest = useRef<{ roomId: number; controller: AbortController } | null>(null);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");
  const [statsReload, setStatsReload] = useState(0);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [googleLinked, setGoogleLinked] = useState<boolean | null>(null);
  const [googleStatusError, setGoogleStatusError] = useState("");
  const profileRequest = useRef<AbortController | null>(null);
  const [filteredChores, setFilteredChores] = useState<Chore[]>([]);
  const [choreMenu, setChoreMenu] = useState<number | null>(null);
  const [choreTarget, setChoreTarget] = useState<Chore | null>(null);
  const [choresRoomId, setChoresRoomId] = useState(0);
  const [choresLoading, setChoresLoading] = useState(false);
  const [choresError, setChoresError] = useState("");
  const [choresFormError, setChoresFormError] = useState("");
  const [choresSaving, setChoresSaving] = useState(false);
  const [choresReload, setChoresReload] = useState(0);
  const choresRequest = useRef<{ roomId: number; controller: AbortController } | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [moneySummary, setMoneySummary] = useState<ApiMoney | null>(null);
  const [moneyRoomId, setMoneyRoomId] = useState(0);
  const [moneyLoading, setMoneyLoading] = useState(false);
  const [moneySaving, setMoneySaving] = useState(false);
  const [moneyError, setMoneyError] = useState("");
  const [expenseFormError, setExpenseFormError] = useState("");
  const [moneyReload, setMoneyReload] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const moneyRequest = useRef<{ roomId: number; controller: AbortController } | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [shoppingRoomId, setShoppingRoomId] = useState(0);
  const [shoppingLoading, setShoppingLoading] = useState(false);
  const [shoppingError, setShoppingError] = useState("");
  const [shoppingReload, setShoppingReload] = useState(0);
  const [shoppingSaving, setShoppingSaving] = useState(false);
  const [shoppingFormError, setShoppingFormError] = useState("");
  const [shoppingDeleteTarget, setShoppingDeleteTarget] = useState<ShoppingItem | null>(null);
  const [shoppingDeleteError, setShoppingDeleteError] = useState("");
  const shoppingRequest = useRef<{ roomId: number; controller: AbortController } | null>(null);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState("");
  const [reload, setReload] = useState(0);
  const [roomLoading, setRoomLoading] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [roomReload, setRoomReload] = useState(0);
  const [invite, setInvite] = useState<{ roomId: number; code: string } | null>(null);
  const [pendingCode, setPendingCode] = useState(() => inviteCode(window.location.href));
  const [joinInput, setJoinInput] = useState("");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [previewError, setPreviewError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [toast, setToast] = useState("");
  const [difficulty, setDifficulty] = useState(3);
  const [repeat, setRepeat] = useState<"Один раз" | "Щотижня">("Один раз");
  const [rotation, setRotation] = useState<"same" | "rotate">("same");
  const [choreFilter, setChoreFilter] = useState<"all" | "mine" | "waiting" | "done">("all");

  useEffect(() => {
    if (choreMenu === null) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".chore-actions")) setChoreMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setChoreMenu(null); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [choreMenu]);

  useEffect(() => {
    setProfileName(currentUser.name);
    setProfileAvatar(avatarOptions(currentUser));
  }, [currentUser.name, currentUser.color, currentUser.eye_style, currentUser.gaze]);

  useEffect(() => {
    if (page !== "profile") return;
    const controller = new AbortController();
    profileRequest.current = controller;
    setProfileSaving(false);
    setProfileError("");
    return () => { controller.abort(); profileRequest.current = null; };
  }, [page]);

  useEffect(() => {
    if (page !== "profile" || !import.meta.env.VITE_GOOGLE_CLIENT_ID) return;
    const controller = new AbortController();
    setGoogleLinked(null);
    setGoogleStatusError("");
    api.googleLinkStatus(controller.signal).then(({ linked }) => {
      if (!controller.signal.aborted) setGoogleLinked(linked);
    }).catch((error: Error) => {
      if (!controller.signal.aborted && error.name !== "AbortError") setGoogleStatusError(error.message);
    });
    return () => controller.abort();
  }, [page]);

  useEffect(() => {
    if (page !== "profile" && page !== "room") return;
    const controller = new AbortController();
    setStats(null);
    setStatsLoading(true);
    setStatsError("");
    api.stats(controller.signal).then((data) => {
      if (!controller.signal.aborted) setStats(data);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setStatsError(error.message);
    }).finally(() => { if (!controller.signal.aborted) setStatsLoading(false); });
    return () => controller.abort();
  }, [page, roomId, statsReload]);

  useEffect(() => {
    const controller = new AbortController();
    setRoomsLoading(true);
    setRoomsError("");
    api.rooms(controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      const next = items.map(toRoom);
      setRooms(next);
      setRoomId((id) => next.some((item) => item.id === id) ? id : next[0]?.id || 0);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setRoomsError(error.message);
    }).finally(() => { if (!controller.signal.aborted) setRoomsLoading(false); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    setMembers([currentUser]);
    setInvite(null);
    setRoomLoading(true);
    setRoomError("");
    Promise.all([api.members(roomId, controller.signal), api.invite(roomId, controller.signal)])
      .then(([people, code]) => {
        if (controller.signal.aborted) return;
        setMembers((existing) => mergeMembers(existing, people));
        setRooms((items) => items.map((item) => item.id === roomId ? { ...item, memberIds: people.map((person) => person.id) } : item));
        setInvite({ roomId, code: code.code });
      }).catch((error: Error) => {
        if (!controller.signal.aborted) setRoomError(error.message);
      }).finally(() => { if (!controller.signal.aborted) setRoomLoading(false); });
    return () => controller.abort();
  }, [roomId, roomReload, currentUser]);

  useEffect(() => {
    if (!pendingCode) return;
    const controller = new AbortController();
    setModal("join");
    setPreview(null);
    setPreviewError("");
    setPreviewLoading(true);
    api.previewInvite(pendingCode, controller.signal).then((value) => {
      if (!controller.signal.aborted) setPreview(value);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setPreviewError(error.message);
    }).finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
    return () => controller.abort();
  }, [pendingCode, previewRetry]);

  useEffect(() => {
    if (!roomId || page !== "shopping") return;
    const controller = new AbortController();
    shoppingRequest.current = { roomId, controller };
    setShoppingRoomId(roomId);
    setShopping([]);
    setShoppingLoading(true);
    setShoppingSaving(false);
    setShoppingError("");
    setShoppingFormError("");
    setShoppingDeleteTarget(null);
    setShoppingDeleteError("");
    setModal((value) => value === "shopping" || value === "shopping-delete" ? null : value);
    api.shopping(roomId, controller.signal).then((items) => {
      if (!controller.signal.aborted) {
        setShopping(items.map(toShoppingItem));
        setMembers((people) => mergeMembers(people, items.map((item) => item.buyer)));
      }
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setShoppingError(error.message);
    }).finally(() => { if (!controller.signal.aborted) setShoppingLoading(false); });
    return () => { controller.abort(); shoppingRequest.current = null; };
  }, [roomId, page, shoppingReload]);

  useEffect(() => {
    if (!roomId || page !== "chores") return;
    const controller = new AbortController();
    choresRequest.current = { roomId, controller };
    setChoresRoomId(roomId);
    setFilteredChores([]);
    setChoresLoading(true);
    setChoresSaving(false);
    setChoresError("");
    setChoresFormError("");
    setChoreMenu(null);
    setChoreTarget(null);
    setModal((value) => value === "chore" || value === "chore-edit" || value === "chore-delete" ? null : value);
    api.chores(roomId, choreFilter, controller.signal)
      .then((filtered) => {
        if (controller.signal.aborted) return;
        setFilteredChores(filtered.map(toChore));
        setMembers((people) => mergeMembers(people, filtered.map((item) => item.owner)));
      }).catch((error: Error) => {
        if (!controller.signal.aborted) setChoresError(error.message);
      }).finally(() => { if (!controller.signal.aborted) setChoresLoading(false); });
    return () => { controller.abort(); choresRequest.current = null; };
  }, [roomId, page, choreFilter, choresReload]);

  useEffect(() => {
    if (!roomId || page !== "money") return;
    const controller = new AbortController();
    moneyRequest.current = { roomId, controller };
    setMoneyRoomId(roomId);
    setMoneyLoading(true);
    setMoneySaving(false);
    setMoneyError("");
    setExpenseFormError("");
    setMoneySummary(null);
    setExpenses([]);
    setDetailExpense(null);
    setModal((value) => value === "expense" ? null : value);
    Promise.all([api.money(roomId, controller.signal), api.expenses(roomId, controller.signal)])
      .then(([summary, items]) => {
        if (controller.signal.aborted) return;
        setMoneySummary(summary);
        setExpenses(items.map((item) => toExpense(item)));
        setMembers((people) => mergeMembers(people, [
          ...items.flatMap((item) => [item.payer, ...(item.participants || [])]),
          ...summary.debts.flatMap((item) => [item.debtor, item.creditor]),
          ...summary.settlements.flatMap((item) => [item.debtor, item.creditor]),
        ]));
      }).catch((error: Error) => {
        if (!controller.signal.aborted) setMoneyError(error.message);
      }).finally(() => { if (!controller.signal.aborted) setMoneyLoading(false); });
    return () => { controller.abort(); detailRequest.current?.abort(); moneyRequest.current = null; };
  }, [roomId, page, moneyReload]);

  useEffect(() => {
    if (!roomId || page !== "today") return;
    const controller = new AbortController();
    todayRequest.current = { roomId, controller };
    setTodayResult(null);
    setTodayLoading(true);
    setTodaySaving(false);
    setTodayError("");
    api.today(roomId, controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setTodayResult({ roomId, data });
        setMembers((people) => mergeMembers(people, data.chores.map((item) => item.owner)));
      }
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setTodayError(error.message);
    }).finally(() => { if (!controller.signal.aborted) setTodayLoading(false); });
    return () => { controller.abort(); todayRequest.current = null; };
  }, [roomId, page, todayReload]);

  const room = rooms.find((item) => item.id === roomId) || { id: 0, number: "", memberIds: [], accent: "#7063df" };
  const roomMembers = members.filter((member) => room.memberIds.includes(member.id));
  const workloads = stats?.workloads.find((item) => item.room_id === roomId)?.members;
  const roomExpenses = expenses.filter((expense) => expense.roomId === roomId);
  const roomShopping = shopping.filter((item) => item.roomId === roomId);
  const inviteUrl = invite?.roomId === roomId ? inviteLink(invite.code) : "";
  const member = (id: number): Member => members.find((item) => item.id === id) || { id, name: "Мешканець", initials: "", color: "#7063df", email: "" };
  const summary = moneyRoomId === roomId ? moneySummary : null;
  const owedByMe = summary ? debtViews(summary.owed_by_me, summary) : [];
  const owedToMe = summary ? debtViews(summary.owed_to_me, summary) : [];
  const totalIOwe = money(summary?.total_i_owe_minor ?? 0);
  const totalOwedToMe = money(summary?.total_owed_to_me_minor ?? 0);
  const confirmedPayments = summary?.settlements.filter((item) => item.status === "paid") || [];
  const today = todayResult?.roomId === roomId ? todayResult.data : null;

  const completeTodayChore = async (id: number) => {
    const context = todayRequest.current;
    if (!context || context.roomId !== roomId || context.controller.signal.aborted || todaySaving) return;
    setTodaySaving(true);
    setTodayError("");
    try {
      await api.choreAction(roomId, id, "complete", context.controller.signal);
      if (!context.controller.signal.aborted) setTodayReload((value) => value + 1);
    } catch (error) {
      if (!context.controller.signal.aborted) setTodayError(error instanceof Error ? error.message : "Не вдалося завершити обов’язок.");
    } finally { if (!context.controller.signal.aborted) setTodaySaving(false); }
  };

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const controller = profileRequest.current;
    if (!controller || controller.signal.aborted || profileSaving) return;
    const name = profileName.trim();
    if (!name) { setProfileError("Введіть ім’я."); return; }
    setProfileSaving(true);
    setProfileError("");
    try {
      const user = await api.updateMe({ name, ...profileAvatar }, controller.signal);
      if (controller.signal.aborted) return;
      onProfileSaved(user);
      setProfileName(user.name);
      setProfileAvatar(avatarOptions(user));
      setMembers((items) => items.map((item) => item.id === user.id ? toMember(user) : item));
      notify("Профіль збережено");
    } catch (error) {
      if (!controller.signal.aborted) setProfileError(error instanceof Error ? error.message : "Не вдалося зберегти профіль.");
    } finally { if (!controller.signal.aborted) setProfileSaving(false); }
  };

  const repay = async (debt: DebtView, paymentId?: number) => {
    const context = moneyRequest.current;
    if (!context || context.roomId !== roomId || context.controller.signal.aborted || moneySaving) return;
    setMoneySaving(true);
    setMoneyError("");
    try {
      if (paymentId !== undefined) await api.confirmPayment(roomId, paymentId, context.controller.signal);
      else await api.reportPayment(roomId, debt.creditorId, debt.availableMinor, context.controller.signal);
      if (context.controller.signal.aborted) return;
      setMoneyReload((value) => value + 1);
      notify(paymentId === undefined ? "Запит про оплату надіслано" : "Оплату підтверджено");
    } catch (error) {
      if (!context.controller.signal.aborted) setMoneyError(error instanceof Error ? error.message : "Не вдалося оновити оплату.");
    } finally { if (!context.controller.signal.aborted) setMoneySaving(false); }
  };

  const openExpense = async (expense: Expense) => {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setDetailExpense(expense);
    setDetailLoading(true);
    setDetailError("");
    try {
      const item = await api.expense(expense.roomId, expense.id, controller.signal);
      if (!controller.signal.aborted) {
        setDetailExpense(toExpense(item, true));
        setMembers((people) => mergeMembers(people, [item.payer, ...(item.participants || [])]));
      }
    } catch (error) {
      if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : "Не вдалося завантажити витрату.");
    } finally { if (!controller.signal.aborted) setDetailLoading(false); }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      notify("Посилання скопійовано");
    } catch {
      setActionError("Не вдалося скопіювати. Скопіюйте посилання вручну.");
    }
  };

  const openJoin = () => {
    setActionError("");
    setPreviewError("");
    setPendingCode(invite?.roomId === roomId ? invite.code : "");
    setPreview(null);
    setPreviewRetry((value) => value + 1);
    setModal("join");
  };

  const createRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (actionBusy) return;
    const number = String(new FormData(event.currentTarget).get("number")).trim();
    if (!number) { setActionError("Введіть номер кімнати."); return; }
    setActionBusy(true);
    setActionError("");
    try {
      const created = toRoom(await api.createRoom(number));
      setRooms((items) => [...items, created]);
      setRoomId(created.id);
      setModal(null);
      setPage("room");
      notify(`Кімнату ${created.number} створено`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не вдалося створити кімнату.");
    } finally { setActionBusy(false); }
  };

  const joinRoom = async () => {
    if (!pendingCode || !preview || previewLoading || actionBusy) return;
    setActionBusy(true);
    setActionError("");
    try {
      const joined = toRoom(await api.joinRoom(pendingCode));
      setRooms((items) => [...items.filter((item) => item.id !== joined.id), joined]);
      setRoomId(joined.id);
      setRoomReload((value) => value + 1);
      setModal(null);
      setPendingCode("");
      setJoinInput("");
      window.history.replaceState(null, "", import.meta.env.BASE_URL);
      setPage("room");
      notify(`Ви приєдналися до кімнати ${joined.number}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не вдалося приєднатися.");
    } finally { setActionBusy(false); }
  };

  const addChore = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const context = choresRequest.current;
    if (!context || context.roomId !== roomId || context.controller.signal.aborted || choresSaving) return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title")).trim();
    const ownerId = Number(data.get("owner"));
    const due = new Date(String(data.get("due")));
    const rotate = repeat === "Щотижня" && rotation === "rotate";
    const rotationIds = rotate ? data.getAll("rotationIds").map(Number) : [ownerId];
    if (!title || Number.isNaN(due.getTime())) { setChoresFormError("Введіть назву та дату виконання."); return; }
    if (!rotationIds.includes(ownerId)) { setChoresFormError("Додайте призначеного мешканця до черги."); return; }
    setChoresSaving(true);
    setChoresFormError("");
    try {
      await api.addChore(roomId, { title, owner_id: ownerId, difficulty, due_at: due.toISOString(),
        repeat: repeat === "Щотижня" ? "weekly" : "once", rotation: rotate ? "rotate" : "same", rotation_ids: rotationIds }, context.controller.signal);
      if (context.controller.signal.aborted) return;
      setModal(null);
      setChoresReload((value) => value + 1);
      notify("Обов’язок створено");
    } catch (error) {
      if (!context.controller.signal.aborted) setChoresFormError(error instanceof Error ? error.message : "Не вдалося створити обов’язок.");
    } finally { if (!context.controller.signal.aborted) setChoresSaving(false); }
  };

  const changeChore = async (chore: Chore, action: "accept" | "complete" | "reopen") => {
    const context = choresRequest.current;
    if (!context || context.roomId !== chore.roomId || context.controller.signal.aborted || choresSaving) return;
    setChoresSaving(true);
    setChoresError("");
    try {
      await api.choreAction(chore.roomId, chore.id, action, context.controller.signal);
      if (context.controller.signal.aborted) return;
      // Reload the authoritative list, including any generated/removed successor.
      setChoresReload((value) => value + 1);
    } catch (error) {
      if (!context.controller.signal.aborted) setChoresError(error instanceof Error ? error.message : "Не вдалося оновити обов’язок.");
    } finally { if (!context.controller.signal.aborted) setChoresSaving(false); }
  };

  const manageChore = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const context = choresRequest.current;
    if (!choreTarget || !context || context.roomId !== choreTarget.roomId || context.controller.signal.aborted || choresSaving) return;
    let data: Parameters<typeof api.editChore>[2] | undefined;
    if (event) {
      const form = new FormData(event.currentTarget);
      const title = String(form.get("title")).trim();
      const dueInput = String(form.get("due"));
      const date = new Date(dueInput);
      if (!title || Number.isNaN(date.getTime())) { setChoresFormError("Введіть назву та дату виконання."); return; }
      data = { title, owner_id: Number(form.get("owner")), difficulty,
        due_at: dueForSave(dueInput, choreTarget.dueAt) };
    }
    setChoresSaving(true);
    setChoresFormError("");
    try {
      if (data) await api.editChore(choreTarget.roomId, choreTarget.id, data, context.controller.signal);
      else await api.deleteChore(choreTarget.roomId, choreTarget.id, context.controller.signal);
      if (context.controller.signal.aborted) return;
      setModal(null);
      setChoresReload((value) => value + 1);
      notify(data ? "Обов’язок оновлено" : "Обов’язок видалено");
    } catch (error) {
      if (!context.controller.signal.aborted) setChoresFormError(error instanceof Error ? error.message : "Не вдалося зберегти зміни.");
    } finally { if (!context.controller.signal.aborted) setChoresSaving(false); }
  };

  const addExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const context = moneyRequest.current;
    if (!context || context.roomId !== roomId || context.controller.signal.aborted || moneySaving) return;
    const data = new FormData(event.currentTarget);
    const participantIds = data.getAll("people").map(Number);
    setExpenseFormError("");
    let amountMinor: number;
    try { amountMinor = money(String(data.get("amount"))); }
    catch (error) { setExpenseFormError((error as Error).message); return; }
    if (!participantIds.length) { setExpenseFormError("Оберіть хоча б одного учасника."); return; }
    const title = String(data.get("title")).trim();
    if (!title) { setExpenseFormError("Введіть назву витрати."); return; }
    setMoneySaving(true);
    try {
      await api.addExpense(roomId, { title, amount_minor: amountMinor, participant_ids: participantIds,
        note: String(data.get("note")) }, context.controller.signal);
      if (context.controller.signal.aborted) return;
      setModal(null);
      setMoneyReload((value) => value + 1);
      notify("Витрату додано");
    } catch (error) {
      if (!context.controller.signal.aborted) setExpenseFormError(error instanceof Error ? error.message : "Не вдалося додати витрату.");
    } finally { if (!context.controller.signal.aborted) setMoneySaving(false); }
  };

  const addShopping = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const context = shoppingRequest.current;
    if (!context || context.roomId !== roomId || context.controller.signal.aborted || shoppingSaving) return;
    const title = String(new FormData(event.currentTarget).get("title")).trim();
    if (!title) { setShoppingFormError("Введіть назву покупки."); return; }
    setShoppingSaving(true);
    setShoppingFormError("");
    try {
      const item = await api.addShopping(roomId, title, context.controller.signal);
      if (context.controller.signal.aborted) return;
      setShopping((items) => [...items, toShoppingItem(item)]);
      setMembers((people) => mergeMembers(people, [item.buyer]));
      setModal(null);
      notify("Додано до списку");
    } catch (error) {
      if (!context.controller.signal.aborted) setShoppingFormError(error instanceof Error ? error.message : "Не вдалося додати покупку.");
    } finally { if (!context.controller.signal.aborted) setShoppingSaving(false); }
  };

  const toggleShopping = async (item: ShoppingItem) => {
    const context = shoppingRequest.current;
    if (!context || context.roomId !== item.roomId || context.controller.signal.aborted || shoppingSaving) return;
    setShoppingSaving(true);
    setShoppingError("");
    try {
      const updated = await api.setShoppingDone(item.roomId, item.id, !item.done, context.controller.signal);
      if (!context.controller.signal.aborted) {
        setShopping((items) => items.map((row) => row.id === updated.id ? toShoppingItem(updated) : row));
        setMembers((people) => mergeMembers(people, [updated.buyer]));
      }
    } catch (error) {
      if (!context.controller.signal.aborted) setShoppingError(error instanceof Error ? error.message : "Не вдалося оновити покупку.");
    } finally { if (!context.controller.signal.aborted) setShoppingSaving(false); }
  };

  const deleteShopping = async () => {
    const item = shoppingDeleteTarget;
    const context = shoppingRequest.current;
    if (!item || !context || context.roomId !== item.roomId || context.controller.signal.aborted || shoppingSaving) return;
    setShoppingSaving(true);
    setShoppingDeleteError("");
    try {
      await api.deleteShopping(item.roomId, item.id, context.controller.signal);
      if (context.controller.signal.aborted) return;
      setShopping((items) => items.filter((row) => row.id !== item.id));
      setShoppingDeleteTarget(null);
      setModal(null);
      notify("Покупку видалено");
    } catch (error) {
      if (!context.controller.signal.aborted) setShoppingDeleteError(error instanceof Error ? error.message : "Не вдалося видалити покупку.");
    } finally { if (!context.controller.signal.aborted) setShoppingSaving(false); }
  };

  const titles: Record<Page, { title: string; subtitle: string }> = {
    today: { title: "", subtitle: "" },
    chores: { title: "Обов’язки", subtitle: "" },
    shopping: { title: "Список покупок", subtitle: "" },
    money: { title: "Спільні гроші", subtitle: "" },
    room: { title: `Кімната ${room.number}`, subtitle: "" },
    profile: { title: "Мій профіль", subtitle: "" },
  };

  const closeRoomDialog = () => {
    if (actionBusy) return;
    setModal(null);
    setActionError("");
    setPendingCode("");
    setJoinInput("");
    if (inviteCode(window.location.href)) window.history.replaceState(null, "", import.meta.env.BASE_URL);
  };

  const roomDialogs = <>
    {modal === "invite" && <Modal title={`Запросити до кімнати ${room.number}`} note="Поділіться посиланням, щоб додати нового мешканця." onClose={closeRoomDialog}>
      <div className="invite-modal-content">
        <span className="modal-illustration"><Icon name="link" size={30} /></span>
        <h3>Одне посилання — і roomie всередині</h3>
        <p>Надішліть його в будь-який месенджер.</p>
        <div className="share-link">
          <button className="invite-url" onClick={openJoin} disabled={!inviteUrl}>{inviteUrl || "Завантаження посилання…"}</button>
          <button onClick={copyInvite} disabled={!inviteUrl}><Icon name="copy" size={17} />Скопіювати посилання</button>
        </div>
        {roomError && <p role="alert">{roomError}</p>}
        {actionError && <p role="alert">{actionError}</p>}
      </div>
    </Modal>}
    {modal === "join" && <Modal title={preview ? `Кімната ${preview.number}` : "Приєднатися до кімнати"} note="Відкрийте запрошення або введіть код кімнати." onClose={closeRoomDialog}>
      <form className="form" onSubmit={(event) => {
        event.preventDefault();
        const code = inviteCode(joinInput);
        if (!code) { setPreviewError("Введіть дійсне посилання або код запрошення."); return; }
        setActionError("");
        setPreview(null);
        setPendingCode(code);
        setPreviewRetry((value) => value + 1);
      }}>
        <label>Посилання або код запрошення<input name="invite" value={joinInput} onChange={(event) => setJoinInput(event.target.value)} disabled={actionBusy} placeholder="Код або посилання Roomie" /></label>
        <button className="outline-button" disabled={previewLoading || actionBusy || !joinInput.trim()}>Переглянути запрошення</button>
      </form>
      <div className="join-preview" aria-busy={previewLoading || actionBusy}>
        {previewLoading && <p role="status">Завантаження запрошення…</p>}
        {previewError && <><p role="alert">{previewError}</p>{pendingCode && <button className="ghost-button" disabled={actionBusy} onClick={() => setPreviewRetry((value) => value + 1)}>Спробувати ще раз</button>}</>}
        {preview && <><h3>Вас запросили жити разом</h3><p>Кімната {preview.number}</p>
          <p>Після приєднання ви побачите спільні справи, покупки та розрахунки.</p>
          <button className="primary-button" disabled={actionBusy || previewLoading} onClick={joinRoom}>{actionBusy ? "Приєднання…" : "Приєднатися"}<Icon name="arrow" size={16} /></button>
        </>}
        {actionError && <p role="alert">{actionError}</p>}
      </div>
    </Modal>}
    {modal === "room" && <Modal title="Створити нову кімнату" note="Можна мати кілька кімнат і легко перемикатися між ними." onClose={closeRoomDialog}>
      <form className="form" onSubmit={createRoom} aria-busy={actionBusy}>
        <label>Номер кімнати<input name="number" required maxLength={12} disabled={actionBusy} placeholder="Наприклад, 305-Б" /></label>
        {actionError && <p role="alert">{actionError}</p>}
        <div className="modal-actions">
          <button type="button" className="outline-button" disabled={actionBusy} onClick={closeRoomDialog}>Скасувати</button>
          <button className="primary-button" disabled={actionBusy}>{actionBusy ? "Створення…" : "Створити кімнату"}</button>
        </div>
      </form>
    </Modal>}
  </>;

  if (roomsLoading || roomsError || !rooms.length) return <>
    <SessionPanel><div className="form">
      <h3>Вітаємо, {currentUser.name}</h3>
      <NotificationBell />
      {roomsLoading ? <p role="status">Завантаження кімнат…</p> : roomsError ? <><p role="alert">{roomsError}</p><button className="primary-button" onClick={() => setReload((value) => value + 1)}>Спробувати ще раз</button></> : <>
        <p>Створіть свою першу кімнату або приєднайтеся за запрошенням.</p>
        <button className="primary-button" onClick={() => { setActionError(""); setModal("room"); }}>Створити кімнату</button>
        <button className="outline-button" onClick={openJoin}>Приєднатися до кімнати</button>
      </>}
      <button className="ghost-button" onClick={onLogout}>Вийти</button>
    </div></SessionPanel>
    {roomDialogs}
  </>;

  return (
    <div className="shell">
      <aside className="side">
        <button className="logo" onClick={() => setPage("today")}>
          <span>r</span>roomie
        </button>
        <div className="room-picker">
          <label>Поточна кімната</label>
          <div className="select-wrap">
            <select value={roomId} onChange={(event) => setRoomId(Number(event.target.value))}>
              {rooms.map((item) => (
                <option value={item.id} key={item.id}>
                  Кімната {item.number}
                </option>
              ))}
            </select>
            <Icon name="down" size={16} />
          </div>
          <div className="room-quick">
            <button onClick={() => setModal("invite")}>
              <Icon name="link" size={16} />
              Запрошення
            </button>
            <button onClick={() => setModal("room")}>
              <Icon name="plus" size={16} />
              Створити
            </button>
          </div>
          <button className="ghost-button" onClick={openJoin}>Приєднатися до кімнати</button>
        </div>
        <nav className="main-nav">
          {nav.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "active" : ""}
              onClick={() => setPage(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === "money" && owedToMe.some((debt) => debt.status === "requested") && <i />}
            </button>
          ))}
        </nav>
        <div className="side-invite">
          <div className="invite-avatars">
            {roomMembers.slice(0, 3).map((item) => (
              <Avatar member={item} size="xs" key={item.id} />
            ))}
            <span>+{Math.max(0, roomMembers.length - 3)}</span>
          </div>
          <strong>Ще один roomie?</strong>
          <p>Додайте за посиланням.</p>
          <button onClick={copyInvite} disabled={!inviteUrl}>Скопіювати посилання</button>
        </div>
        <button
          className={`user-chip ${page === "profile" ? "active" : ""}`}
          onClick={() => setPage("profile")}
        >
          <Avatar member={currentUser} size="sm" />
          <span>
            <strong>{currentUser.name}</strong>
            <small>Мій профіль</small>
          </span>
          <Icon name="chevron" size={15} />
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            {titles[page].title && <h1>{titles[page].title}</h1>}
            {titles[page].subtitle && <p>{titles[page].subtitle}</p>}
          </div>
          <div className="top-actions">
            <button className="ghost-button" onClick={onLogout}><Icon name="logout" size={17} />Вийти</button>
            <NotificationBell />
            <button className="top-avatar" onClick={() => setPage("profile")}>
              <Avatar member={currentUser} size="md" />
            </button>
          </div>
        </header>

        {roomLoading && <p className="page" role="status">Завантаження мешканців і запрошення…</p>}
        {roomError && <div className="page" role="alert"><p>{roomError}</p><button className="outline-button" onClick={() => setRoomReload((value) => value + 1)}>Спробувати ще раз</button></div>}
        {actionError && !modal && <p className="page" role="alert">{actionError}</p>}
        {(page === "profile" || page === "room") && statsLoading && <p className="page" role="status">Завантаження статистики…</p>}
        {(page === "profile" || page === "room") && statsError && <div className="page" role="alert"><p>{statsError}</p><button className="outline-button" onClick={() => setStatsReload((value) => value + 1)}>Спробувати ще раз</button></div>}

        {page === "today" && (
          <div className="page today-page" aria-busy={todayLoading || todaySaving}>
            <div className="today-title">
              <h2>Сьогодні</h2>
              <p>Кімната {room.number}</p>
            </div>
            {todayLoading && <p role="status">Завантаження підсумку дня…</p>}
            {todaySaving && <p role="status">Збереження…</p>}
            {todayError && <div role="alert"><p>{todayError}</p><button className="outline-button" disabled={todaySaving} onClick={() => setTodayReload((value) => value + 1)}>Спробувати ще раз</button></div>}
            <div className="today-grid">
              <section className="surface today-tasks">
                <div className="today-tasks-head">
                  <h3>Найближчі справи</h3>
                  <div>
                    <span>ПРОГРЕС ТИЖНЯ</span>
                    <strong>
                      {today ? `${today.weekly_progress.done} із ${today.weekly_progress.total}` : "—"}
                    </strong>
                    <i>
                      <b style={{ width: `${today?.weekly_progress.percent ?? 0}%` }} />
                    </i>
                  </div>
                </div>
                <div className="today-task-list">
                  {(today?.chores || []).map(toChore)
                    .map((chore) => (
                      <article key={chore.id}>
                        <button
                          className="round-check"
                          disabled={todaySaving || chore.ownerId !== currentUserId || chore.status !== "active"}
                          aria-label="Завершити обов’язок"
                          title={chore.status === "waiting" ? "Спочатку погодьте обов’язок на сторінці обов’язків." : "Завершити обов’язок"}
                          onClick={() => completeTodayChore(chore.id)}
                        />
                        <div>
                          <strong>{chore.title}</strong>
                          <span>
                            {chore.due} · {chore.repeat}
                          </span>
                        </div>
                        <Stars value={chore.difficulty} />
                        <Avatar member={member(chore.ownerId)} size="sm" />
                      </article>
                    ))}
                  {today && !today.chores.length && <p>Найближчих справ немає.</p>}
                </div>
                <button
                  className="leopard-cta"
                  onClick={() => {
                    setChoreFilter("mine");
                    setPage("chores");
                  }}
                >
                  <span>До моїх справ</span>
                  <Icon name="arrow" size={18} />
                </button>
              </section>

              <aside className="today-side">
                <section className="roomie-greeting">
                  <h3>Привіт, я Румі!</h3>
                  <Avatar member={currentUser} variant="peek" />
                </section>
                <button className="today-summary money-summary" onClick={() => setPage("money")}>
                  <h3>Гроші між вами</h3>
                  <Icon name="arrow" />
                  <div>
                    <span>
                      Ви винні <strong className="red">{today ? `−${money(today.money.total_i_owe_minor)} ₴` : "—"}</strong>
                    </span>
                    <span>
                      Вам винні <strong className="green">{today ? `+${money(today.money.total_owed_to_me_minor)} ₴` : "—"}</strong>
                    </span>
                  </div>
                </button>
                <button
                  className="today-summary shopping-summary"
                  onClick={() => setPage("shopping")}
                >
                  <span className="summary-icon">
                    <Icon name="bag" />
                  </span>
                  <span>
                    <strong>Покупки</strong>
                    <small>
                      {today ? today.shopping.remaining : "—"} позиції ще потрібно
                    </small>
                  </span>
                  <Icon name="arrow" />
                </button>
              </aside>
            </div>
          </div>
        )}

        {page === "chores" && (
          <div className="page">
            <div className="page-actions">
              <div className="segmented">
                <button
                  className={choreFilter === "all" ? "active" : ""}
                  onClick={() => setChoreFilter("all")}
                >
                  Усі
                </button>
                <button
                  className={choreFilter === "mine" ? "active" : ""}
                  onClick={() => setChoreFilter("mine")}
                >
                  Мої
                </button>
                <button
                  className={choreFilter === "waiting" ? "active" : ""}
                  onClick={() => setChoreFilter("waiting")}
                >
                  Очікують згоди
                </button>
                <button
                  className={choreFilter === "done" ? "active" : ""}
                  onClick={() => setChoreFilter("done")}
                >
                  Виконані
                </button>
              </div>
              <button className="primary-button" disabled={choresLoading || choresSaving || choresRoomId !== roomId || roomLoading || !!roomError} onClick={() => { setChoresFormError(""); setModal("chore"); }}>
                <Icon name="plus" size={18} />
                Новий обов’язок
              </button>
            </div>
            <section className="week-row">
              {currentWeek().map((day) => (
                <div className={day.current ? "current" : ""} key={day.key}>
                  <span>{day.label}</span>
                  <strong>{day.day}</strong>
                  {day.current && <i />}
                </div>
              ))}
            </section>
            <section className="surface task-board" aria-busy={choresLoading || choresSaving}>
              {(choresLoading || choresRoomId !== roomId) && <p role="status">Завантаження обов’язків…</p>}
              {choresRoomId === roomId && choresError && <div role="alert"><p>{choresError}</p><button className="outline-button" disabled={choresSaving} onClick={() => setChoresReload((value) => value + 1)}>Спробувати ще раз</button></div>}
              {choresSaving && <p role="status">Збереження…</p>}
              {choresRoomId === roomId && !choresLoading && !choresError && !filteredChores.length && <p>Немає обов’язків за цим фільтром.</p>}
              {choresRoomId === roomId && !choresLoading && filteredChores.map((chore) => (
                <article className={`full-task ${chore.status}`} key={chore.id}>
                  <button
                    className="large-check"
                    disabled={choresSaving || chore.ownerId !== currentUserId || chore.status === "waiting"}
                    aria-label={chore.status === "done" ? "Повернути до виконання" : "Завершити обов’язок"}
                    onClick={() => changeChore(chore, chore.status === "done" ? "reopen" : "complete")}
                  >
                    {chore.status === "done" && <Icon name="check" size={15} />}
                  </button>
                  <div className="full-task-copy">
                    <div>
                      <strong>{chore.title}</strong>
                      {chore.status === "waiting" && (
                        <span className="waiting-label">
                          {chore.ownerId === currentUserId
                            ? "ПОТРІБНА ВАША ЗГОДА"
                            : `ОЧІКУЄ ЗГОДИ ${member(chore.ownerId).name.split(" ")[0].toUpperCase()}`}
                        </span>
                      )}
                    </div>
                    <p>
                      {chore.due} · {chore.repeat}
                    </p>
                    <Stars value={chore.difficulty} />
                  </div>
                  <div className="repeat-person">
                    <Avatar member={member(chore.ownerId)} size="sm" />
                    <div>
                      <small>Виконує цього тижня</small>
                      <strong>{member(chore.ownerId).name.split(" ")[0]}</strong>
                    </div>
                  </div>
                  <div className="chore-controls">
                  {chore.status === "waiting" && chore.ownerId === currentUserId ? (
                    <button
                      className="approve-button"
                      disabled={choresSaving}
                      onClick={() => changeChore(chore, "accept")}
                    >
                      Погодити
                    </button>
                  ) : chore.status === "waiting" ? (
                    <span className="awaiting-approval">Очікує відповіді</span>
                  ) : null}
                  <div className="chore-actions">
                    <button className="dots-button" type="button" aria-label={`Дії: ${chore.title}`}
                      aria-expanded={choreMenu === chore.id} aria-controls={`chore-menu-${chore.id}`}
                      disabled={choresSaving} onClick={() => setChoreMenu(choreMenu === chore.id ? null : chore.id)}><Icon name="dots" /></button>
                    {choreMenu === chore.id && <div className="chore-menu" id={`chore-menu-${chore.id}`} role="group" aria-label="Дії з обов’язком">
                      {chore.status === "done" && <p>Спочатку поверніть справу до виконання.</p>}
                      <button className="ghost-button" type="button" disabled={chore.status === "done" || roomLoading || !!roomError}
                        onClick={() => { setChoreTarget(chore); setDifficulty(chore.difficulty); setChoresFormError(""); setChoreMenu(null); setModal("chore-edit"); }}>Редагувати</button>
                      <button className="ghost-button" type="button" disabled={chore.status === "done"}
                        onClick={() => { setChoreTarget(chore); setChoresFormError(""); setChoreMenu(null); setModal("chore-delete"); }}>Видалити</button>
                    </div>}
                  </div>
                  </div>
                </article>
              ))}
            </section>
          </div>
        )}

        {page === "shopping" && (
          <div className="page narrow">
            <div className="page-actions">
              <div>
                <span className="overline">СПІЛЬНИЙ СПИСОК</span>
                <h2 className="inline-title">Потрібно купити:</h2>
              </div>
              <button className="primary-button" disabled={shoppingLoading || shoppingRoomId !== roomId || shoppingSaving || !!shoppingError} onClick={() => { setShoppingFormError(""); setModal("shopping"); }}>
                <Icon name="plus" size={18} />
                Додати
              </button>
            </div>
            <section className="surface shopping-board" aria-busy={shoppingLoading || shoppingSaving}>
              {(shoppingLoading || shoppingRoomId !== roomId) && <p role="status">Завантаження покупок…</p>}
              {shoppingRoomId === roomId && shoppingError && <div role="alert"><p>{shoppingError}</p><button className="outline-button" disabled={shoppingSaving} onClick={() => setShoppingReload((value) => value + 1)}>Спробувати ще раз</button></div>}
              {shoppingRoomId === roomId && !shoppingLoading && !shoppingError && !roomShopping.length && <p>Список покупок порожній.</p>}
              {shoppingSaving && <p role="status">Збереження…</p>}
              {shoppingRoomId === roomId && !shoppingLoading && roomShopping.map((item) => (
                <div className={`shopping-item ${item.done ? "bought" : ""}`} key={item.id}>
                  <label className="shopping-item-toggle">
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={shoppingSaving}
                      onChange={() => toggleShopping(item)}
                    />
                    <span className="shopping-check">
                      <Icon name="check" size={15} />
                    </span>
                    <strong>{item.title}</strong>
                  </label>
                  {item.buyerId ? (
                    <span className="buyer">
                      <Avatar member={members.find((person) => person.id === item.buyerId) || { id: item.buyerId, name: "Мешканець", initials: "", color: "#7063df", email: "" }} size="xs" />
                      Купила {members.find((person) => person.id === item.buyerId)?.name.split(" ")[0] || "Мешканець"}
                    </span>
                  ) : (
                    <span className="need">Потрібно купити</span>
                  )}
                  <button
                    type="button"
                    className="shopping-remove"
                    aria-label={`Видалити покупку «${item.title}»`}
                    title="Видалити покупку"
                    disabled={shoppingSaving}
                    onClick={() => { setShoppingDeleteTarget(item); setShoppingDeleteError(""); setModal("shopping-delete"); }}
                  >
                    <Icon name="close" size={17} />
                  </button>
                </div>
              ))}
            </section>
          </div>
        )}

        {page === "money" && (
          <div className="page" aria-busy={moneyLoading || moneySaving}>
            {(moneyLoading || moneyRoomId !== roomId) && <p role="status">Завантаження витрат і балансу…</p>}
            {moneyRoomId === roomId && moneyError && <div role="alert"><p>{moneyError}</p><button className="outline-button" disabled={moneySaving} onClick={() => setMoneyReload((value) => value + 1)}>Спробувати ще раз</button></div>}
            {moneySaving && <p role="status">Збереження…</p>}
            <div className="money-hero">
              <div>
                <span>ВАШ ОСОБИСТИЙ БАЛАНС</span>
                <strong>{summary ? `${summary.my_balance_minor > 0 ? "+" : ""}${money(summary.my_balance_minor)} ₴` : "—"}</strong>
                <p>Ви винні {summary ? totalIOwe : "—"} ₴ у цій кімнаті</p>
              </div>
              <div className="money-hero-side">
                <small>Водночас вам мають повернути</small>
                <b>{summary ? `+${totalOwedToMe} ₴` : "—"}</b>
                <button disabled={moneyLoading || moneySaving || !summary || roomLoading || !!roomError} onClick={() => { setExpenseFormError(""); setModal("expense"); }}>
                  <Icon name="plus" size={17} />
                  Додати витрату
                </button>
              </div>
            </div>
            <div className="money-grid">
              <section className="surface debt-surface">
                <div className="section-head">
                  <div>
                    <span className="overline">ВАШІ БОРГИ</span>
                    <h3>Кому ви винні</h3>
                  </div>
                </div>
                {owedByMe.map((debt) => (
                  <article className="debt-row" key={debt.id}>
                    <Avatar member={member(debt.creditorId)} size="md" />
                    <div>
                      <strong>{member(debt.creditorId).name}</strong>
                      <span>За спільні покупки</span>
                    </div>
                    <b>−{debt.amount} ₴</b>
                    {debt.status === "requested" && <span className="request-status">Запит надіслано: {money(debt.requestedMinor)} ₴</span>}
                    {debt.availableMinor > 0 && <button disabled={moneySaving || moneyLoading} onClick={() => repay(debt)}>
                      Я вже віддав(-ла){debt.status === "requested" ? `: ${money(debt.availableMinor)} ₴` : ""}
                    </button>}
                  </article>
                ))}
                {summary && !owedByMe.length && <p>Немає непогашених боргів.</p>}
                {confirmedPayments.filter((item) => item.debtor_id === currentUserId).map((item) => <article className="debt-row" key={`paid-${item.id}`}>
                  <Avatar member={member(item.creditor_id)} size="md" />
                  <div><strong>{member(item.creditor_id).name}</strong><span>Повернення підтверджено</span></div>
                  <b>−{money(item.amount_minor)} ₴</b><span className="request-status neutral">Підтверджено</span>
                </article>)}
              </section>
              <section className="surface debt-surface">
                <div className="section-head">
                  <div>
                    <span className="overline">ВАМ ВИННІ</span>
                    <h3>Очікуєте повернення</h3>
                  </div>
                </div>
                {owedToMe.map((debt) => (
                  <article className="debt-row" key={debt.id}>
                    <Avatar member={member(debt.debtorId)} size="md" />
                    <div>
                      <strong>{member(debt.debtorId).name}</strong>
                      <span>
                        {debt.status === "requested"
                          ? "Каже, що вже віддав(-ла)"
                          : "Ще не віддав(-ла)"}
                      </span>
                    </div>
                    <b className="positive">+{debt.amount} ₴</b>
                    {debt.status === "requested" ? debt.pending.map((payment) => (
                      <button key={payment.id} className="confirm" disabled={moneySaving || moneyLoading} onClick={() => repay(debt, payment.id)}>
                        <Icon name="check" size={15} />
                        Підтвердити {money(payment.amount_minor)} ₴
                      </button>
                    )) : (
                      <span className="request-status neutral">Очікується</span>
                    )}
                  </article>
                ))}
                {summary && !owedToMe.length && <p>Немає непогашених боргів.</p>}
                {confirmedPayments.filter((item) => item.creditor_id === currentUserId).map((item) => <article className="debt-row" key={`paid-${item.id}`}>
                  <Avatar member={member(item.debtor_id)} size="md" />
                  <div><strong>{member(item.debtor_id).name}</strong><span>Повернення підтверджено</span></div>
                  <b className="positive">+{money(item.amount_minor)} ₴</b><span className="request-status neutral">Підтверджено</span>
                </article>)}
              </section>
            </div>
            <section className="surface history">
              <div className="section-head">
                <div>
                  <span className="overline">ІСТОРІЯ</span>
                  <h3>Спільні витрати</h3>
                </div>
              </div>
              {roomExpenses.map((expense) => (
                <button
                  className="expense-line"
                  onClick={() => openExpense(expense)}
                  key={expense.id}
                >
                  <span className="receipt-icon">
                    <Icon name="receipt" />
                  </span>
                  <span className="expense-title">
                    <strong>{expense.title}</strong>
                    <small>
                      {expense.date} · оплатив(-ла) {member(expense.payerId).name}
                    </small>
                  </span>
                  <span className="avatar-stack">
                    {expense.participantIds.slice(0, 4).map((id) => (
                      <Avatar member={member(id)} size="xs" key={id} />
                    ))}
                  </span>
                  <b>{expense.amount} ₴</b>
                  <Icon name="chevron" size={17} />
                </button>
              ))}
              {summary && !roomExpenses.length && <p>Спільних витрат ще немає.</p>}
            </section>
          </div>
        )}

        {page === "room" && (
          <div className="page">
            <section className="room-cover">
              <div className="room-cover-main">
                <span>ВАША СПІЛЬНА КІМНАТА</span>
                <h2>Кімната {room.number}</h2>
                <p>{roomMembers.length} мешканці</p>
              </div>
              <div className="room-cover-actions">
                <button onClick={() => setModal("invite")}>
                  <Icon name="link" size={18} />
                  Запросити за посиланням
                </button>
              </div>
            </section>
            <div className="room-layout">
              <section className="surface member-board">
                <div className="section-head">
                  <div>
                    <span className="overline">МЕШКАНЦІ</span>
                    <h3>Хто живе разом</h3>
                  </div>
                  <span className="count-badge">{roomMembers.length}</span>
                </div>
                {roomMembers.map((item) => (
                  <article key={item.id}>
                    <Avatar member={item} size="md" />
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.email}</span>
                    </div>
                    <div className="member-load">
                      <span>
                        {workloads?.find((entry) => entry.user_id === item.id)?.unfinished_chores ?? "—"}{" "}
                        справи
                      </span>
                      <i
                        style={{
                          width: `${workloads?.find((entry) => entry.user_id === item.id)?.workload_percent ?? 0}%`,
                        }}
                      />
                    </div>
                    {item.id === currentUserId && <small className="you-badge">ЦЕ ВИ</small>}
                  </article>
                ))}
              </section>
              <aside className="surface invite-panel">
                <span className="big-link-icon">
                  <Icon name="link" size={26} />
                </span>
                <h3>Запросіть за посиланням</h3>
                <p>Roomie відкриє посилання та одразу зможе приєднатися.</p>
                <div className="copy-box">
                  <button className="invite-url" onClick={openJoin}>
                    {inviteUrl ? inviteUrl.replace(/^https?:\/\//, "") : "Завантаження посилання…"}
                  </button>
                  <button onClick={copyInvite} disabled={!inviteUrl}>Скопіювати посилання</button>
                </div>
              </aside>
            </div>
          </div>
        )}

        {page === "profile" && (
          <div className="page profile-layout">
            <section className="surface profile-main">
              <div className="profile-roomie-card">
                <Avatar member={{ ...currentUser, ...profileAvatar, name: profileName || currentUser.name }} variant="profile" />
              </div>
              <form className="profile-form" onSubmit={saveProfile} aria-busy={profileSaving}>
                <label>
                  Ім’я в профілі
                  <input
                    value={profileName}
                    required maxLength={100} disabled={profileSaving}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder="Введіть ім’я"
                  />
                </label>
                <AvatarPicker value={profileAvatar} onChange={setProfileAvatar} disabled={profileSaving} />
                <div className="profile-actions">
                  <button
                    type="button"
                    className="outline-button"
                    disabled={profileSaving}
                    onClick={() => { setProfileName(currentUser.name); setProfileAvatar(avatarOptions(currentUser)); setProfileError(""); }}
                  >
                    Скасувати
                  </button>
                  <button className="primary-button" disabled={profileSaving}>{profileSaving ? "Збереження…" : "Зберегти зміни"}</button>
                </div>
                {profileError && <p role="alert">{profileError}</p>}
                {import.meta.env.VITE_GOOGLE_CLIENT_ID && <section className="google-link-section">
                  {googleLinked === true ? <p>Google-акаунт уже прив’язано.</p>
                    : googleStatusError ? <p role="alert">Не вдалося перевірити прив’язування: {googleStatusError}</p>
                    : googleLinked === null ? <p role="status">Перевірка прив’язування Google…</p>
                    : <>
                      <p>Прив’язати Google-акаунт для входу без пароля:</p>
                      <GoogleSignIn onCredential={async (credential) => {
                        try {
                          await api.linkGoogle(credential);
                          setGoogleLinked(true);
                          notify("Google-акаунт прив’язано");
                        } catch (error) {
                          setProfileError(error instanceof Error ? error.message : "Не вдалося прив’язати Google.");
                        }
                      }} />
                    </>}
                </section>}
              </form>
              <div className="profile-metrics">
                <div>
                  <strong>{stats?.room_count ?? "—"}</strong>
                  <span>кімнати</span>
                </div>
                <div>
                  <strong>
                    {stats?.completed_chores ?? "—"}
                  </strong>
                  <span>справ виконано</span>
                </div>
              </div>
            </section>
            <section className="surface my-rooms">
              <div className="section-head">
                <div>
                  <span className="overline">МОЇ ПРОСТОРИ</span>
                  <h3>Ваші кімнати</h3>
                </div>
                <button className="ghost-button" onClick={() => setModal("room")}>
                  <Icon name="plus" size={17} />
                  Створити
                </button>
              </div>
              {rooms.map((item) => (
                <button
                  className={item.id === roomId ? "active" : ""}
                  onClick={() => {
                    setRoomId(item.id);
                    setPage("today");
                  }}
                  key={item.id}
                >
                  <span>
                    <strong>Кімната {item.number}</strong>
                    <small>{item.memberIds.length} мешканці</small>
                  </span>
                  {item.id === roomId && <i>АКТИВНА</i>}
                  <Icon name="chevron" size={17} />
                </button>
              ))}
            </section>
            <section className="profile-donation" aria-labelledby="profile-donation-title">
              <div className="profile-donation-copy">
                <span className="profile-donation-label">ДОБРА СПРАВА РАЗОМ</span>
                <h3 id="profile-donation-title">Подобається Roomie? Підтримайте добру справу</h3>
                <p>
                  Якщо вам подобається наш застосунок, підтримайте нашу команду донатом.
                  Усі зібрані кошти буде спрямовано на збір УКУ «Під одним крилом».
                </p>
              </div>
              <a
                className="profile-donation-link"
                href="https://send.monobank.ua/jar/e4aq8ngAd"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Підтримати збір УКУ «Під одним крилом» на monobank (відкриється в новій вкладці)"
              >
                Підтримати збір
                <Icon name="arrow" size={18} />
              </a>
            </section>
          </div>
        )}
      </main>

      <nav className="mobile-nav">
        {nav.slice(0, 4).map((item) => (
          <button
            key={item.id}
            className={page === item.id ? "active" : ""}
            onClick={() => setPage(item.id)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
        <button className={page === "profile" ? "active" : ""} onClick={() => setPage("profile")}>
          <Avatar member={currentUser} size="xs" />
          <span>Профіль</span>
        </button>
      </nav>
      {toast && (
        <div className="toast">
          <span>
            <Icon name="check" size={15} />
          </span>
          {toast}
        </div>
      )}

      {roomDialogs}

      {choreTarget && (modal === "chore-edit" || modal === "chore-delete") && <Modal
        title={modal === "chore-edit" ? "Редагувати обов’язок" : "Видалити обов’язок?"}
        onClose={() => { if (!choresSaving) setModal(null); }}>
        {modal === "chore-edit" ? <form className="form" onSubmit={manageChore} aria-busy={choresSaving} key={choreTarget.id}>
          <label>Що потрібно зробити?<input name="title" required maxLength={200} defaultValue={choreTarget.title} disabled={choresSaving} /></label>
          <div className="form-grid">
            <label>Хто виконує<select name="owner" defaultValue={choreTarget.ownerId} disabled={choresSaving}>
              {roomMembers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select></label>
            <label>Коли виконати (час пристрою)<input name="due" type="datetime-local" step="1" required defaultValue={localDateTime(choreTarget.dueAt)} disabled={choresSaving} /></label>
          </div>
          <fieldset disabled={choresSaving}><legend>Складність</legend><Stars value={difficulty} onChange={setDifficulty} /></fieldset>
          {choreTarget.repeat === "Щотижня" && <p>Зміни цієї справи перейдуть у наступну після її виконання. Завершені справи не змінюються.</p>}
          {choresFormError && <p role="alert">{choresFormError}</p>}
          <div className="modal-actions"><button className="outline-button" type="button" disabled={choresSaving} onClick={() => setModal(null)}>Скасувати</button>
            <button className="primary-button" disabled={choresSaving}>{choresSaving ? "Збереження…" : "Зберегти зміни"}</button></div>
        </form> : <div className="form" aria-busy={choresSaving}>
          <p>Видалити «{choreTarget.title}»? Цю дію не можна скасувати.</p>
          {choreTarget.repeat === "Щотижня" && <p>Наступна справа з цієї не з’явиться. Попередні завершені справи залишаться в історії.</p>}
          {choresFormError && <p role="alert">{choresFormError}</p>}
          <div className="modal-actions"><button className="outline-button" disabled={choresSaving} onClick={() => setModal(null)}>Скасувати</button>
            <button className="primary-button" disabled={choresSaving} onClick={() => manageChore()}>{choresSaving ? "Видалення…" : "Видалити"}</button></div>
        </div>}
      </Modal>}

      {modal === "chore" && (
        <Modal
          title="Новий обов’язок"
          note="Призначена людина має його погодити."
          onClose={() => { if (!choresSaving) setModal(null); }}
          wide
        >
          <form className="form" onSubmit={addChore} aria-busy={choresSaving}>
            <label>
              Що потрібно зробити?
              <input name="title" required maxLength={200} disabled={choresSaving} placeholder="Наприклад, помити холодильник" />
            </label>
            <div className="form-grid">
              <label>
                Хто виконує
                <select name="owner" defaultValue={currentUserId} disabled={choresSaving}>
                  {roomMembers.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Коли виконати (час пристрою)
                <input name="due" type="datetime-local" required disabled={choresSaving} />
              </label>
            </div>
            <fieldset disabled={choresSaving}>
              <legend>Складність</legend>
              <Stars value={difficulty} onChange={setDifficulty} />
            </fieldset>
            <fieldset disabled={choresSaving}>
              <legend>Повторення</legend>
              <div className="choice-row">
                <label className={repeat === "Один раз" ? "selected" : ""}>
                  <input
                    type="radio"
                    checked={repeat === "Один раз"}
                    onChange={() => setRepeat("Один раз")}
                  />
                  Один раз
                </label>
                <label className={repeat === "Щотижня" ? "selected" : ""}>
                  <input
                    type="radio"
                    checked={repeat === "Щотижня"}
                    onChange={() => setRepeat("Щотижня")}
                  />
                  Щотижня
                </label>
              </div>
            </fieldset>
            {repeat === "Щотижня" && (
              <fieldset className="rotation-field" disabled={choresSaving}>
                <legend>Хто виконує наступного тижня?</legend>
                <div className="choice-row">
                  <label className={rotation === "same" ? "selected" : ""}>
                    <input
                      type="radio"
                      checked={rotation === "same"}
                      onChange={() => setRotation("same")}
                    />
                    <span>
                      <b>Та сама людина</b>
                      <small>Обов’язок не переходить</small>
                    </span>
                  </label>
                  <label className={rotation === "rotate" ? "selected" : ""}>
                    <input
                      type="radio"
                      checked={rotation === "rotate"}
                      onChange={() => setRotation("rotate")}
                    />
                    <span>
                      <b>По черзі</b>
                      <small>Roomies змінюються щотижня</small>
                    </span>
                  </label>
                </div>
                {rotation === "rotate" && (
                  <div className="people-selector rotation-people">
                    {roomMembers.map((item) => (
                      <label key={item.id}>
                        <input type="checkbox" name="rotationIds" value={item.id} defaultChecked />
                        <span>
                          <b className="participant-name">
                            {item.id === currentUserId ? "Я" : item.name.split(" ")[0]}
                          </b>
                          <i>
                            <Icon name="check" size={12} />
                          </i>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}
            {choresFormError && <p role="alert">{choresFormError}</p>}
            <div className="modal-actions">
              <button type="button" className="outline-button" disabled={choresSaving} onClick={() => setModal(null)}>
                Скасувати
              </button>
              <button className="primary-button" disabled={choresSaving}>{choresSaving ? "Створення…" : "Створити обов’язок"}</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "expense" && (
        <Modal
          title="Додати спільну витрату"
          note="Оберіть конкретних людей — Roomie сам порахує частку кожного."
          onClose={() => { if (!moneySaving) setModal(null); }}
          wide
        >
          <form className="form" onSubmit={addExpense} aria-busy={moneySaving}>
            <div className="form-grid">
              <label>
                Що купили?
                <input name="title" maxLength={200} disabled={moneySaving} required placeholder="Побутова хімія" />
              </label>
              <label>
                Сума, ₴<input name="amount" type="text" inputMode="decimal" disabled={moneySaving} required placeholder="0" />
              </label>
            </div>
            <fieldset disabled={moneySaving}>
              <legend>Між ким розділити?</legend>
              <div className="people-selector expense-people">
                {roomMembers.map((item) => (
                  <label key={item.id}>
                    <input type="checkbox" name="people" value={item.id} defaultChecked />
                    <span>
                      <b className="participant-name">
                        {item.id === currentUserId ? "Я" : item.name}
                      </b>
                      <i>
                        <Icon name="check" size={12} />
                      </i>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              Коментар або картка
              <textarea name="note" rows={3} maxLength={5000} disabled={moneySaving} placeholder="Додайте номер картки чи пояснення" />
            </label>
            {expenseFormError && <p role="alert">{expenseFormError}</p>}
            <div className="modal-actions">
              <button type="button" className="outline-button" disabled={moneySaving} onClick={() => setModal(null)}>
                Скасувати
              </button>
              <button className="primary-button" disabled={moneySaving}>{moneySaving ? "Додавання…" : "Додати й розділити"}</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "shopping" && (
        <Modal title="Додати покупку" onClose={() => { if (!shoppingSaving) setModal(null); }}>
          <form className="form" onSubmit={addShopping} aria-busy={shoppingSaving}>
            <label>
              Що потрібно купити?
              <input name="title" required maxLength={200} disabled={shoppingSaving} autoFocus placeholder="Наприклад, паперові рушники" />
            </label>
            {shoppingFormError && <p role="alert">{shoppingFormError}</p>}
            <div className="modal-actions">
              <button type="button" className="outline-button" disabled={shoppingSaving} onClick={() => setModal(null)}>
                Скасувати
              </button>
              <button className="primary-button" disabled={shoppingSaving}>{shoppingSaving ? "Додавання…" : "Додати до списку"}</button>
            </div>
          </form>
        </Modal>
      )}

      {page === "shopping" && modal === "shopping-delete" && shoppingDeleteTarget && (
        <Modal
          title="Видалити покупку?"
          note={`«${shoppingDeleteTarget.title}» буде остаточно видалено зі спільного списку.`}
          onClose={() => { if (!shoppingSaving) { setModal(null); setShoppingDeleteTarget(null); } }}
        >
          <div className="form">
            <p>Після видалення відновити покупку не вдасться.</p>
            {shoppingDeleteError && <p role="alert">{shoppingDeleteError}</p>}
            <div className="modal-actions">
              <button type="button" className="outline-button" disabled={shoppingSaving} onClick={() => { setModal(null); setShoppingDeleteTarget(null); }}>Скасувати</button>
              <button type="button" className="primary-button" disabled={shoppingSaving} onClick={deleteShopping}>
                {shoppingSaving ? "Видалення…" : "Так, видалити"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {page === "money" && detailExpense && (
        <Modal
          title={detailExpense.title}
          note={`${detailExpense.date} · оплатив(-ла) ${member(detailExpense.payerId).name}`}
          onClose={() => { detailRequest.current?.abort(); setDetailExpense(null); }}
        >
          {detailLoading && <p role="status">Завантаження витрати…</p>}
          {detailError && <div role="alert"><p>{detailError}</p><button className="outline-button" onClick={() => openExpense(detailExpense)}>Спробувати ще раз</button></div>}
          {!detailLoading && !detailError && <div className="expense-detail">
            <div className="expense-total">
              <span>ЗАГАЛЬНА СУМА</span>
              <strong>{detailExpense.amount} ₴</strong>
            </div>
            <h4>Хто бере участь</h4>
            {detailExpense.participantIds.map((id) => (
              <div className="detail-person" key={id}>
                <Avatar member={member(id)} size="sm" />
                <span>
                  <strong>{id === currentUserId ? "Ви" : member(id).name}</strong>
                  <small>
                    {id === detailExpense.payerId ? "Оплатив(-ла)" : "Частка у витраті"}
                  </small>
                </span>
                <b>{money(detailExpense.shares.find((share) => share.user_id === id)!.share_minor)} ₴</b>
              </div>
            ))}
            {detailExpense.note && (
              <div className="payment-note">
                <span>КОМЕНТАР / КАРТКА</span>
                <strong>{detailExpense.note}</strong>
                <button
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(detailExpense.note); notify("Скопійовано"); }
                    catch { setDetailError("Не вдалося скопіювати. Спробуйте ще раз."); }
                  }}
                >
                  <Icon name="copy" size={16} />
                </button>
              </div>
            )}
          </div>}
        </Modal>
      )}
    </div>
  );
}
