import { FormEvent, useEffect, useMemo, useState } from "react";

type Page = "today" | "chores" | "shopping" | "money" | "room" | "profile";
type ModalName = "invite" | "join" | "room" | "chore" | "expense" | "shopping" | null;
type Member = {
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
  status: "waiting" | "active" | "done";
  repeat: "Один раз" | "Щотижня";
  rotation: "same" | "rotate";
  rotationIds: number[];
};
type Expense = {
  id: number;
  roomId: number;
  title: string;
  amount: number;
  payerId: number;
  participantIds: number[];
  note: string;
  date: string;
};
type Settlement = {
  id: number;
  roomId: number;
  debtorId: number;
  creditorId: number;
  amount: number;
  status: "unpaid" | "requested" | "paid";
};
type ShoppingItem = { id: number; roomId: number; title: string; done: boolean; buyerId?: number };

const currentUserId = 1;

const seedMembers: Member[] = [
  { id: 1, name: "Софія Коваль", initials: "СК", color: "#7d6be8", email: "sofia@roomie.app" },
  { id: 2, name: "Марко Левченко", initials: "МЛ", color: "#e48670", email: "marko@roomie.app" },
  { id: 3, name: "Аня Бондар", initials: "АБ", color: "#48a78c", email: "anna@roomie.app" },
  { id: 4, name: "Тарас Мельник", initials: "ТМ", color: "#d79a3b", email: "taras@roomie.app" },
  { id: 5, name: "Олена Романюк", initials: "ОР", color: "#5795c9", email: "olena@roomie.app" },
];

const seedRooms: Room[] = [
  { id: 1, number: "214", memberIds: [1, 2, 3, 4], accent: "#7063df" },
  { id: 2, number: "38", memberIds: [1, 5], accent: "#2d9b7d" },
];

const seedChores: Chore[] = [
  {
    id: 1,
    roomId: 1,
    title: "Помити підлогу",
    ownerId: 1,
    difficulty: 3,
    due: "Сьогодні, 19:00",
    status: "active",
    repeat: "Щотижня",
    rotation: "rotate",
    rotationIds: [1, 2, 3, 4],
  },
  {
    id: 2,
    roomId: 1,
    title: "Винести сміття",
    ownerId: 2,
    difficulty: 1,
    due: "Сьогодні, 20:00",
    status: "waiting",
    repeat: "Щотижня",
    rotation: "same",
    rotationIds: [2],
  },
  {
    id: 3,
    roomId: 1,
    title: "Прибрати ванну",
    ownerId: 3,
    difficulty: 4,
    due: "Завтра, 18:00",
    status: "active",
    repeat: "Щотижня",
    rotation: "rotate",
    rotationIds: [1, 3],
  },
  {
    id: 4,
    roomId: 1,
    title: "Протерти пил",
    ownerId: 4,
    difficulty: 2,
    due: "П’ятниця",
    status: "done",
    repeat: "Один раз",
    rotation: "same",
    rotationIds: [4],
  },
  {
    id: 5,
    roomId: 2,
    title: "Полити рослини",
    ownerId: 1,
    difficulty: 1,
    due: "Субота",
    status: "active",
    repeat: "Щотижня",
    rotation: "rotate",
    rotationIds: [1, 5],
  },
];

const seedExpenses: Expense[] = [
  {
    id: 1,
    roomId: 1,
    title: "Побутова хімія",
    amount: 684,
    payerId: 1,
    participantIds: [1, 2, 3, 4],
    note: "Картка 4441 1144 8023 5571",
    date: "Сьогодні, 12:40",
  },
  {
    id: 2,
    roomId: 1,
    title: "Вода та серветки",
    amount: 258,
    payerId: 3,
    participantIds: [1, 2, 3],
    note: "",
    date: "Учора, 18:20",
  },
  {
    id: 3,
    roomId: 1,
    title: "Піца на всіх",
    amount: 432,
    payerId: 2,
    participantIds: [1, 2, 4],
    note: "monobank: 4441 2020 1188 0204",
    date: "12 травня",
  },
];

const seedSettlements: Settlement[] = [
  { id: 1, roomId: 1, debtorId: 1, creditorId: 3, amount: 86, status: "unpaid" },
  { id: 2, roomId: 1, debtorId: 1, creditorId: 2, amount: 144, status: "requested" },
  { id: 3, roomId: 1, debtorId: 2, creditorId: 1, amount: 171, status: "requested" },
  { id: 4, roomId: 1, debtorId: 4, creditorId: 1, amount: 171, status: "unpaid" },
];

const seedShopping: ShoppingItem[] = [
  { id: 1, roomId: 1, title: "Пакети для сміття", done: false },
  { id: 2, roomId: 1, title: "Засіб для посуду", done: false },
  { id: 3, roomId: 1, title: "Губки для кухні", done: true, buyerId: 3 },
  { id: 4, roomId: 2, title: "Фільтри для води", done: false },
];

const nav: { id: Page; label: string; icon: string }[] = [
  { id: "today", label: "Сьогодні", icon: "spark" },
  { id: "chores", label: "Обов’язки", icon: "tasks" },
  { id: "money", label: "Гроші", icon: "wallet" },
  { id: "shopping", label: "Покупки", icon: "bag" },
  { id: "room", label: "Мешканці", icon: "users" },
];

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

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

function Avatar({
  member,
  size = "md",
}: {
  member: Member;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}) {
  const avatarColors: Record<number, string> = {
    1: "#BF8790",
    2: "#C48F78",
    3: "#8D9C83",
    4: "#C5A078",
  };
  return (
    <span
      className={`avatar avatar-${size} face-avatar`}
      style={{ background: avatarColors[member.id] || "#A68D84" }}
    >
      <span className="roomie-eyes">
        <i />
        <i />
      </span>
    </span>
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

export default function App() {
  const [page, setPage] = useState<Page>("today");
  const [modal, setModal] = useState<ModalName>(null);
  const [rooms, setRooms] = useState(() => load("roomie-v2-rooms", seedRooms));
  const [roomId, setRoomId] = useState(1);
  const [members, setMembers] = useState(() => load("roomie-v2-members", seedMembers));
  const [profileName, setProfileName] = useState(
    () =>
      load<Member[]>("roomie-v2-members", seedMembers).find((item) => item.id === currentUserId)
        ?.name || "",
  );
  const [chores, setChores] = useState(() => load("roomie-v2-chores", seedChores));
  const [expenses, setExpenses] = useState(() => load("roomie-v2-expenses", seedExpenses));
  const [settlements, setSettlements] = useState(() =>
    load("roomie-v2-settlements", seedSettlements),
  );
  const [shopping, setShopping] = useState(() => load("roomie-v2-shopping", seedShopping));
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [toast, setToast] = useState("");
  const [difficulty, setDifficulty] = useState(3);
  const [repeat, setRepeat] = useState<"Один раз" | "Щотижня">("Один раз");
  const [rotation, setRotation] = useState<"same" | "rotate">("same");
  const [choreFilter, setChoreFilter] = useState<"all" | "mine" | "waiting" | "done">("all");

  useEffect(() => localStorage.setItem("roomie-v2-rooms", JSON.stringify(rooms)), [rooms]);
  useEffect(() => localStorage.setItem("roomie-v2-members", JSON.stringify(members)), [members]);
  useEffect(() => localStorage.setItem("roomie-v2-chores", JSON.stringify(chores)), [chores]);
  useEffect(() => localStorage.setItem("roomie-v2-expenses", JSON.stringify(expenses)), [expenses]);
  useEffect(
    () => localStorage.setItem("roomie-v2-settlements", JSON.stringify(settlements)),
    [settlements],
  );
  useEffect(() => localStorage.setItem("roomie-v2-shopping", JSON.stringify(shopping)), [shopping]);

  const room = rooms.find((item) => item.id === roomId) || rooms[0];
  const roomMembers = members.filter((member) => room.memberIds.includes(member.id));
  const roomChores = chores.filter((chore) => chore.roomId === roomId);
  const roomExpenses = expenses.filter((expense) => expense.roomId === roomId);
  const roomShopping = shopping.filter((item) => item.roomId === roomId);
  const currentUser = members.find((member) => member.id === currentUserId)!;
  const inviteUrl = `https://roomie.app/invite/${room.id}-${room.number}`;
  const member = (id: number) => members.find((item) => item.id === id) || currentUser;
  const owedByMe = settlements.filter(
    (item) => item.roomId === roomId && item.debtorId === currentUserId && item.status !== "paid",
  );
  const owedToMe = settlements.filter(
    (item) => item.roomId === roomId && item.creditorId === currentUserId && item.status !== "paid",
  );
  const totalIOwe = owedByMe.reduce((sum, item) => sum + item.amount, 0);
  const totalOwedToMe = owedToMe.reduce((sum, item) => sum + item.amount, 0);
  const donePercent = Math.round(
    (roomChores.filter((item) => item.status === "done").length / Math.max(roomChores.length, 1)) *
      100,
  );
  const filteredChores = roomChores.filter((chore) => {
    if (choreFilter === "mine") return chore.ownerId === currentUserId;
    if (choreFilter === "waiting")
      return chore.status === "waiting" && chore.ownerId === currentUserId;
    if (choreFilter === "done") return chore.status === "done";
    return true;
  });

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const updateSettlement = (id: number, status: Settlement["status"]) => {
    setSettlements(settlements.map((item) => (item.id === id ? { ...item, status } : item)));
    notify(status === "requested" ? "Запит про оплату надіслано" : "Оплату підтверджено");
  };

  const copyInvite = () => {
    navigator.clipboard?.writeText(inviteUrl);
    notify("Посилання скопійовано");
  };

  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = profileName.trim();
    if (!name) {
      notify("Введіть ім’я");
      return;
    }
    setMembers(
      members.map((item) =>
        item.id === currentUserId
          ? {
              ...item,
              name,
              initials: name
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase(),
            }
          : item,
      ),
    );
    notify("Ім’я оновлено");
  };

  const createRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const number = String(data.get("number"));
    const newRoom: Room = {
      id: Date.now(),
      number,
      memberIds: [currentUserId],
      accent: "#7063df",
    };
    setRooms([...rooms, newRoom]);
    setRoomId(newRoom.id);
    setModal(null);
    notify(`Кімнату ${number} створено`);
  };

  const joinRoom = () => {
    setModal(null);
    notify(`Ви приєдналися до кімнати ${room.number}`);
  };

  const addChore = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const ownerId = Number(data.get("owner"));
    const rotationIds = rotation === "rotate" ? data.getAll("rotationIds").map(Number) : [ownerId];
    setChores([
      ...chores,
      {
        id: Date.now(),
        roomId,
        title: String(data.get("title")),
        ownerId,
        difficulty,
        due: String(data.get("due")),
        status: ownerId === currentUserId ? "active" : "waiting",
        repeat,
        rotation,
        rotationIds: rotationIds.length ? rotationIds : room.memberIds,
      },
    ]);
    setModal(null);
    notify("Обов’язок створено");
  };

  const addExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const participantIds = data.getAll("people").map(Number);
    const amount = Number(data.get("amount"));
    const expense: Expense = {
      id: Date.now(),
      roomId,
      title: String(data.get("title")),
      amount,
      payerId: currentUserId,
      participantIds: participantIds.length ? participantIds : [currentUserId],
      note: String(data.get("note")),
      date: "Щойно",
    };
    const share = Math.round(amount / expense.participantIds.length);
    const newSettlements = expense.participantIds
      .filter((id) => id !== currentUserId)
      .map((id, index) => ({
        id: Date.now() + index,
        roomId,
        debtorId: id,
        creditorId: currentUserId,
        amount: share,
        status: "unpaid" as const,
      }));
    setExpenses([expense, ...expenses]);
    setSettlements([...settlements, ...newSettlements]);
    setModal(null);
    notify(`Розділено по ${share} ₴`);
  };

  const addShopping = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get("title"));
    setShopping([...shopping, { id: Date.now(), roomId, title, done: false }]);
    setModal(null);
    notify("Додано до списку");
  };

  const titles: Record<Page, { title: string; subtitle: string }> = {
    today: { title: "ROOMIE", subtitle: "" },
    chores: { title: "Обов’язки", subtitle: "" },
    shopping: { title: "Список покупок", subtitle: "" },
    money: { title: "Спільні гроші", subtitle: "" },
    room: { title: `Кімната ${room.number}`, subtitle: "Мешканці, запрошення та налаштування" },
    profile: { title: "Мій профіль", subtitle: "Керуйте своїми даними в Roomie" },
  };

  return (
    <div className="shell">
      <aside className="side">
        <button className="logo" onClick={() => setPage("today")}>
          <span>r</span>roomie
        </button>
        <div className="room-picker">
          <label>Поточна кімната</label>
          <div className="select-wrap">
            <span className="room-number">{room.number}</span>
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
          <button onClick={copyInvite}>Скопіювати посилання</button>
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
            <h1>{titles[page].title}</h1>
            {titles[page].subtitle && <p>{titles[page].subtitle}</p>}
          </div>
          <div className="top-actions">
            <button className="circle-button notification">
              <Icon name="bell" />
            </button>
            <button className="top-avatar" onClick={() => setPage("profile")}>
              <Avatar member={currentUser} size="md" />
            </button>
          </div>
        </header>

        {page === "today" && (
          <div className="page today-page">
            <div className="today-title">
              <h2>Сьогодні</h2>
              <p>Кімната {room.number}</p>
            </div>
            <div className="today-grid">
              <section className="surface today-tasks">
                <div className="today-tasks-head">
                  <h3>Найближчі справи</h3>
                  <div>
                    <span>ПРОГРЕС ТИЖНЯ</span>
                    <strong>
                      {roomChores.filter((item) => item.status === "done").length} із{" "}
                      {roomChores.length}
                    </strong>
                    <i>
                      <b style={{ width: `${donePercent}%` }} />
                    </i>
                  </div>
                </div>
                <div className="today-task-list">
                  {roomChores
                    .filter((item) => item.status !== "done")
                    .slice(0, 3)
                    .map((chore) => (
                      <article key={chore.id}>
                        <button
                          className="round-check"
                          onClick={() =>
                            setChores(
                              chores.map((item) =>
                                item.id === chore.id ? { ...item, status: "done" } : item,
                              ),
                            )
                          }
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
                  <div className="roomie-peek">
                    <span className="peek-eye">
                      <i />
                    </span>
                    <span className="peek-eye">
                      <i />
                    </span>
                  </div>
                </section>
                <button className="today-summary money-summary" onClick={() => setPage("money")}>
                  <h3>Гроші між вами</h3>
                  <Icon name="arrow" />
                  <div>
                    <span>
                      Ви винні <strong className="red">−{totalIOwe} ₴</strong>
                    </span>
                    <span>
                      Вам винні <strong className="green">+{totalOwedToMe} ₴</strong>
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
                      {roomShopping.filter((item) => !item.done).length} позиції ще потрібно
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
              <button className="primary-button" onClick={() => setModal("chore")}>
                <Icon name="plus" size={18} />
                Новий обов’язок
              </button>
            </div>
            <section className="week-row">
              {["Пн|13", "Вт|14", "Ср|15", "Чт|16", "Пт|17", "Сб|18", "Нд|19"].map((day, index) => (
                <div className={index === 1 ? "current" : ""} key={day}>
                  <span>{day.split("|")[0]}</span>
                  <strong>{day.split("|")[1]}</strong>
                  {index === 1 && <i />}
                </div>
              ))}
            </section>
            <section className="surface task-board">
              {filteredChores.map((chore) => (
                <article className={`full-task ${chore.status}`} key={chore.id}>
                  <button
                    className="large-check"
                    onClick={() =>
                      setChores(
                        chores.map((item) =>
                          item.id === chore.id
                            ? { ...item, status: item.status === "done" ? "active" : "done" }
                            : item,
                        ),
                      )
                    }
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
                  {chore.status === "waiting" && chore.ownerId === currentUserId ? (
                    <button
                      className="approve-button"
                      onClick={() => {
                        setChores(
                          chores.map((item) =>
                            item.id === chore.id ? { ...item, status: "active" } : item,
                          ),
                        );
                        notify("Обов’язок погоджено");
                      }}
                    >
                      Погодити
                    </button>
                  ) : chore.status === "waiting" ? (
                    <span className="awaiting-approval">Очікує відповіді</span>
                  ) : (
                    <button className="dots-button">
                      <Icon name="dots" />
                    </button>
                  )}
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
              <button className="primary-button" onClick={() => setModal("shopping")}>
                <Icon name="plus" size={18} />
                Додати
              </button>
            </div>
            <section className="surface shopping-board">
              {roomShopping.map((item) => (
                <label className={item.done ? "bought" : ""} key={item.id}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() =>
                      setShopping(
                        shopping.map((row) =>
                          row.id === item.id
                            ? {
                                ...row,
                                done: !row.done,
                                buyerId: !row.done ? currentUserId : undefined,
                              }
                            : row,
                        ),
                      )
                    }
                  />
                  <span className="shopping-check">
                    <Icon name="check" size={15} />
                  </span>
                  <strong>{item.title}</strong>
                  {item.buyerId ? (
                    <span className="buyer">
                      <Avatar member={member(item.buyerId)} size="xs" />
                      Купила {member(item.buyerId).name.split(" ")[0]}
                    </span>
                  ) : (
                    <span className="need">Потрібно купити</span>
                  )}
                </label>
              ))}
            </section>
          </div>
        )}

        {page === "money" && (
          <div className="page">
            <div className="money-hero">
              <div>
                <span>ВАШ ОСОБИСТИЙ БАЛАНС</span>
                <strong>−{totalIOwe} ₴</strong>
                <p>Ви винні двом людям у цій кімнаті</p>
              </div>
              <div className="money-hero-side">
                <small>Водночас вам мають повернути</small>
                <b>+{totalOwedToMe} ₴</b>
                <button onClick={() => setModal("expense")}>
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
                    {debt.status === "requested" ? (
                      <span className="request-status">Запит надіслано</span>
                    ) : (
                      <button onClick={() => updateSettlement(debt.id, "requested")}>
                        Я вже віддав(-ла)
                      </button>
                    )}
                  </article>
                ))}
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
                    {debt.status === "requested" ? (
                      <button className="confirm" onClick={() => updateSettlement(debt.id, "paid")}>
                        <Icon name="check" size={15} />
                        Підтвердити
                      </button>
                    ) : (
                      <span className="request-status neutral">Очікується</span>
                    )}
                  </article>
                ))}
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
                  onClick={() => setDetailExpense(expense)}
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
                        {
                          roomChores.filter(
                            (chore) => chore.ownerId === item.id && chore.status !== "done",
                          ).length
                        }{" "}
                        справи
                      </span>
                      <i
                        style={{
                          width: `${25 + roomChores.filter((chore) => chore.ownerId === item.id).length * 18}%`,
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
                  <button className="invite-url" onClick={() => setModal("join")}>
                    {inviteUrl.replace("https://", "")}
                  </button>
                  <button onClick={copyInvite}>Скопіювати посилання</button>
                </div>
              </aside>
            </div>
          </div>
        )}

        {page === "profile" && (
          <div className="page profile-layout">
            <section className="surface profile-main">
              <div className="profile-roomie-card">
                <div className="profile-roomie-head">
                  <span className="peek-eye">
                    <i />
                  </span>
                  <span className="peek-eye">
                    <i />
                  </span>
                </div>
              </div>
              <form className="profile-form" onSubmit={saveProfile}>
                <label>
                  Ім’я в профілі
                  <input
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder="Введіть ім’я"
                  />
                </label>
                <div>
                  <button
                    type="button"
                    className="outline-button"
                    onClick={() => setProfileName(currentUser.name)}
                  >
                    Скасувати
                  </button>
                  <button className="primary-button">Зберегти зміни</button>
                </div>
              </form>
              <div className="profile-metrics">
                <div>
                  <strong>{rooms.length}</strong>
                  <span>кімнати</span>
                </div>
                <div>
                  <strong>
                    {
                      chores.filter(
                        (item) => item.ownerId === currentUserId && item.status === "done",
                      ).length
                    }
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
                  <span className="large-room-number">{item.number}</span>
                  <span>
                    <strong>Кімната {item.number}</strong>
                    <small>{item.memberIds.length} мешканці</small>
                  </span>
                  {item.id === roomId && <i>АКТИВНА</i>}
                  <Icon name="chevron" size={17} />
                </button>
              ))}
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

      {modal === "invite" && (
        <Modal
          title={`Запросити до кімнати ${room.number}`}
          note="Поділіться посиланням, щоб додати нового мешканця."
          onClose={() => setModal(null)}
        >
          <div className="invite-modal-content">
            <span className="modal-illustration">
              <Icon name="link" size={30} />
            </span>
            <h3>Одне посилання — і roomie всередині</h3>
            <p>Надішліть його в будь-який месенджер.</p>
            <div className="share-link">
              <button className="invite-url" onClick={() => setModal("join")}>
                {inviteUrl.replace("https://", "")}
              </button>
              <button onClick={copyInvite}>
                <Icon name="copy" size={17} />
                Скопіювати посилання
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === "join" && (
        <Modal
          title={`Кімната ${room.number}`}
          note={`${roomMembers.length} мешканці вже користуються Roomie у цій кімнаті.`}
          onClose={() => setModal(null)}
        >
          <div className="join-preview">
            <div className="join-members">
              {roomMembers.slice(0, 4).map((item) => (
                <Avatar member={item} size="md" key={item.id} />
              ))}
            </div>
            <h3>Вас запросили жити разом</h3>
            <p>Після приєднання ви побачите спільні справи, покупки та розрахунки.</p>
            <button className="primary-button" onClick={joinRoom}>
              Приєднатися <Icon name="arrow" size={16} />
            </button>
          </div>
        </Modal>
      )}

      {modal === "room" && (
        <Modal
          title="Створити нову кімнату"
          note="Можна мати кілька кімнат і легко перемикатися між ними."
          onClose={() => setModal(null)}
        >
          <form className="form" onSubmit={createRoom}>
            <label>
              Номер кімнати
              <input name="number" required maxLength={12} placeholder="Наприклад, 305-Б" />
            </label>
            <div className="modal-actions">
              <button type="button" className="outline-button" onClick={() => setModal(null)}>
                Скасувати
              </button>
              <button className="primary-button">Створити кімнату</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "chore" && (
        <Modal
          title="Новий обов’язок"
          note="Призначена людина має його погодити."
          onClose={() => setModal(null)}
          wide
        >
          <form className="form" onSubmit={addChore}>
            <label>
              Що потрібно зробити?
              <input name="title" required placeholder="Наприклад, помити холодильник" />
            </label>
            <div className="form-grid">
              <label>
                Хто виконує
                <select name="owner">
                  {roomMembers.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Коли виконати
                <input name="due" required placeholder="Завтра, 18:00" />
              </label>
            </div>
            <fieldset>
              <legend>Складність</legend>
              <Stars value={difficulty} onChange={setDifficulty} />
            </fieldset>
            <fieldset>
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
              <fieldset className="rotation-field">
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
            <div className="modal-actions">
              <button type="button" className="outline-button" onClick={() => setModal(null)}>
                Скасувати
              </button>
              <button className="primary-button">Створити обов’язок</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "expense" && (
        <Modal
          title="Додати спільну витрату"
          note="Оберіть конкретних людей — Roomie сам порахує частку кожного."
          onClose={() => setModal(null)}
          wide
        >
          <form className="form" onSubmit={addExpense}>
            <div className="form-grid">
              <label>
                Що купили?
                <input name="title" required placeholder="Побутова хімія" />
              </label>
              <label>
                Сума, ₴<input name="amount" type="number" min="1" required placeholder="0" />
              </label>
            </div>
            <fieldset>
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
              <textarea name="note" rows={3} placeholder="Додайте номер картки чи пояснення" />
            </label>
            <div className="modal-actions">
              <button type="button" className="outline-button" onClick={() => setModal(null)}>
                Скасувати
              </button>
              <button className="primary-button">Додати й розділити</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "shopping" && (
        <Modal title="Додати покупку" onClose={() => setModal(null)}>
          <form className="form" onSubmit={addShopping}>
            <label>
              Що потрібно купити?
              <input name="title" required autoFocus placeholder="Наприклад, паперові рушники" />
            </label>
            <div className="modal-actions">
              <button type="button" className="outline-button" onClick={() => setModal(null)}>
                Скасувати
              </button>
              <button className="primary-button">Додати до списку</button>
            </div>
          </form>
        </Modal>
      )}

      {detailExpense && (
        <Modal
          title={detailExpense.title}
          note={`${detailExpense.date} · оплатив(-ла) ${member(detailExpense.payerId).name}`}
          onClose={() => setDetailExpense(null)}
        >
          <div className="expense-detail">
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
                <b>{Math.round(detailExpense.amount / detailExpense.participantIds.length)} ₴</b>
              </div>
            ))}
            {detailExpense.note && (
              <div className="payment-note">
                <span>КОМЕНТАР / КАРТКА</span>
                <strong>{detailExpense.note}</strong>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(detailExpense.note);
                    notify("Скопійовано");
                  }}
                >
                  <Icon name="copy" size={16} />
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
