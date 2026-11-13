import {
  DatabaseBlockedError,
  DatabaseMigrationError,
  DatabaseOpenError,
  DatabaseUnavailableError,
} from './errors.js'
import { applyMigrations, DATABASE_NAME, DATABASE_VERSION } from './schema.js'

export function openDatabase({
  indexedDB = globalThis.indexedDB,
  name = DATABASE_NAME,
  version = DATABASE_VERSION,
  migrate = applyMigrations,
} = {}) {
  if (!indexedDB?.open) return Promise.reject(new DatabaseUnavailableError())
  if (!Number.isInteger(version) || version < 1) {
    return Promise.reject(new DatabaseOpenError(new TypeError('A versão precisa ser um inteiro positivo.')))
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let blocked = false
    let migrationError
    let request

    try {
      request = indexedDB.open(name, version)
    } catch (error) {
      reject(new DatabaseOpenError(error))
      return
    }

    request.onupgradeneeded = (event) => {
      try {
        migrate(request.result, event.oldVersion, event.newVersion, request.transaction)
      } catch (error) {
        migrationError = error
        try { request.transaction.abort() } catch { /* transaction may already be inactive */ }
      }
    }

    request.onblocked = () => {
      blocked = true
      if (!settled) {
        settled = true
        reject(new DatabaseBlockedError())
      }
    }

    request.onerror = () => {
      if (settled) return
      settled = true
      reject(migrationError
        ? new DatabaseMigrationError(version, migrationError)
        : new DatabaseOpenError(request.error))
    }

    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      if (blocked || settled) {
        database.close()
        return
      }
      settled = true
      resolve(database)
    }
  })
}
