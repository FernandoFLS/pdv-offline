import { DatabaseAccessError } from './errors.js'

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function getRecord(database, storeName, key) {
  try {
    const transaction = database.transaction(storeName, 'readonly')
    return await requestResult(transaction.objectStore(storeName).get(key))
  } catch (error) {
    throw new DatabaseAccessError('leitura', error)
  }
}

export async function getAllRecords(database, storeName) {
  try {
    const transaction = database.transaction(storeName, 'readonly')
    return await requestResult(transaction.objectStore(storeName).getAll())
  } catch (error) {
    throw new DatabaseAccessError('leitura', error)
  }
}

export async function putRecord(database, storeName, record) {
  try {
    const transaction = database.transaction(storeName, 'readwrite')
    const transactionDone = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onabort = () => reject(transaction.error)
      transaction.onerror = () => reject(transaction.error)
    })
    const [result] = await Promise.all([
      requestResult(transaction.objectStore(storeName).put(record)),
      transactionDone,
    ])
    return result
  } catch (error) {
    throw new DatabaseAccessError('gravação', error)
  }
}
