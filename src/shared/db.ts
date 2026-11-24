const database = 'night-session'
const version = 2
export const takesTable = 'takes'
export const layoutsTable = 'layouts'

function connect() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, version)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(takesTable)) db.createObjectStore(takesTable, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(layoutsTable)) db.createObjectStore(layoutsTable, { keyPath: 'songId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function transact<T>(
  table: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await connect()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(table, mode)
      const request = operation(transaction.objectStore(table))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}
