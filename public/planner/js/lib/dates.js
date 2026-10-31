export function dateKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function parseDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return null;
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function addDays(key, amount) {
  const date = parseDateKey(key);
  if (!date) return null;
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

export function daysBetween(from, to) {
  const left = parseDateKey(from);
  const right = parseDateKey(to);
  if (!left || !right) return null;
  return Math.round((Date.UTC(right.getFullYear(), right.getMonth(), right.getDate()) - Date.UTC(left.getFullYear(), left.getMonth(), left.getDate())) / 86_400_000);
}

export function relativeDate(key, now = new Date()) {
  const distance = daysBetween(dateKey(now), key);
  if (distance === null) return "No date";
  if (distance === 0) return "Today";
  if (distance === 1) return "Tomorrow";
  if (distance === -1) return "Yesterday";
  if (distance > 1 && distance < 7) return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(parseDateKey(key));
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: parseDateKey(key).getFullYear() !== now.getFullYear() ? "numeric" : undefined }).format(parseDateKey(key));
}

export function formatFullDate(now = new Date()) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now);
}

export function formatLocalTime(now = new Date()) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(now);
}
