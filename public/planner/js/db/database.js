const DATABASE_NAME = globalThis.__DAYBREAK_DATABASE_NAME__ || "daybreak";
const DATABASE_VERSION = 1;

const stores = {
  subjects: { keyPath: "id", indexes: { name: "name", archivedAt: "archivedAt" } },
  tasks: { keyPath: "id", indexes: { status: "status", dueDate: "dueDate", subjectId: "subjectId", deletedAt: "deletedAt" } },
  sessions: { keyPath: "id", indexes: { startedAt: "startedAt" } },
  meta: { keyPath: "key", indexes: {} },
};

let connection;

export function openDatabase() {
  if (connection) return Promise.resolve(connection);
  if (!globalThis.indexedDB) return Promise.reject(new Error("Your browser does not support local database storage."));

  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(storageError(error));
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      for (const [name, definition] of Object.entries(stores)) {
        const store = database.objectStoreNames.contains(name)
          ? request.transaction.objectStore(name)
          : database.createObjectStore(name, { keyPath: definition.keyPath });
        for (const [indexName, keyPath] of Object.entries(definition.indexes)) {
          if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, { unique: false });
        }
      }
    };
    request.onblocked = () => reject(new Error("Daybreak is waiting for another tab to close before updating storage. Close other Daybreak tabs and reload."));
    request.onerror = () => reject(storageError(request.error));
    request.onsuccess = () => {
      const openedConnection = request.result;
      connection = openedConnection;
      openedConnection.onversionchange = () => {
        openedConnection.close();
        if (connection === openedConnection) connection = undefined;
        window.dispatchEvent(new CustomEvent("daybreak:storage-versionchange"));
      };
      resolve(connection);
    };
  });
}

export function closeDatabase() {
  connection?.close();
  connection = undefined;
}

export function transact(storeNames, mode, action) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    let transaction;
    let result;
    try {
      transaction = database.transaction(storeNames, mode);
      result = action(transaction);
    } catch (error) {
      reject(storageError(error));
      return;
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(storageError(transaction.error));
    transaction.onerror = () => reject(storageError(transaction.error));
  }));
}

export function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
  });
}

export function storageError(error) {
  if (error?.name === "QuotaExceededError") return new Error("Daybreak could not save because this browser's storage is full. Export a backup or free browser storage, then try again.");
  if (error?.name === "SecurityError" || error?.name === "InvalidStateError") return new Error("This browser is blocking Daybreak's local storage. Check site permissions or download your data before continuing.");
  return new Error(error?.message || "Daybreak could not access its local database. Your existing data has not been removed.");
}
