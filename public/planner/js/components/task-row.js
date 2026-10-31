import { element, button } from "./dom.js";
import { dateKey, relativeDate } from "../lib/dates.js";
import { subjectChip } from "./subject-chip.js";

export function createTaskRow(task, subject, options = {}) {
  const row = element("article", { className: `task-row${task.status === "done" ? " is-done" : ""}`, attrs: { "data-task-id": task.id, draggable: "true" } });
  const mark = button(task.status === "done" ? "Restore task" : "Mark done", "toggle-task", { className: `task-check${task.status === "done" ? " is-checked" : ""}`, label: task.status === "done" ? `Mark ${task.title} as not done` : `Mark ${task.title} as done` });
  mark.setAttribute("aria-pressed", String(task.status === "done"));
  const main = element("div", { className: "task-main" });
  const titleLine = element("div", { className: "task-title-line" });
  titleLine.append(element("h3", { text: task.title }));
  if (task.pinnedAt) titleLine.append(element("span", { className: "pin-label", text: "Pinned" }));
  const metadata = element("div", { className: "task-metadata" });
  metadata.append(subjectChip(subject));
  if (task.dueDate) {
    const exactDate = new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date(`${task.dueDate}T12:00:00`));
    metadata.append(element("time", {
      className: "metadata-text",
      text: `${relativeDate(task.dueDate)}${task.dueTime ? ` · ${task.dueTime}` : ""}`,
      attrs: { datetime: task.dueDate, title: exactDate, tabindex: "0", "aria-label": `Due ${exactDate}${task.dueTime ? ` at ${task.dueTime}` : ""}` },
    }));
  } else metadata.append(element("span", { className: "metadata-text", text: "No date" }));
  if (task.status !== "done" && task.dueDate && task.dueDate < dateKey()) metadata.append(element("span", { className: "overdue-label", text: "! Overdue" }));
  metadata.append(element("span", { className: `priority priority-${task.priority}`, text: `${task.priority} priority` }));
  if (task.estimateMin) metadata.append(element("span", { className: "metadata-text", text: `${task.estimateMin} min` }));
  if (task.subtasks?.length) metadata.append(element("span", { className: "metadata-text", text: `${task.subtasks.filter((item) => item.done).length}/${task.subtasks.length} subtasks` }));
  main.append(titleLine, metadata);
  const actions = element("div", { className: "task-actions" });
  if (options.onFocus) actions.append(button("Start focus", "focus-task"));
  actions.append(button(task.pinnedAt ? "Unpin task" : "Pin task", "pin-task"));
  actions.append(button("Edit", "edit-task"));
  actions.append(button("Delete", "delete-task"));
  row.append(mark, main, actions);
  if (task.status === "doing") row.append(element("span", { className: "status-label", text: "In progress" }));
  return row;
}
