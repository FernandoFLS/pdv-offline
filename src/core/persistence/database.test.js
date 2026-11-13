import { afterEach, describe, expect, it } from 'vitest'
import {
  DatabaseAccessError,
  DatabaseBlockedError,
  DatabaseMigrationError,
  DatabaseOpenError,
  DatabaseUnavailableError,
  getAllRecords,
  getRecord,
  openDatabase,
  putRecord,
} from './index.js'

const openConnections = new Set()

async function openTracked(options) {
  const database = await openDatabase(options)
  openConnections.add(database)
  return database
}

afterEach(() => {
  for (const database of openConnections) database.close()
  openConnections.clear()
})

describe('banco local IndexedDB', () => {
  it('cria as stores e os índices definidos na versão atual', async () => {
    const database = await openTracked({ name: `schema-${crypto.randomUUID()}` })
    expect([...database.objectStoreNames]).toEqual([
      'auditLog', 'cashMovements', 'cashSessions', 'cashState', 'userIdentityArchive', 'users',
    ])

    const expectations = {
      users: [['by-role', 'role'], ['by-status', 'status']],
      cashSessions: [['by-status', 'status'], ['by-opened-at', 'openedAt']],
      cashState: [['by-updated-at', 'updatedAt'], ['by-status', 'status']],
      cashMovements: [
        ['by-session-id', 'sessionId'],
        ['by-type', 'type'],
        ['by-occurred-at', 'occurredAt'],
        ['by-idempotency-key', 'idempotencyKey'],
      ],
      auditLog: [
        ['by-entity', ['entityType', 'entityId']],
        ['by-occurred-at', 'occurredAt'],
        ['by-actor-user-id', 'actorUserId'],
      ],
      userIdentityArchive: [['by-deleted-at', 'deletedAt']],
    }

    for (const [storeName, indexes] of Object.entries(expectations)) {
      const transaction = database.transaction(storeName)
      const store = transaction.objectStore(storeName)
      expect(store.keyPath).toBe('id')
      for (const [name, keyPath] of indexes) {
        expect(store.index(name).keyPath).toEqual(keyPath)
      }
    }
    expect(database.transaction('cashMovements').objectStore('cashMovements')
      .index('by-idempotency-key').unique).toBe(true)
  })

  it('grava, consulta e lista registros; permite movimentos sem chave opcional', async () => {
    const database = await openTracked({ name: `records-${crypto.randomUUID()}` })
    const record = { id: 'movement-1', sessionId: 'session-1', type: 'opening', amountMinor: 12500 }
    await expect(putRecord(database, 'cashMovements', record)).resolves.toBe('movement-1')
    await expect(getRecord(database, 'cashMovements', record.id)).resolves.toEqual(record)
    await expect(getAllRecords(database, 'cashMovements')).resolves.toEqual([record])
  })

  it('impede chaves de idempotência repetidas e não deixa registro parcial', async () => {
    const database = await openTracked({ name: `unique-${crypto.randomUUID()}` })
    await putRecord(database, 'cashMovements', { id: 'a', idempotencyKey: 'same' })
    await expect(putRecord(database, 'cashMovements', { id: 'b', idempotencyKey: 'same' }))
      .rejects.toMatchObject({ name: 'DatabaseAccessError', cause: { name: 'ConstraintError' } })
    await expect(getRecord(database, 'cashMovements', 'b')).resolves.toBeUndefined()
  })

  it('exige identificador primário em cada registro', async () => {
    const database = await openTracked({ name: `key-path-${crypto.randomUUID()}` })
    await expect(putRecord(database, 'users', { role: 'operator' }))
      .rejects.toMatchObject({ name: 'DatabaseAccessError', cause: { name: 'DataError' } })
  })

  it('converte falhas de acesso a stores inexistentes em erro da camada', async () => {
    const database = await openTracked({ name: `access-${crypto.randomUUID()}` })
    await expect(getRecord(database, 'not-a-store', '1')).rejects.toBeInstanceOf(DatabaseAccessError)
  })

  it('informa quando IndexedDB não está disponível', async () => {
    await expect(openDatabase({ indexedDB: null })).rejects.toBeInstanceOf(DatabaseUnavailableError)
  })

  it('informa quando a atualização fica bloqueada por uma conexão antiga', async () => {
    const name = `blocked-${crypto.randomUUID()}`
    const blocker = await openTracked({ name, version: 1 })
    blocker.onversionchange = null

    await expect(openDatabase({ name, version: 2 })).rejects.toBeInstanceOf(DatabaseBlockedError)

    blocker.close()
    const upgraded = await openTracked({ name, version: 2 })
    expect(upgraded.version).toBe(2)
  })

  it('encapsula falha ao abrir uma versão incompatível do banco', async () => {
    const name = `open-error-${crypto.randomUUID()}`
    await openTracked({ name, version: 2 })

    await expect(openDatabase({ name, version: 1 })).rejects.toMatchObject({
      name: 'DatabaseOpenError',
      code: 'DATABASE_OPEN_FAILED',
      cause: { name: 'VersionError' },
    })
  })

  it('fecha a conexão antiga ao receber versionchange', async () => {
    const name = `versionchange-${crypto.randomUUID()}`
    const oldConnection = await openTracked({ name, version: 1 })

    const upgraded = await openTracked({ name, version: 2 })

    expect(upgraded.version).toBe(2)
    expect(() => oldConnection.transaction('users')).toThrow()
  })

  it('executa a migração real 1→2, preserva registros e aplica o novo índice', async () => {
    const name = `upgrade-${crypto.randomUUID()}`
    const v1 = await openTracked({
      name,
      version: 1,
    })
    const existingRecord = { id: 'current', status: 'open', updatedAt: '2026-10-27T12:00:00.000Z' }
    await putRecord(v1, 'cashState', existingRecord)
    v1.close()
    openConnections.delete(v1)

    const v2 = await openTracked({ name, version: 2 })
    expect(v2.version).toBe(2)
    await expect(getRecord(v2, 'cashState', 'current')).resolves.toEqual(existingRecord)
    expect(v2.transaction('cashState').objectStore('cashState').indexNames)
      .toContain('by-status')
  })

  it('executa a migração real 2→3, preserva registros e cria o arquivo de identidade', async () => {
    const name = `upgrade-2-3-${crypto.randomUUID()}`
    const v2 = await openTracked({ name, version: 2 })
    const existingUser = { id: 'operator-1', displayName: 'Operador', role: 'operator', status: 'active' }
    const existingAudit = { id: 'audit-1', entityType: 'user', entityId: 'operator-1', action: 'authentication.admin-created' }
    await putRecord(v2, 'users', existingUser)
    await putRecord(v2, 'auditLog', existingAudit)
    v2.close()
    openConnections.delete(v2)

    const v3 = await openTracked({ name, version: 3 })
    expect(v3.version).toBe(3)
    await expect(getRecord(v3, 'users', existingUser.id)).resolves.toEqual(existingUser)
    await expect(getRecord(v3, 'auditLog', existingAudit.id)).resolves.toEqual(existingAudit)
    expect(v3.transaction('userIdentityArchive').objectStore('userIdentityArchive').indexNames)
      .toContain('by-deleted-at')
  })

  it('aborta uma atualização incompleta e preserva versão, esquema e dados anteriores', async () => {
    const name = `rollback-${crypto.randomUUID()}`
    const v1 = await openTracked({ name, version: 1 })
    const existingRecord = { id: 'operator-1', role: 'operator', status: 'active' }
    await putRecord(v1, 'users', existingRecord)
    v1.close()
    openConnections.delete(v1)

    await expect(openDatabase({ name, version: 4 })).rejects.toBeInstanceOf(DatabaseMigrationError)

    const restored = await openTracked({ name, version: 1 })
    expect(restored.version).toBe(1)
    await expect(getRecord(restored, 'users', existingRecord.id)).resolves.toEqual(existingRecord)
    expect(restored.transaction('cashState').objectStore('cashState').indexNames)
      .not.toContain('by-status')
  })
})
