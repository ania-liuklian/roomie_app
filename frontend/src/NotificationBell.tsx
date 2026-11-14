import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatTimestamp, type ApiNotification, type ApiNotifications } from "./api";
import Avatar from "./Avatar";

export function NotificationItems({ items, busy, onRead }: {
  items: ApiNotification[]; busy: boolean; onRead: (item: ApiNotification) => void;
}) {
  return <ul className="notification-items">{items.map((item) => <li key={item.id}>
    <button type="button" className={`notification-item${item.read_at ? "" : " unread"}`}
      disabled={busy} onClick={() => onRead(item)} aria-label={`${item.message} ${item.read_at ? "Прочитано" : "Непрочитано"}`}>
      <Avatar member={item.actor} size="sm" />
      <span><strong>{item.actor.name}</strong><span>{item.message}</span><small>{formatTimestamp(item.created_at)}</small></span>
      {!item.read_at && <span className="notification-item-dot" aria-hidden="true" />}
    </button>
  </li>)}</ul>;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ApiNotifications | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const alive = useRef(false);
  const reading = useRef<AbortController | null>(null);
  const writing = useRef<AbortController | null>(null);

  const refresh = useCallback(async (force = false) => {
    if (!alive.current || (writing.current && !force)) return;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await api.notifications(controller.signal);
      if (!controller.signal.aborted && alive.current) setData(result);
    } catch (error) {
      if (!controller.signal.aborted && alive.current) setError(error instanceof Error ? error.message : "Не вдалося завантажити сповіщення.");
    } finally {
      if (!controller.signal.aborted && alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      reading.current?.abort();
      writing.current?.abort();
      writing.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); bell.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const markRead = async (item?: ApiNotification) => {
    if (writing.current || item?.read_at) return;
    reading.current?.abort();
    const controller = new AbortController();
    writing.current = controller;
    setBusy(true);
    setLoading(false);
    setError("");
    try {
      if (item) await api.readNotification(item.id, controller.signal);
      else await api.readAllNotifications(controller.signal);
      if (!controller.signal.aborted && alive.current) await refresh(true);
    } catch (error) {
      if (!controller.signal.aborted && alive.current) setError(error instanceof Error ? error.message : "Не вдалося позначити сповіщення прочитаним.");
    } finally {
      if (writing.current === controller) writing.current = null;
      if (!controller.signal.aborted && alive.current) setBusy(false);
    }
  };

  const unread = data?.unread_count ?? 0;
  return <div className="notification-bell" ref={root}>
    <button ref={bell} type="button" className={`circle-button notification${unread ? " has-unread" : ""}`}
      aria-label={unread ? `Сповіщення: ${unread} непрочитаних` : "Сповіщення"}
      aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen(!open); if (!open) void refresh(); }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
    </button>
    {open && <section className="notification-dropdown" role="dialog" aria-label="Сповіщення" aria-busy={loading || busy}>
      <header><h3>Сповіщення{data ? ` (${unread})` : ""}</h3>
        <button type="button" className="ghost-button" disabled={busy || loading || !unread} onClick={() => markRead()}>Прочитати всі</button>
      </header>
      {loading && <p role="status">Завантаження…</p>}
      {busy && <p role="status">Збереження…</p>}
      {error && <div role="alert"><p>{error}</p><button className="outline-button" disabled={busy} onClick={() => { void refresh(); }}>Спробувати ще раз</button></div>}
      {data && !data.items.length && !loading && !error && <p>Сповіщень поки немає.</p>}
      {data && <NotificationItems items={data.items} busy={busy || loading} onRead={(item) => { void markRead(item); }} />}
      {data && data.total > data.items.length && <p>Показано останні {data.items.length} із {data.total}.</p>}
    </section>}
  </div>;
}
