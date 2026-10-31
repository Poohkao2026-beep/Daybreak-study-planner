import { getState, replaceAllStores } from "../store.js";
import { validateBackup } from "../lib/validation.js";
import { putMeta } from "../db/repositories/meta.js";

export async function makeBackup(now = new Date()) {
  const state = getState();
  return {
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    subjects: state.subjects,
    tasks: state.tasks,
    sessions: state.sessions,
    meta: Object.entries(state.meta).map(([key, value]) => ({ key, value })),
  };
}

export async function importBackup(payload) {
  const validation = validateBackup(payload);
  if (!validation.valid) throw new Error(validation.error);
  const meta = payload.meta.filter(({ key }) => !["migratedFromV1At", "schemaVersion"].includes(key));
  meta.push({ key: "schemaVersion", value: 1 });
  meta.push({ key: "lastBackupAt", value: new Date().toISOString() });
  await replaceAllStores({ ...payload, meta });
}

export async function recordBackupTime(now = new Date()) {
  await putMeta("lastBackupAt", now.toISOString());
}

export function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function downloadRawData(raw) {
  downloadJson(JSON.parse(raw), "daybreak-recovery.json");
}
