import { requestResult, transact } from "../database.js";

export const getSessions = () => transact(["sessions"], "readonly", (tx) => requestResult(tx.objectStore("sessions").getAll()));
export const putSession = (session) => transact(["sessions"], "readwrite", (tx) => tx.objectStore("sessions").put(session));
