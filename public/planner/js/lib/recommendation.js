import { addDays, dateKey } from "./dates.js";

const priorityRank = { high: 0, normal: 1, low: 2 };

export function recommendTask(tasks, now = new Date(), context = {}) {
  const today = dateKey(now);
  const tomorrow = addDays(today, 1);
  const subjects = context.subjects || [];
  const archived = new Set(subjects.filter((subject) => subject.archivedAt).map((subject) => subject.id));
  const eligible = tasks.filter((task) => task.status !== "done" && !task.deletedAt && !archived.has(task.subjectId));
  const pinned = eligible.find((task) => task.pinnedAt);
  if (pinned) return { task: pinned, reasons: ["Pinned by you"] };
  const tier = (task) => !task.dueDate ? 3 : task.dueDate < today ? 0 : task.dueDate === today ? 1 : task.dueDate === tomorrow ? 2 : 3;
  eligible.sort((a, b) => {
    const deadline = tier(a) - tier(b);
    if (deadline) return deadline;
    if (a.dueDate === b.dueDate && a.dueDate === today && a.dueTime && b.dueTime) {
      const time = a.dueTime.localeCompare(b.dueTime);
      if (time) return time;
    }
    const priority = priorityRank[a.priority] - priorityRank[b.priority];
    if (priority) return priority;
    const progress = Number(b.status === "doing") - Number(a.status === "doing");
    if (progress) return progress;
    if (a.estimateMin < 60 && b.estimateMin < 60 && a.estimateMin !== b.estimateMin) return a.estimateMin - b.estimateMin;
    const order = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
    if (order) return order;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
  const task = eligible[0];
  if (!task) return null;
  const reasons = [];
  if (task.dueDate && task.dueDate < today) reasons.push(`Overdue · ${task.dueDate}`);
  else if (task.dueDate === today) reasons.push("Due today");
  else if (task.dueDate === tomorrow) reasons.push("Due tomorrow");
  if (task.priority === "high") reasons.push("High priority");
  if (task.estimateMin && task.estimateMin <= 25) reasons.push(`Fits in ${task.estimateMin} min`);
  return { task, reasons: reasons.slice(0, 2) };
}
