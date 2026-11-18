import { useEffect, useState } from "react";
import { api } from "./api";
import Avatar from "./Avatar";
import "./home.css";

type Features = Awaited<ReturnType<typeof api.home>>["features"];
const featureIcons: Record<string, string> = { chores: "✓", shopping: "＋", expenses: "₴" };

export default function HomePage() {
  const [features, setFeatures] = useState<Features>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.home(controller.signal).then(({ features }) => {
      if (!controller.signal.aborted) setFeatures(features);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [attempt]);

  const login = "?auth=login";
  const register = "?auth=register";

  return <div className="roomie-home">
    <header className="home-header">
      <a className="home-brand" href={import.meta.env.BASE_URL}>
        <span aria-hidden="true"><Avatar member={{ name: "Roomie" }} size="sm" /></span>
        Roomie
      </a>
      <nav aria-label="Акаунт">
        <a className="home-login" href={login}>Увійти</a>
      </nav>
    </header>

    <main>
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-copy">
          <h1 id="home-title">Спільний дім.<br /><em>Спільні справи.</em></h1>
          <p>Розподіляйте домашні обов’язки, плануйте покупки й діліть витрати з тими, з ким живете.</p>
          <a className="home-cta" href={register}>Створити акаунт <span aria-hidden="true">↗</span></a>
        </div>

        <div className="home-preview" aria-hidden="true">
          <div className="home-preview-card">
            <div className="home-preview-header">
              <div><small>Спільна квартира</small><strong>Сьогодні</strong></div>
              <div className="home-preview-avatars">
                <Avatar member={{ name: "Оля", color: "#BF8790", gaze: "happy" }} size="sm" />
                <Avatar member={{ name: "Максим", color: "#8D9C83", gaze: "left" }} size="sm" />
              </div>
            </div>
            <div className="home-preview-row"><span>✓</span><div>Прибрати кухню<small>Обов’язки · Оля</small></div></div>
            <div className="home-preview-row"><span>＋</span><div>Купити засіб для посуду<small>Покупки</small></div></div>
            <div className="home-preview-row"><span>₴</span><div>Інтернет<small>Спільні витрати</small></div></div>
          </div>
        </div>
      </section>

      {(features.length > 0 || failed) && <section className="home-features" aria-label="Можливості Roomie">
        {failed ? <div role="status">
          Не вдалося завантажити можливості Roomie.{" "}
          <button type="button" onClick={() => {
            setFailed(false);
            setAttempt(attempt + 1);
          }}>Спробувати ще раз</button>
        </div> : <ul>
          {features.map(({ id, title, description }) => <li key={id}>
            <span aria-hidden="true">{featureIcons[id]}</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </li>)}
        </ul>}
      </section>}
    </main>
  </div>;
}
