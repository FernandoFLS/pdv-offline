import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../core/persistence/database.js'
import { getAllRecords, getRecord, putRecord } from '../../core/persistence/records.js'
import { createCashService } from '../cash/service.js'
import { createAuthenticationService } from './service.js'
import { createSessionStore } from './session.js'

const databases = new Set()
const sessions = new Set()

async function openTestDatabase() {
  const database = await openDatabase({ name: `auth-${crypto.randomUUID()}` })
  databases.add(database)
  return database
}

function createAuth(database, options) {
  const auth = createAuthenticationService(database, options)
  sessions.add(auth.session)
  return auth
}

function createChannelFactory() {
  const channels = []
  return () => {
    const listeners = new Set()
    const channel = {
      addEventListener(_type, listener) { listeners.add(listener) },
      postMessage(data) {
        for (const peer of channels) {
          if (peer !== channel) for (const listener of peer.listeners) listener({ data })
        }
      },
      listeners,
    }
    channels.push(channel)
    return channel
  }
}

afterEach(() => {
  for (const session of sessions) session.logout()
  sessions.clear()
  for (const database of databases) database.close()
  databases.clear()
})

describe('autenticação local', () => {
  it('cadastra somente o primeiro administrador e nunca expõe o PIN na sessão', async () => {
    const database = await openTestDatabase()
    const auth = createAuth(database)
    expect(await auth.isFirstRun()).toBe(true)

    const admin = await auth.createInitialAdmin({ displayName: 'Fernando', pin: '001234' })
    expect(admin).toMatchObject({ displayName: 'Fernando', role: 'admin' })
    expect(auth.session.current()).toBeNull()
    await expect(auth.createInitialAdmin({ displayName: 'Outro', pin: '654321' }))
      .rejects.toMatchObject({ code: 'SETUP_COMPLETE' })

    const stored = await getRecord(database, 'users', admin.id)
    expect(stored).not.toHaveProperty('pin')
    expect(stored.pinCredential).toMatchObject({ algorithm: 'PBKDF2', hash: 'SHA-256' })
    expect(stored.pinCredential.derivedKey).not.toBe('001234')
    expect(await auth.isFirstRun()).toBe(false)
  })

  it('impede que duas abas concluam o cadastro inicial simultaneamente', async () => {
    const database = await openTestDatabase()
    const auth = createAuth(database)
    const results = await Promise.allSettled([
      auth.createInitialAdmin({ displayName: 'Admin A', pin: '123456' }),
      auth.createInitialAdmin({ displayName: 'Admin B', pin: '654321' }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await getAllRecords(database, 'users')).toHaveLength(1)
  })

  it('limita o cadastro de operadores a administrador e autentica ambos os papéis', async () => {
    const database = await openTestDatabase()
    const auth = createAuth(database)
    const admin = await auth.createInitialAdmin({ displayName: 'Admin', pin: '123456' })
    await auth.login({ userId: admin.id, pin: '123456' })

    const operator = await auth.createOperator({ displayName: 'Operador', pin: '654321' })
    expect(operator.role).toBe('operator')
    await auth.logout()

    await auth.login({ userId: operator.id, pin: '654321' })
    await expect(auth.createOperator({ displayName: 'Outro', pin: '789012' }))
      .rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    expect(auth.session.current()).toMatchObject({ id: operator.id, role: 'operator' })
  })

  it('lista usuários administrativos sem expor credenciais nem controles de bloqueio', async () => {
    const database = await openTestDatabase()
    const auth = createAuth(database)
    const admin = await auth.createInitialAdmin({ displayName: 'Admin', pin: '123456' })
    await auth.login({ userId: admin.id, pin: '123456' })
    const operator = await auth.createUser({ displayName: 'Operador', pin: '654321' })
    await auth.setUserActive({ userId: operator.id, active: false })

    const users = await auth.listUsers()
    expect(users).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: admin.id, displayName: 'Admin', role: 'admin', status: 'active' }),
      expect.objectContaining({ id: operator.id, displayName: 'Operador', role: 'operator', status: 'inactive' }),
    ]))
    for (const user of users) {
      expect(user).not.toHaveProperty('pinCredential')
      expect(user).not.toHaveProperty('failedPinAttempts')
      expect(user).not.toHaveProperty('lockedUntil')
      expect(user).not.toHaveProperty('pin')
    }
  })

  it('exige autorização administrativa em cada operação de gerenciamento', async () => {
    const database = await openTestDatabase()
    const auth = createAuth(database)
    const admin = await auth.createInitialAdmin({ displayName: 'Admin', pin: '123456' })
    await auth.login({ userId: admin.id, pin: '123456' })
    const operator = await auth.createOperator({ displayName: 'Operador', pin: '654321' })
    await auth.logout()
    await auth.login({ userId: operator.id, pin: '654321' })

    await expect(auth.listUsers()).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    await expect(auth.createUser({ displayName: 'Outro', pin: '234567' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    await expect(auth.createOperator({ displayName: 'Outro', pin: '234567' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    await expect(auth.updateUser({ userId: admin.id, displayName: 'Novo', role: 'admin' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    await expect(auth.resetUserPin({ userId: admin.id, pin: '345678' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    await expect(auth.setUserActive({ userId: admin.id, active: false })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
  })

  it('cria usuário com papel válido e audita sem registrar o PIN', async () => {
    const database = await openTestDatabase()
    const auth = createAuth(database)
    const admin = await auth.createInitialAdmin({ displayName: 'Admin', pin: '123456' })
    await auth.login({ userId: admin.id, pin: '123456' })

    const created = await auth.createUser({ displayName: '  Operador  ', role: 'operator', pin: '654321' })
    const secondAdmin = await auth.createUser({ displayName: 'Admin 2', role: 'admin', pin: '456789' })
    const stored = await getRecord(database, 'users', created.id)
    const audit = (await getAllRecords(database, 'auditLog'))
      .find((entry) => entry.action === 'user.created' && entry.entityId === created.id)
    expect(created).toMatchObject({ displayName: 'Operador', role: 'operator', status: 'active' })
    expect(secondAdmin).toMatchObject({ displayName: 'Admin 2', role: 'admin', status: 'active' })
    expect(stored.pinCredential).toHaveProperty('salt')
    expect(stored.pinCredential).toHaveProperty('derivedKey')
    expect(audit).toMatchObject({ entityId: created.id, actorUserId: admin.id, meta: { displayName: 'Operador', role: 'operator' } })
    expect(JSON.stringify(audit)).not.toContain('654321')
    await expect(auth.createUser({ displayName: 'Invalido', role: 'root', pin: '654321' }))
      .rejects.toMatchObject({ code: 'INVALID_ROLE' })
    await expect(auth.createUser({ displayName: 'Nome', role: 'operator', pin: '123' }))
      .rejects.toMatchObject({ code: 'INVALID_PIN' })
    await expect(auth.createUser({ displayName: '   ', role: 'operator', pin: '123456' }))
      .rejects.toMatchObject({ code: 'INVALID_DISPLAY_NAME' })
  })

  it('edita nome e papel, audita a mudança e protege o último administrador', async () => {
    const database = await openTestDatabase()
    const auth = createAuth(database)
    const admin = await auth.createInitialAdmin({ displayName: 'Admin', pin: '123456' })
    await auth.login({ userId: admin.id, pin: '123456' })
    const operator = await auth.createUser({ displayName: 'Operador', pin: '654321' })
    const originalCredential = (await getRecord(database, 'users', operator.id)).pinCredential

    const updated = await auth.updateUser({ userId: operator.id, displayName: 'Caixa 1', role: 'admin' })
    expect(updated).toMatchObject({ displayName: 'Caixa 1', role: 'admin', status: 'active' })
    expect((await getRecord(database, 'users', operator.id)).pinCredential).toEqual(originalCredential)
    expect(await getAllRecords(database, 'auditLog')).toContainEqual(expect.objectContaining({
      action: 'user.updated', entityId: operator.id, actorUserId: admin.id,
      meta: { previous: { displayName: 'Operador', role: 'operator' }, next: { displayName: 'Caixa 1', role: 'admin' } },
    }))
    await auth.updateUser({ userId: operator.id, displayName: 'Caixa 1', role: 'operator' })
    await expect(auth.updateUser({ userId: admin.id, displayName: 'Admin', role: 'operator' }))
      .rejects.toMatchObject({ code: 'LAST_ADMIN' })
  })

  it('redefine o PIN sem registrá-lo, limpa bloqueios e encerra a sessão correspondente', async () => {
    const database = await openTestDatabase()
    const auth = createAuth(database)
    const admin = await auth.createInitialAdmin({ displayName: 'Admin', pin: '123456' })
    await auth.login({ userId: admin.id, pin: '123456' })
    const operator = await auth.createUser({ displayName: 'Operador', pin: '654321' })
    const oldCredential = (await getRecord(database, 'users', operator.id)).pinCredential
    await putRecord(database, 'users', {
      ...(await getRecord(database, 'users', operator.id)), failedPinAttempts: 4, lockoutLevel: 2, lockedUntil: Date.now() + 30_000,
    })

    const originalInvalidate = auth.session.invalidate
    let invalidated
    auth.session.invalidate = (userId, reason) => { invalidated = { userId, reason } }
    const result = await auth.resetUserPin({ userId: operator.id, pin: '789012' })
    auth.session.invalidate = originalInvalidate
    const stored = await getRecord(database, 'users', operator.id)
    expect(result).not.toHaveProperty('pinCredential')
    expect(stored.pinCredential).not.toEqual(oldCredential)
    expect(stored).toMatchObject({ failedPinAttempts: 0, lockoutLevel: 0, lockedUntil: 0 })
    expect(invalidated).toEqual({ userId: operator.id, reason: 'pin-reset' })
    await expect(auth.login({ userId: operator.id, pin: '654321' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await auth.login({ userId: operator.id, pin: '789012' })
    const resetAudit = (await getAllRecords(database, 'auditLog')).find((entry) => entry.action === 'user.pin-reset')
    expect(resetAudit).toMatchObject({ entityId: operator.id, actorUserId: admin.id })
    expect(JSON.stringify(resetAudit)).not.toContain('789012')
  }, 15_000)

  it('impede auto desativação e desativação do último admin; preserva o histórico ao desativar', async () => {
    const database = await openTestDatabase()
    const auth = createAuth(database)
    const admin = await auth.createInitialAdmin({ displayName: 'Admin', pin: '123456' })
    await auth.login({ userId: admin.id, pin: '123456' })
    const operator = await auth.createUser({ displayName: 'Operador', pin: '654321' })
    await putRecord(database, 'cashSessions', { id: 'cash-history', status: 'closed' })
    await putRecord(database, 'cashMovements', { id: 'movement-history', sessionId: 'cash-history', type: 'opening' })

    await expect(auth.setUserActive({ userId: admin.id, active: false })).rejects.toMatchObject({ code: 'SELF_DEACTIVATION' })
    await auth.setUserActive({ userId: operator.id, active: false })
    expect(await getRecord(database, 'users', operator.id)).toMatchObject({ status: 'inactive' })
    expect(await getRecord(database, 'cashSessions', 'cash-history')).toMatchObject({ status: 'closed' })
    expect(await getRecord(database, 'cashMovements', 'movement-history')).toBeDefined()
    await auth.setUserActive({ userId: operator.id, active: true })
    expect(await getRecord(database, 'users', operator.id)).toMatchObject({ status: 'active' })
  })

  it('revalida a sessão administrativa contra o registro atual do banco', async () => {
    const database = await openTestDatabase()
    const auth = createAuth(database)
    const admin = await auth.createInitialAdmin({ displayName: 'Admin', pin: '123456' })
    await auth.login({ userId: admin.id, pin: '123456' })
    await putRecord(database, 'users', { ...(await getRecord(database, 'users', admin.id)), status: 'inactive' })

    await expect(auth.listUsers()).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    await expect(auth.createUser({ displayName: 'Outro', pin: '234567' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
  })

  it('exclui um usuário autorizado, arquiva só a identidade e preserva histórico e nomes', async () => {
    const database = await openTestDatabase()
    const channelFactory = createChannelFactory()
    const adminSession = createSessionStore({ channelFactory })
    const auth = createAuth(database, { session: adminSession })
    const admin = await auth.createInitialAdmin({ displayName: 'Admin', pin: '123456' })
    await auth.login({ userId: admin.id, pin: '123456' })
    const target = await auth.createUser({ displayName: 'Usuário histórico', pin: '654321' })
    const targetSession = createSessionStore({ channelFactory })
    sessions.add(targetSession)
    targetSession.set({ id: target.id, displayName: target.displayName, role: target.role })

    const cashSession = {
      id: 'cash-history', status: 'closed', openedAt: '2026-10-27T12:00:00.000Z',
      openedByUserId: target.id, closedByUserId: target.id, closedAt: '2026-10-27T13:00:00.000Z',
      expectedAmountMinor: 1000, closingAmountMinor: 1000, differenceMinor: 0,
    }
    const movement = {
      id: 'movement-history', sessionId: cashSession.id, sequence: 1, type: 'opening', cashEffect: 'in',
      amountMinor: 1000, occurredAt: cashSession.openedAt, actorUserId: target.id,
    }
    const historicalAudit = {
      id: 'cash-audit-history', entityType: 'cashSession', entityId: cashSession.id,
      action: 'cash.opened', occurredAt: cashSession.openedAt, actorUserId: target.id,
    }
    await putRecord(database, 'cashSessions', cashSession)
    const cashState = { id: 'current', status: 'closed', lastClosedSessionId: cashSession.id }
    await putRecord(database, 'cashState', cashState)
    await putRecord(database, 'cashMovements', movement)
    await putRecord(database, 'auditLog', historicalAudit)

    const result = await auth.deleteUser({ userId: target.id })

    expect(result).toMatchObject({ id: target.id, displayName: target.displayName, deletedAt: expect.any(String) })
    await expect(getRecord(database, 'users', target.id)).resolves.toBeUndefined()
    const archivedIdentity = await getRecord(database, 'userIdentityArchive', target.id)
    expect(archivedIdentity).toMatchObject({
      id: target.id, displayName: target.displayName, role: 'operator', status: 'active',
      deletedByUserId: admin.id,
    })
    expect(archivedIdentity).not.toHaveProperty('pinCredential')
    await expect(getRecord(database, 'cashSessions', cashSession.id)).resolves.toEqual(cashSession)
    await expect(getRecord(database, 'cashState', cashState.id)).resolves.toEqual(cashState)
    await expect(getRecord(database, 'cashMovements', movement.id)).resolves.toEqual(movement)
    await expect(getRecord(database, 'auditLog', historicalAudit.id)).resolves.toEqual(historicalAudit)
    const deletionAudit = (await getAllRecords(database, 'auditLog'))
      .find((event) => event.action === 'user.deleted' && event.entityId === target.id)
    expect(deletionAudit).toMatchObject({
      entityType: 'user', entityId: target.id, actorUserId: admin.id,
      meta: { displayName: target.displayName, role: 'operator', status: 'active' },
    })
    expect(JSON.stringify(deletionAudit)).not.toMatch(/pinCredential|derivedKey|salt|654321/i)
    expect((await auth.listUsers()).some((user) => user.id === target.id)).toBe(false)
    expect(targetSession.current()).toBeNull()
    expect(adminSession.current()).toMatchObject({ id: admin.id, role: 'admin' })
    await expect(createCashService(database, { session: adminSession }).getOverview())
      .resolves.toMatchObject({
        session: { openedByDisplayName: target.displayName, closedByDisplayName: target.displayName },
        movements: [expect.objectContaining({ actorDisplayName: target.displayName })],
      })
  })

  it('rejeita exclusão feita por operador, autoexclusão e tentativa sem usuário', async () => {
    const database = await openTestDatabase()
    const auth = createAuth(database)
    const admin = await auth.createInitialAdmin({ displayName: 'Admin', pin: '123456' })
    await auth.login({ userId: admin.id, pin: '123456' })
    const operator = await auth.createUser({ displayName: 'Operador', pin: '654321' })

    await expect(auth.deleteUser({ userId: admin.id })).rejects.toMatchObject({ code: 'SELF_DELETION' })
    await expect(auth.deleteUser({ userId: 'missing-user' })).rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
    await auth.logout()
    await auth.login({ userId: operator.id, pin: '654321' })
    await expect(auth.deleteUser({ userId: admin.id })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    await expect(getRecord(database, 'users', admin.id)).resolves.toBeDefined()
  })

  it('aborta exclusão e arquivo de identidade se a auditoria não puder ser gravada', async () => {
    const database = await openTestDatabase()
    const auth = createAuth(database)
    const admin = await auth.createInitialAdmin({ displayName: 'Admin', pin: '123456' })
    await auth.login({ userId: admin.id, pin: '123456' })
    const target = await auth.createUser({ displayName: 'Preservar', pin: '654321' })
    await putRecord(database, 'auditLog', {
      id: 'conflicting-delete-audit', entityType: 'user', entityId: 'other', action: 'test',
    })
    const idSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('conflicting-delete-audit')
    try {
      await expect(auth.deleteUser({ userId: target.id })).rejects.toBeTruthy()
    } finally {
      idSpy.mockRestore()
    }

    await expect(getRecord(database, 'users', target.id)).resolves.toBeDefined()
    await expect(getRecord(database, 'userIdentityArchive', target.id)).resolves.toBeUndefined()
    await expect(getRecord(database, 'auditLog', 'conflicting-delete-audit')).resolves.toMatchObject({ action: 'test' })
    expect((await auth.listUsers()).some((user) => user.id === target.id)).toBe(true)
  })

  it('mantém administrador ativo em exclusões concorrentes entre dois administradores', async () => {
    const database = await openTestDatabase()
    const adminA = { id: 'admin-delete-a', displayName: 'Admin A', role: 'admin', status: 'active' }
    const adminB = { id: 'admin-delete-b', displayName: 'Admin B', role: 'admin', status: 'active' }
    await putRecord(database, 'users', adminA)
    await putRecord(database, 'users', adminB)
    const sessionA = createSessionStore({ channelFactory: () => null })
    const sessionB = createSessionStore({ channelFactory: () => null })
    const authA = createAuth(database, { session: sessionA })
    const authB = createAuth(database, { session: sessionB })
    sessionA.set(adminA)
    sessionB.set(adminB)

    const results = await Promise.allSettled([
      authA.deleteUser({ userId: adminB.id }),
      authB.deleteUser({ userId: adminA.id }),
    ])
    const remainingAdmins = (await getAllRecords(database, 'users'))
      .filter((user) => user.status === 'active' && user.role === 'admin')

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(remainingAdmins).toHaveLength(1)
  })

  it('mantém ao menos um administrador após tentativas concorrentes de rebaixamento', async () => {
    const database = await openTestDatabase()
    const adminA = { id: 'admin-a', displayName: 'Admin A', role: 'admin', status: 'active' }
    const adminB = { id: 'admin-b', displayName: 'Admin B', role: 'admin', status: 'active' }
    await putRecord(database, 'users', adminA)
    await putRecord(database, 'users', adminB)
    const sessionA = createSessionStore({ channelFactory: () => null })
    const sessionB = createSessionStore({ channelFactory: () => null })
    const authA = createAuth(database, { session: sessionA })
    const authB = createAuth(database, { session: sessionB })
    sessionA.set(adminA)
    sessionB.set(adminB)

    const results = await Promise.allSettled([
      authA.updateUser({ userId: adminA.id, displayName: adminA.displayName, role: 'operator' }),
      authB.updateUser({ userId: adminB.id, displayName: adminB.displayName, role: 'operator' }),
    ])
    const finalUsers = await getAllRecords(database, 'users')

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(finalUsers.filter((user) => user.status === 'active' && user.role === 'admin')).toHaveLength(1)
  })

  it('persiste tentativas e bloqueio progressivo mesmo após recriar o serviço', async () => {
    const database = await openTestDatabase()
    let clock = Date.now()
    const now = () => clock
    const auth = createAuth(database, { now })
    const admin = await auth.createInitialAdmin({ displayName: 'Admin', pin: '123456' })

    for (let attempt = 1; attempt < 5; attempt += 1) {
      await expect(auth.login({ userId: admin.id, pin: '000000' }))
        .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    }
    const fifthAttempt = auth.login({ userId: admin.id, pin: '000000' })
    await expect(fifthAttempt).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
      retryAfterSeconds: 30,
    })

    const stored = await getRecord(database, 'users', admin.id)
    expect(stored.lockedUntil).toBe(clock + 30_000)
    expect(stored.lockoutLevel).toBe(1)
    const lockEvent = (await getAllRecords(database, 'auditLog'))
      .find((entry) => entry.action === 'authentication.locked')
    expect(lockEvent).not.toHaveProperty('actorUserId')

    const afterReload = createAuth(database, { now })
    await expect(afterReload.login({ userId: admin.id, pin: '123456' }))
      .rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' })

    clock += 30_001
    for (let attempt = 1; attempt < 5; attempt += 1) {
      await expect(afterReload.login({ userId: admin.id, pin: '000000' }))
        .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    }
    await expect(afterReload.login({ userId: admin.id, pin: '000000' }))
      .rejects.toMatchObject({ code: 'ACCOUNT_LOCKED', retryAfterSeconds: 60 })

    clock += 60_001
    const beforeCappedLock = await getRecord(database, 'users', admin.id)
    await putRecord(database, 'users', {
      ...beforeCappedLock,
      failedPinAttempts: 4,
      lockoutLevel: 10,
      lockedUntil: 0,
    })
    await expect(afterReload.login({ userId: admin.id, pin: '000000' }))
      .rejects.toMatchObject({ code: 'ACCOUNT_LOCKED', retryAfterSeconds: 900 })

    clock += 900_001
    await afterReload.login({ userId: admin.id, pin: '123456' })
    const unlocked = await getRecord(database, 'users', admin.id)
    expect(unlocked).toMatchObject({ failedPinAttempts: 0, lockoutLevel: 0, lockedUntil: 0 })
  }, 15_000)

  it('logout e inatividade limpam a sessão em memória sem fechar caixa aberto', async () => {
    const database = await openTestDatabase()
    let clock = Date.now()
    const now = () => clock
    const session = createSessionStore({ now })
    const auth = createAuth(database, { session, now })
    const admin = await auth.createInitialAdmin({ displayName: 'Admin', pin: '123456' })
    await putRecord(database, 'cashSessions', { id: 'cash-1', status: 'open', openedAt: '2026-10-27T12:00:00.000Z' })
    await putRecord(database, 'cashState', { id: 'current', status: 'open', currentSessionId: 'cash-1' })
    await auth.login({ userId: admin.id, pin: '123456' })

    await auth.logout()
    expect(auth.session.current()).toBeNull()
    await expect(getRecord(database, 'cashSessions', 'cash-1')).resolves.toMatchObject({ status: 'open' })

    await auth.login({ userId: admin.id, pin: '123456' })
    clock += 5 * 60 * 1000
    expect(auth.session.current()).toBeNull()
    await expect(getRecord(database, 'cashState', 'current')).resolves.toMatchObject({ status: 'open' })
    expect((await getAllRecords(database, 'auditLog')).map((entry) => entry.action))
      .toContain('authentication.idle-timeout')
  })
})
