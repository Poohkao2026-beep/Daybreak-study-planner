import { requestResult, transact } from "../database.js";

export const getTasks = () => transact(["tasks"], "readonly", (tx) => requestResult(tx.objectStore("tasks").getAll()));
export const putTask = (task) => transact(["tasks"], "readwrite", (tx) => tx.objectStore("tasks").put(task));
export const deleteTask = (id) => transact(["tasks"], "readwrite", (tx) => tx.objectStore("tasks").delete(id));
