import { element } from "./dom.js";

export function subjectChip(subject) {
  if (!subject) return element("span", { className: "subject-chip subject-none", text: "No subject" });
  return element("span", { className: `subject-chip color-${subject.colorKey}`, text: subject.name });
}
