import { requestResult, transact } from "../database.js";

export const getMeta = () => transact(["meta"], "readonly", (tx) => requestResult(tx.objectStore("meta").getAll()));
export const getMetaValue = (key) => transact(["meta"], "readonly", async (tx) => (await requestResult(tx.objectStore("meta").get(key)))?.value);
export const putMeta = (key, value) => transact(["meta"], "readwrite", (tx) => tx.objectStore("meta").put({ key, value }));
