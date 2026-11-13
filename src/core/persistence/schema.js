export const DATABASE_NAME = 'pdv-offline'
export const DATABASE_VERSION = 3

const createStore = (database, name, options, indexes = []) => {
  const store = database.createObjectStore(name, options)
  for (const [indexName, keyPath, indexOptions = {}] of indexes) {
    store.createIndex(indexName, keyPath, indexOptions)
  }
}

// Each version is an upgrade step. Add a new entry for every schema version;
// never rewrite an already released migration.
export const migrations = {
  1(database) {
    createStore(database, 'users', { keyPath: 'id' }, [
      ['by-role', 'role'],
      ['by-status', 'status'],
    ])
    createStore(database, 'cashSessions', { keyPath: 'id' }, [
      ['by-status', 'status'],
      ['by-opened-at', 'openedAt'],
    ])
    createStore(database, 'cashState', { keyPath: 'id' }, [
      ['by-updated-at', 'updatedAt'],
    ])
    createStore(database, 'cashMovements', { keyPath: 'id' }, [
      ['by-session-id', 'sessionId'],
      ['by-type', 'type'],
      ['by-occurred-at', 'occurredAt'],
      ['by-idempotency-key', 'idempotencyKey', { unique: true }],
    ])
    createStore(database, 'auditLog', { keyPath: 'id' }, [
      ['by-entity', ['entityType', 'entityId']],
      ['by-occurred-at', 'occurredAt'],
      ['by-actor-user-id', 'actorUserId'],
    ])
  },
  2(_database, transaction) {
    transaction.objectStore('cashState').createIndex('by-status', 'status')
  },
  3(database) {
    createStore(database, 'userIdentityArchive', { keyPath: 'id' }, [
      ['by-deleted-at', 'deletedAt'],
    ])
  },
}

export function applyMigrations(database, oldVersion, newVersion, transaction) {
  for (let version = oldVersion + 1; version <= newVersion; version += 1) {
    const migrate = migrations[version]
    if (!migrate) throw new Error(`Migração ausente para a versão ${version}.`)
    migrate(database, transaction)
  }
}
