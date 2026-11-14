/** Native datetime-local inputs represent the device's local time, not a UTC string. */
export function localDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function dueForSave(input: string, original: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid due date");
  return date.getTime() === Math.floor(new Date(original).getTime() / 1000) * 1000 ? original : date.toISOString();
}
