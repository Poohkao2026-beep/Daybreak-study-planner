import { requestResult, transact } from "../database.js";

export const getSubjects = () => transact(["subjects"], "readonly", (tx) => requestResult(tx.objectStore("subjects").getAll()));
export const putSubject = (subject) => transact(["subjects"], "readwrite", (tx) => tx.objectStore("subjects").put(subject));
export const deleteSubject = (id) => transact(["subjects"], "readwrite", (tx) => tx.objectStore("subjects").delete(id));
