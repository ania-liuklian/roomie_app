import { AVATAR_COLORS, type AvatarOptions } from "./Avatar";

export const EYE_STYLES = [{ value: "plain", label: "Без вій" }, { value: "lashes", label: "З віями" }] as const;
export const GAZES = [
  { value: "straight", label: "Прямо" }, { value: "left", label: "Ліворуч" },
  { value: "right", label: "Праворуч" }, { value: "up", label: "Угору" },
  { value: "happy", label: "Щасливий" }, { value: "sleepy", label: "Сонний" },
] as const;
const COLOR_NAMES = ["Рожевий", "Теракотовий", "Шавлієвий", "Золотистий", "Тауп", "Світло-рожевий", "Коричневий", "Бузковий"];

export default function AvatarPicker({ value, onChange, disabled = false }: {
  value: Required<AvatarOptions>;
  onChange: (value: Required<AvatarOptions>) => void;
  disabled?: boolean;
}) {
  return <section className="avatar-picker" aria-label="Налаштування аватара">
    <fieldset disabled={disabled}>
      <legend>Колір</legend>
      <div className="avatar-picker-options">
        {AVATAR_COLORS.map((color, index) => <button key={color} type="button" disabled={disabled}
          className="avatar-color-swatch" style={{ backgroundColor: color }}
          aria-label={COLOR_NAMES[index]} title={COLOR_NAMES[index]} aria-pressed={value.color === color}
          onClick={() => onChange({ ...value, color })}>{value.color === color ? "✓" : ""}</button>)}
      </div>
    </fieldset>
    <fieldset disabled={disabled}>
      <legend>Очі</legend>
      <div className="avatar-picker-options">
        {EYE_STYLES.map(({ value: eye_style, label }) => <button key={eye_style} type="button"
          className="outline-button" disabled={disabled} aria-pressed={value.eye_style === eye_style}
          onClick={() => onChange({ ...value, eye_style })}>{label}</button>)}
      </div>
    </fieldset>
    <fieldset disabled={disabled}>
      <legend>Погляд</legend>
      <div className="avatar-picker-options">
        {GAZES.map(({ value: gaze, label }) => <button key={gaze} type="button"
          className="outline-button" disabled={disabled} aria-pressed={value.gaze === gaze}
          onClick={() => onChange({ ...value, gaze })}>{label}</button>)}
      </div>
    </fieldset>
  </section>;
}
