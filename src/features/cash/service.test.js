import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../core/persistence/database.js'
import { getAllRecords, getRecord, putRecord } from '../../core/persistence/records.js'
import { createSessionStore } from '../authentication/session.js'
import { createCashService, toMinorUnits } from './service.js'

const databases = new Set()
const sessions = new Set()
let nextId = 0

async function fixture({ role = 'admin', idleTimeoutMs } = {}) {
  const databaseName = `cash-${crypto.randomUUID()}`
  const database = await openDatabase({ name: databaseName })
  databases.add(database)
  const user = { id: 'user-1', displayName: 'Operador', role, status: 'active' }
  await putRecord(database, 'users', user)
  const session = createSessionStore({
    idleTimeoutMs,
    channelFactory: () => null,
  })
  sessions.add(session)
  session.set(user)
  const service = createCashService(database, {
    session,
    idFactory: () => `record-${++nextId}`,
  })
  return { database, databaseName, service, session, user }
}

afterEach(() => {
  for (const session of sessions) session.logout()
  sessions.clear()
  for (const database of databases) database.close()
  databases.clear()
})

describe('sessão de caixa', () => {
  it('converte valores para centavos com validação segura', () => {
    expect(toMinorUnits('0')).toBe(0)
    expect(toMinorUnits('12.3')).toBe(1230)
    expect(toMinorUnits(12.34)).toBe(1234)
    for (const value of ['-1', '1.001', 'abc', '1e2', '']) {
      expect(() => toMinorUnits(value)).toThrow()
    }
    for (const value of [NaN, Infinity, -1]) expect(() => toMinorUnits(value)).toThrow()
  })

  it('abre com sessão, estado, movimento e auditoria associados ao usuário', async () => {
    const { database, service, user } = await fixture({ role: 'operator' })
    const opened = await service.openCash('120.50')

    expect(opened).toMatchObject({ status: 'open', openedByUserId: user.id, openingAmountMinor: 12050 })
    expect(await getRecord(database, 'cashState', 'current')).toMatchObject({ status: 'open', currentSessionId: opened.id })
    expect(await getAllRecords(database, 'cashMovements')).toContainEqual(expect.objectContaining({
      type: 'opening', cashEffect: 'in', amountMinor: 12050, actorUserId: user.id,
    }))
    expect(await getAllRecords(database, 'auditLog')).toContainEqual(expect.objectContaining({
      entityId: opened.id, action: 'cash.opened', actorUserId: user.id,
    }))
  })

  it('rejeita valores inválidos e uma segunda abertura', async () => {
    const { service } = await fixture()
    for (const value of ['-0.01', '1.234', 'abc', Infinity]) {
      await expect(service.openCash(value)).rejects.toMatchObject({ code: 'INVALID_AMOUNT' })
    }
    await service.openCash('0')
    await expect(service.openCash('1')).rejects.toMatchObject({ code: 'CASH_ALREADY_OPEN' })
  })

  it('registra entrada e saída com motivo, responsável, auditoria e totais atualizados', async () => {
    const { database, service, user } = await fixture()
    const opened = await service.openCash('50.00')
    const entry = await service.recordMovement({
      type: 'cash-in', amount: '20.25', reason: 'Reforço de troco', idempotencyKey: 'request-entry-1',
    })
    const exit = await service.recordMovement({
      type: 'cash-out', amount: '5.10', reason: 'Retirada para cofre', idempotencyKey: 'request-exit-1',
    })
    const overview = await service.getOverview()

    expect(entry).toMatchObject({ sessionId: opened.id, sequence: 2, cashEffect: 'in', amountMinor: 2025, reason: 'Reforço de troco', actorUserId: user.id })
    expect(exit).toMatchObject({ sessionId: opened.id, sequence: 3, cashEffect: 'out', amountMinor: 510, reason: 'Retirada para cofre', actorUserId: user.id })
    expect(overview.totals).toMatchObject({ incomingMinor: 7025, outgoingMinor: 510, expectedMinor: 6515 })
    expect(await getAllRecords(database, 'auditLog')).toContainEqual(expect.objectContaining({
      entityType: 'cashMovement', entityId: entry.id, action: 'cash.cash-in', actorUserId: user.id,
      meta: expect.objectContaining({ reason: 'Reforço de troco' }),
    }))
  })

  it('rejeita valor zero, valor inválido e motivo ausente', async () => {
    const { service } = await fixture()
    await service.openCash('10')
    for (const amount of ['0', '-1', 'x', '1.001', Number.MAX_SAFE_INTEGER]) {
      await expect(service.recordMovement({ type: 'cash-in', amount, reason: 'Teste', idempotencyKey: `invalid-${String(amount)}` }))
        .rejects.toMatchObject({ code: 'INVALID_AMOUNT' })
    }
    for (const reason of ['', '   ', null, 'x'.repeat(201)]) {
      await expect(service.recordMovement({ type: 'cash-in', amount: '1', reason, idempotencyKey: `reason-${String(reason).length}` }))
        .rejects.toMatchObject({ code: 'INVALID_REASON' })
    }
  })

  it('exige usuário autenticado, caixa aberto e recusa sessão encerrada', async () => {
    const { service, session } = await fixture()
    await expect(service.recordMovement({ type: 'cash-in', amount: '1', reason: 'Teste', idempotencyKey: 'no-cash' }))
      .rejects.toMatchObject({ code: 'NO_OPEN_CASH' })
    await service.openCash('10')
    await service.closeCash('10')
    await expect(service.recordMovement({ type: 'cash-in', amount: '1', reason: 'Teste', idempotencyKey: 'closed-cash' }))
      .rejects.toMatchObject({ code: 'NO_OPEN_CASH' })
    session.logout()
    await expect(service.recordMovement({ type: 'cash-in', amount: '1', reason: 'Teste', idempotencyKey: 'logged-out' }))
      .rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' })
  })

  it('recusa uma saída acima do saldo disponível sem gravar movimento', async () => {
    const { database, service } = await fixture()
    await service.openCash('10')
    await expect(service.recordMovement({
      type: 'cash-out', amount: '10.01', reason: 'Retirada excessiva', idempotencyKey: 'overdraw',
    })).rejects.toMatchObject({ code: 'INSUFFICIENT_CASH' })
    expect((await getAllRecords(database, 'cashMovements')).filter((movement) => movement.type === 'cash-out')).toHaveLength(0)
    expect((await service.getOverview()).totals.expectedMinor).toBe(1000)
  })

  it('trata repetição da mesma chave como a mesma solicitação e recusa conteúdo diferente', async () => {
    const { database, service } = await fixture()
    await service.openCash('20')
    const request = { type: 'cash-in', amount: '2.50', reason: 'Troco', idempotencyKey: 'stable-request' }
    const first = await service.recordMovement(request)
    const repeated = await service.recordMovement(request)
    expect(repeated.id).toBe(first.id)
    expect(await getAllRecords(database, 'cashMovements')).toHaveLength(2)
    expect(await getAllRecords(database, 'auditLog')).toHaveLength(2)
    await expect(service.recordMovement({ ...request, amount: '3.00' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('não duplica uma solicitação idempotente enviada simultaneamente', async () => {
    const { database, service } = await fixture()
    await service.openCash('20')
    const request = { type: 'cash-in', amount: '2.50', reason: 'Troco', idempotencyKey: 'parallel-request' }
    const [first, second] = await Promise.all([
      service.recordMovement(request),
      service.recordMovement(request),
    ])
    expect(first.id).toBe(second.id)
    expect((await getAllRecords(database, 'cashMovements')).filter((item) => item.type === 'cash-in')).toHaveLength(1)
    expect((await getAllRecords(database, 'auditLog')).filter((item) => item.action === 'cash.cash-in')).toHaveLength(1)
  })

  it('serializa saídas concorrentes para impedir saldo negativo', async () => {
    const { service } = await fixture()
    await service.openCash('10')
    const results = await Promise.allSettled([
      service.recordMovement({ type: 'cash-out', amount: '6', reason: 'Retirada A', idempotencyKey: 'parallel-out-a' }),
      service.recordMovement({ type: 'cash-out', amount: '6', reason: 'Retirada B', idempotencyKey: 'parallel-out-b' }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected'))
      .toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected').reason)
      .toMatchObject({ code: 'INSUFFICIENT_CASH' })
    expect((await service.getOverview()).totals.expectedMinor).toBe(400)
  })

  it('aborta movimento e auditoria juntos se a gravação de auditoria falhar', async () => {
    const { database, session } = await fixture()
    const opener = createCashService(database, { session, idFactory: () => `open-${++nextId}` })
    await opener.openCash('10')
    await putRecord(database, 'auditLog', {
      id: 'conflicting-movement-audit', entityType: 'other', entityId: 'other', action: 'test',
      occurredAt: new Date().toISOString(),
    })
    let call = 0
    const service = createCashService(database, {
      session, idFactory: () => ['manual-movement', 'conflicting-movement-audit'][call++],
    })
    await expect(service.recordMovement({
      type: 'cash-in', amount: '2', reason: 'Falha simulada', idempotencyKey: 'rollback-request',
    })).rejects.toBeTruthy()
    expect(await getRecord(database, 'cashMovements', 'manual-movement')).toBeUndefined()
    expect(await getAllRecords(database, 'cashMovements')).toHaveLength(1)
    expect(await getAllRecords(database, 'auditLog')).toHaveLength(2)
  })

  it('mantém o histórico em ordem, com motivo e identidade legíveis', async () => {
    let time = Date.parse('2026-01-01T10:00:00.000Z')
    const { database, session } = await fixture()
    const service = createCashService(database, { session, now: () => time++, idFactory: () => `history-${++nextId}` })
    await service.openCash('5')
    await service.recordMovement({ type: 'cash-in', amount: '2', reason: 'Entrada A', idempotencyKey: 'history-a' })
    await service.recordMovement({ type: 'cash-out', amount: '1', reason: 'Saída B', idempotencyKey: 'history-b' })
    const { movements } = await service.getOverview()
    expect(movements.map(({ sequence, reason, actorDisplayName }) => ({ sequence, reason, actorDisplayName }))).toEqual([
      { sequence: 1, reason: undefined, actorDisplayName: 'Operador' },
      { sequence: 2, reason: 'Entrada A', actorDisplayName: 'Operador' },
      { sequence: 3, reason: 'Saída B', actorDisplayName: 'Operador' },
    ])
    expect(movements[0].occurredAt < movements[1].occurredAt).toBe(true)
  })

  it('impede duas aberturas concorrentes em transações distintas', async () => {
    const { database, session } = await fixture()
    const first = createCashService(database, { session, idFactory: () => `a-${++nextId}` })
    const second = createCashService(database, { session, idFactory: () => `b-${++nextId}` })
    const results = await Promise.allSettled([first.openCash('10'), second.openCash('20')])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await getAllRecords(database, 'cashSessions')).toHaveLength(1)
    expect(await getAllRecords(database, 'cashMovements')).toHaveLength(1)
  })

  it('fecha com valor esperado e diferença, registrando o usuário que fechou', async () => {
    const { database, service, user } = await fixture()
    const opened = await service.openCash('100.00')
    const closed = await service.closeCash('97.25')

    expect(closed).toMatchObject({ sessionId: opened.id, expectedAmountMinor: 10000, closingAmountMinor: 9725, differenceMinor: -275 })
    expect(await getRecord(database, 'cashSessions', opened.id)).toMatchObject({
      status: 'closed', closedByUserId: user.id, expectedAmountMinor: 10000,
      closingAmountMinor: 9725, differenceMinor: -275,
    })
    expect(await getRecord(database, 'cashState', 'current')).toMatchObject({ status: 'closed', currentSessionId: null })
    expect(await getAllRecords(database, 'cashMovements')).toContainEqual(expect.objectContaining({
      sessionId: opened.id, type: 'closing-count', cashEffect: 'none', amountMinor: 9725, actorUserId: user.id,
    }))
    expect(await getAllRecords(database, 'auditLog')).toContainEqual(expect.objectContaining({
      entityId: opened.id, action: 'cash.closed', actorUserId: user.id,
      meta: { expectedAmountMinor: 10000, closingAmountMinor: 9725, differenceMinor: -275 },
    }))
  })

  it('inclui entradas e saídas aplicáveis no saldo esperado e permite fechar por outro usuário', async () => {
    const { database, service, session } = await fixture({ role: 'operator' })
    const opened = await service.openCash('100.00')
    await putRecord(database, 'cashMovements', {
      id: 'cash-in-test', sessionId: opened.id, type: 'cash-in', cashEffect: 'in',
      amountMinor: 2500, occurredAt: new Date().toISOString(), actorUserId: 'user-1',
    })
    await putRecord(database, 'cashMovements', {
      id: 'cash-out-test', sessionId: opened.id, type: 'cash-out', cashEffect: 'out',
      amountMinor: 700, occurredAt: new Date().toISOString(), actorUserId: 'user-1',
    })
    await putRecord(database, 'users', { id: 'admin-2', displayName: 'Admin', role: 'admin', status: 'active' })
    session.set({ id: 'admin-2', displayName: 'Admin', role: 'admin' })
    const closingService = createCashService(database, { session, idFactory: () => `second-${++nextId}` })
    const result = await closingService.closeCash('120.00')
    expect(result).toMatchObject({ expectedAmountMinor: 11800, closingAmountMinor: 12000, differenceMinor: 200 })
    expect(await getRecord(database, 'cashSessions', opened.id)).toMatchObject({ closedByUserId: 'admin-2' })
  })

  it('não fecha sem caixa aberto nem permite fechamento duplicado', async () => {
    const { service } = await fixture()
    await expect(service.closeCash('0')).rejects.toMatchObject({ code: 'NO_OPEN_CASH' })
    await service.openCash('10')
    await service.closeCash('10')
    await expect(service.closeCash('10')).rejects.toMatchObject({ code: 'NO_OPEN_CASH' })
  })

  it('aborta integralmente a abertura quando um registro conflita', async () => {
    const { database, session } = await fixture()
    await putRecord(database, 'cashMovements', {
      id: 'conflicting-movement', sessionId: 'other', type: 'opening', cashEffect: 'in', amountMinor: 1,
      occurredAt: new Date().toISOString(), actorUserId: 'user-1',
    })
    let call = 0
    const service = createCashService(database, { session, idFactory: () => ['session-fail', 'conflicting-movement', 'audit-fail'][call++] })
    await expect(service.openCash('2')).rejects.toBeTruthy()
    expect(await getRecord(database, 'cashSessions', 'session-fail')).toBeUndefined()
    expect(await getRecord(database, 'cashState', 'current')).toBeUndefined()
    expect(await getAllRecords(database, 'auditLog')).toHaveLength(0)
  })

  it('aborta integralmente o fechamento quando a auditoria conflita', async () => {
    const { database, session } = await fixture()
    const service = createCashService(database, { session, idFactory: () => `opening-${++nextId}` })
    const opened = await service.openCash('10')
    await putRecord(database, 'auditLog', {
      id: 'conflicting-close-audit', entityType: 'other', entityId: 'other', action: 'test',
      occurredAt: new Date().toISOString(),
    })
    const closingService = createCashService(database, {
      session,
      idFactory: (() => { let call = 0; return () => ['closing-movement', 'conflicting-close-audit'][call++] })(),
    })
    await expect(closingService.closeCash('9')).rejects.toBeTruthy()
    expect(await getRecord(database, 'cashSessions', opened.id)).toMatchObject({ status: 'open' })
    expect(await getRecord(database, 'cashState', 'current')).toMatchObject({ status: 'open', currentSessionId: opened.id })
    expect(await getRecord(database, 'cashMovements', 'closing-movement')).toBeUndefined()
  })

  it('mantém os dados após fechar e reabrir a conexão com o banco', async () => {
    const fixtureData = await fixture()
    const opened = await fixtureData.service.openCash('10.01')
    fixtureData.database.close()
    databases.delete(fixtureData.database)
    const reopened = await openDatabase({ name: fixtureData.databaseName })
    databases.add(reopened)
    const service = createCashService(reopened, { session: fixtureData.session })
    expect(await service.getOverview()).toMatchObject({
      status: 'open', session: { id: opened.id, openingAmountMinor: 1001, openedByDisplayName: 'Operador' },
      movements: [expect.objectContaining({ type: 'opening', amountMinor: 1001 })],
    })
  })

  it('mantém o caixa aberto após logout ou expiração por inatividade', async () => {
    let now = 0
    const { database, service, session } = await fixture()
    await service.openCash('10')
    session.logout()
    expect((await service.getOverview()).status).toBe('open')
    const timedSession = createSessionStore({ idleTimeoutMs: 1000, now: () => now, channelFactory: () => null })
    sessions.add(timedSession)
    timedSession.set({ id: 'user-1', displayName: 'Operador', role: 'admin' })
    const timedService = createCashService(database, { session: timedSession })
    now = 1000
    expect(timedSession.current()).toBeNull()
    expect((await timedService.getOverview()).status).toBe('open')
  })

  it('exige sessão autenticada e usuário ativo para operar', async () => {
    const { database, service, session, user } = await fixture()
    session.logout()
    await expect(service.openCash('10')).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' })
    session.set(user)
    await putRecord(database, 'users', { ...user, status: 'inactive' })
    await expect(service.openCash('10')).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' })
  })
})
