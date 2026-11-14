/** Convert only at the UI boundary. All stored and transmitted money is integer kopecks. */
export function money(value: number): string;
export function money(value: string): number;
export function money(value: number | string): string | number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Expected integer kopecks");
    const text = BigInt(value).toString();
    const negative = text.startsWith("-");
    const digits = (negative ? text.slice(1) : text).padStart(3, "0");
    const whole = digits.slice(0, -2);
    const fraction = digits.slice(-2);
    return `${negative ? "-" : ""}${whole}${fraction === "00" ? "" : `.${fraction}`}`;
  }
  const match = value.trim().match(/^(\d+)(?:[.,](\d{1,2}))?$/);
  if (!match) throw new Error("Введіть суму в гривнях із не більш ніж двома знаками після коми.");
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
  if (minor <= 0n || minor > 1000000000000n) throw new Error("Сума має бути більшою за нуль і не перевищувати 10 000 000 000 ₴.");
  return Number(minor);
}
