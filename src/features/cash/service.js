import { runTransaction } from '../../core/persistence/transactions.js'

const CURRENT_STATE_ID = 'current'

export class CashError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CashError'
    this.code = code
  }
}

function cashError(code, message) {
  return new CashError(code, message)
}

function makeId() {
  if (!globalThis.crypto?.randomUUID) throw cashError('ID_UNAVAILABLE', 'Não foi possível gerar um identificador seguro.')
  return globalThis.crypto.randomUUID()
}

export function toMinorUnits(value) {
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
    throw cashError('INVALID_AMOUNT', 'Informe um valor não negativo com até duas casas decimais.')
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw cashError('INVALID_AMOUNT', 'Informe um valor não negativo com até duas casas decimais.')
  }
  const source = String(value).trim()
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(source)
  if (!match) throw cashError('INVALID_AMOUNT', 'Informe um valor não negativo com até duas casas decimais.')
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw cashError('INVALID_AMOUNT', 'O valor informado é grande demais.')
  return Number(minor)
}

function readRequest(request, onSuccess) {
  request.onsuccess = () => onSuccess(request.result)
  request.onerror = () => {}
}

function actorInTransaction(transaction, controls, actor, session) {
  if (!actor || session.current()?.id !== actor.id) {
    controls.abort(cashError('NOT_AUTHENTICATED', 'Entre novamente para operar o caixa.'))
    return false
  }
  const request = transaction.objectStore('users').get(actor.id)
  return request
}

function validateActor(record, actor, session, controls) {
  if (session.current()?.id !== actor.id || record?.status !== 'active' ||
      !['admin', 'operator'].includes(record.role) || record.role !== actor.role) {
    controls.abort(cashError('NOT_AUTHENTICATED', 'A sessão do usuário não está mais ativa.'))
    return false
  }
  return true
}

function orderedMovements(movements) {
  return [...movements]
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id))
    .map((movement, index) => ({ movement, sequence: Number.isSafeInteger(movement.sequence) ? movement.sequence : index + 1 }))
    .sort((left, right) => left.sequence - right.sequence ||
      left.movement.occurredAt.localeCompare(right.movement.occurredAt) ||
      left.movement.id.localeCompare(right.movement.id))
    .map(({ movement }) => movement)
}

function calculateTotals(movements) {
  let incoming = 0n
  let outgoing = 0n
  let balance = 0n
  for (const movement of orderedMovements(movements)) {
    if (!Number.isSafeInteger(movement.amountMinor) || movement.amountMinor < 0) {
      throw cashError('INVALID_MOVEMENT', 'Há um movimento de caixa inválido; o fechamento foi interrompido.')
    }
    if (movement.cashEffect === 'in') {
      incoming += BigInt(movement.amountMinor)
      balance += BigInt(movement.amountMinor)
    } else if (movement.cashEffect === 'out') {
      outgoing += BigInt(movement.amountMinor)
      balance -= BigInt(movement.amountMinor)
      if (balance < 0n) throw cashError('INVALID_MOVEMENT', 'O histórico contém uma saída maior que o saldo disponível.')
    }
    else if (movement.cashEffect !== 'none') {
      throw cashError('INVALID_MOVEMENT', 'Há um movimento sem efeito de caixa definido; o fechamento foi interrompido.')
    }
  }
  const expected = incoming - outgoing
  const maximum = BigInt(Number.MAX_SAFE_INTEGER)
  if (incoming > maximum || outgoing > maximum || expected < 0n || expected > maximum) {
    throw cashError('INVALID_MOVEMENT', 'O total esperado está fora do limite seguro.')
  }
  return { incomingMinor: Number(incoming), outgoingMinor: Number(outgoing), expectedMinor: Number(expected) }
}

function nextMovementSequence(movements) {
  const largest = movements.reduce((max, movement, index) => Math.max(max,
    Number.isSafeInteger(movement.sequence) ? movement.sequence : index + 1), 0)
  if (largest >= Number.MAX_SAFE_INTEGER) throw cashError('INVALID_MOVEMENT', 'O limite de sequência desta sessão foi atingido.')
  return largest + 1
}

export function createCashService(database, {
  session,
  now = () => Date.now(),
  idFactory = makeId,
} = {}) {
  function requireActor() {
    const actor = session?.current()
    if (!actor) throw cashError('NOT_AUTHENTICATED', 'Entre para operar o caixa.')
    return actor
  }

  async function openCash(amount) {
    const openingAmountMinor = toMinorUnits(amount)
    const actor = requireActor()
    const timestamp = now()
    const occurredAt = new Date(timestamp).toISOString()
    const cashSession = {
      id: idFactory(), status: 'open', openedAt: occurredAt,
      openedByUserId: actor.id, openingAmountMinor,
    }
    const openingMovement = {
      id: idFactory(), sessionId: cashSession.id, sequence: 1, type: 'opening', cashEffect: 'in',
      amountMinor: openingAmountMinor, occurredAt, actorUserId: actor.id,
    }
    const audit = {
      id: idFactory(), entityType: 'cashSession', entityId: cashSession.id,
      action: 'cash.opened', occurredAt, actorUserId: actor.id,
      meta: { openingAmountMinor },
    }

    await runTransaction(database,
      ['users', 'cashSessions', 'cashState', 'cashMovements', 'auditLog'],
      'readwrite', (transaction, controls) => {
        const userRequest = actorInTransaction(transaction, controls, actor, session)
        if (!userRequest) return
        readRequest(userRequest, (user) => {
          if (!validateActor(user, actor, session, controls)) return
          const sessionsRequest = transaction.objectStore('cashSessions').index('by-status').getAll('open')
          const stateRequest = transaction.objectStore('cashState').get(CURRENT_STATE_ID)
          let pending = 2
          let openedSessions
          let state
          const finish = () => {
            if (--pending !== 0) return
            if (openedSessions.length || state?.status === 'open' || state?.currentSessionId) {
              controls.abort(cashError('CASH_ALREADY_OPEN', 'Já existe uma sessão de caixa aberta.'))
              return
            }
            if (state && state.status !== 'closed') {
              controls.abort(cashError('CASH_STATE_INCONSISTENT', 'O estado atual do caixa precisa ser verificado antes de abrir.'))
              return
            }
            transaction.objectStore('cashSessions').add(cashSession)
            transaction.objectStore('cashState').put({
              id: CURRENT_STATE_ID, status: 'open', currentSessionId: cashSession.id, updatedAt: occurredAt,
            })
            transaction.objectStore('cashMovements').add(openingMovement)
            transaction.objectStore('auditLog').add(audit)
            controls.setResult(cashSession)
          }
          readRequest(sessionsRequest, (value) => { openedSessions = value; finish() })
          readRequest(stateRequest, (value) => { state = value; finish() })
        })
      })
    return cashSession
  }

  async function recordMovement({ type, amount, reason, idempotencyKey }) {
    if (!['cash-in', 'cash-out'].includes(type)) {
      throw cashError('INVALID_MOVEMENT_TYPE', 'Escolha entrada ou saída de dinheiro.')
    }
    const amountMinor = toMinorUnits(amount)
    if (amountMinor <= 0) throw cashError('INVALID_AMOUNT', 'O valor da movimentação deve ser maior que zero.')
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 200) {
      throw cashError('INVALID_REASON', 'Informe um motivo com até 200 caracteres.')
    }
    const description = reason.trim()
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.trim().length > 128) {
      throw cashError('INVALID_IDEMPOTENCY_KEY', 'A solicitação precisa de uma chave de identificação válida.')
    }
    const requestKey = idempotencyKey.trim()
    const actor = requireActor()
    const timestamp = now()
    const occurredAt = new Date(timestamp).toISOString()
    const cashEffect = type === 'cash-in' ? 'in' : 'out'

    return runTransaction(database,
      ['users', 'cashSessions', 'cashState', 'cashMovements', 'auditLog'],
      'readwrite', (transaction, controls) => {
        const userRequest = actorInTransaction(transaction, controls, actor, session)
        if (!userRequest) return
        readRequest(userRequest, (user) => {
          if (!validateActor(user, actor, session, controls)) return
          const stateRequest = transaction.objectStore('cashState').get(CURRENT_STATE_ID)
          const sessionsRequest = transaction.objectStore('cashSessions').index('by-status').getAll('open')
          let pending = 2
          let state
          let openedSessions
          const continueWithSession = () => {
            if (--pending !== 0) return
            if (state?.status !== 'open' || !state.currentSessionId || openedSessions.length !== 1 ||
                openedSessions[0].id !== state.currentSessionId) {
              controls.abort(cashError('NO_OPEN_CASH', 'Abra um caixa antes de registrar uma movimentação.'))
              return
            }
            const currentSession = openedSessions[0]
            const movementsStore = transaction.objectStore('cashMovements')
            const duplicateRequest = movementsStore.index('by-idempotency-key').get(requestKey)
            const recordsRequest = movementsStore.index('by-session-id').getAll(currentSession.id)
            let pendingRecords = 2
            let existing
            let movements
            const finishMovement = () => {
              if (--pendingRecords !== 0) return
              if (existing) {
                if (existing.sessionId === currentSession.id && existing.type === type &&
                    existing.amountMinor === amountMinor && existing.reason === description &&
                    existing.actorUserId === actor.id) {
                  controls.setResult(existing)
                } else {
                  controls.abort(cashError('IDEMPOTENCY_CONFLICT', 'Essa chave já foi usada por outra movimentação.'))
                }
                return
              }
              let totals
              try { totals = calculateTotals(movements) } catch (error) { controls.abort(error); return }
              const delta = BigInt(amountMinor) * (cashEffect === 'in' ? 1n : -1n)
              const nextBalance = BigInt(totals.expectedMinor) + delta
              if (nextBalance < 0n) {
                controls.abort(cashError('INSUFFICIENT_CASH', 'A saída excede o dinheiro disponível no caixa.'))
                return
              }
              if (nextBalance > BigInt(Number.MAX_SAFE_INTEGER)) {
                controls.abort(cashError('INVALID_AMOUNT', 'Essa movimentação ultrapassa o limite monetário seguro.'))
                return
              }
              const openings = movements.filter((movement) => movement.type === 'opening' && movement.cashEffect === 'in')
              if (openings.length !== 1 || openings[0].amountMinor !== currentSession.openingAmountMinor) {
                controls.abort(cashError('CASH_STATE_INCONSISTENT', 'O movimento de abertura não confere com a sessão.'))
                return
              }
              let sequence
              try { sequence = nextMovementSequence(movements) } catch (error) { controls.abort(error); return }
              const movement = {
                id: idFactory(), sessionId: currentSession.id, sequence, type, cashEffect,
                amountMinor, reason: description, occurredAt, actorUserId: actor.id,
                idempotencyKey: requestKey,
              }
              const audit = {
                id: idFactory(), entityType: 'cashMovement', entityId: movement.id,
                action: `cash.${type}`, occurredAt, actorUserId: actor.id,
                meta: { sessionId: currentSession.id, amountMinor, reason: description, idempotencyKey: requestKey },
              }
              movementsStore.add(movement)
              transaction.objectStore('auditLog').add(audit)
              controls.setResult(movement)
            }
            readRequest(duplicateRequest, (value) => { existing = value; finishMovement() })
            readRequest(recordsRequest, (value) => { movements = value; finishMovement() })
          }
          readRequest(stateRequest, (value) => { state = value; continueWithSession() })
          readRequest(sessionsRequest, (value) => { openedSessions = value; continueWithSession() })
        })
      })
  }

  async function closeCash(countedAmount) {
    const closingAmountMinor = toMinorUnits(countedAmount)
    const actor = requireActor()
    const timestamp = now()
    const occurredAt = new Date(timestamp).toISOString()

    const result = await runTransaction(database,
      ['users', 'cashSessions', 'cashState', 'cashMovements', 'auditLog'],
      'readwrite', (transaction, controls) => {
        const userRequest = actorInTransaction(transaction, controls, actor, session)
        if (!userRequest) return
        readRequest(userRequest, (user) => {
          if (!validateActor(user, actor, session, controls)) return
          const stateRequest = transaction.objectStore('cashState').get(CURRENT_STATE_ID)
          const openSessionsRequest = transaction.objectStore('cashSessions').index('by-status').getAll('open')
          let pending = 2
          let state
          let openSessions
          const finish = () => {
            if (--pending !== 0) return
            if (state?.status !== 'open' || !state.currentSessionId || openSessions.length !== 1 ||
                openSessions[0].id !== state.currentSessionId) {
              controls.abort(cashError('NO_OPEN_CASH', 'Não há uma sessão de caixa aberta e consistente para fechar.'))
              return
            }
            const cashSession = openSessions[0]
            const movementsRequest = transaction.objectStore('cashMovements').index('by-session-id').getAll(cashSession.id)
            readRequest(movementsRequest, (movements) => {
              let totals
              try {
                totals = calculateTotals(movements)
              } catch (error) {
                controls.abort(error)
                return
              }
              const openings = movements.filter((movement) => movement.type === 'opening' && movement.cashEffect === 'in')
              if (openings.length !== 1 || openings[0].amountMinor !== cashSession.openingAmountMinor) {
                controls.abort(cashError('CASH_STATE_INCONSISTENT', 'O movimento de abertura não confere com a sessão.'))
                return
              }
              const differenceMinor = closingAmountMinor - totals.expectedMinor
              let closingSequence
              try { closingSequence = nextMovementSequence(movements) } catch (error) { controls.abort(error); return }
              const closingMovement = {
                id: idFactory(), sessionId: cashSession.id, sequence: closingSequence,
                type: 'closing-count', cashEffect: 'none',
                amountMinor: closingAmountMinor, occurredAt, actorUserId: actor.id,
              }
              const audit = {
                id: idFactory(), entityType: 'cashSession', entityId: cashSession.id,
                action: 'cash.closed', occurredAt, actorUserId: actor.id,
                meta: {
                  expectedAmountMinor: totals.expectedMinor,
                  closingAmountMinor,
                  differenceMinor,
                },
              }
              transaction.objectStore('cashSessions').put({
                ...cashSession, status: 'closed', closedAt: occurredAt,
                closedByUserId: actor.id, expectedAmountMinor: totals.expectedMinor,
                closingAmountMinor, differenceMinor,
              })
              transaction.objectStore('cashState').put({
                id: CURRENT_STATE_ID, status: 'closed', currentSessionId: null,
                lastClosedSessionId: cashSession.id, updatedAt: occurredAt,
              })
              transaction.objectStore('cashMovements').add(closingMovement)
              transaction.objectStore('auditLog').add(audit)
              controls.setResult({
                sessionId: cashSession.id, expectedAmountMinor: totals.expectedMinor,
                closingAmountMinor, differenceMinor,
              })
            })
          }
          readRequest(stateRequest, (value) => { state = value; finish() })
          readRequest(openSessionsRequest, (value) => { openSessions = value; finish() })
        })
      })
    return result
  }

  async function getOverview() {
    return runTransaction(database, ['users', 'userIdentityArchive', 'cashSessions', 'cashState', 'cashMovements'], 'readonly', (transaction, controls) => {
      const stateRequest = transaction.objectStore('cashState').get(CURRENT_STATE_ID)
      const openRequest = transaction.objectStore('cashSessions').index('by-status').getAll('open')
      const usersRequest = transaction.objectStore('users').getAll()
      const archivedUsersRequest = transaction.objectStore('userIdentityArchive').getAll()
      let state
      let openSessions
      let users
      let archivedUsers
      let pending = 4
      const finish = () => {
        if (--pending !== 0) return
        if ((state?.status === 'open' && (openSessions.length !== 1 || openSessions[0].id !== state.currentSessionId)) ||
            (state?.status !== 'open' && openSessions.length)) {
          controls.abort(cashError('CASH_STATE_INCONSISTENT', 'O estado atual do caixa precisa ser verificado.'))
          return
        }
        const current = state?.status === 'open' ? openSessions[0] : null
        const closedId = state?.lastClosedSessionId
        const sessionRecord = current ?? null
        const sessionRequest = !sessionRecord && closedId
          ? transaction.objectStore('cashSessions').get(closedId)
          : null
        const movementsFor = (record) => {
          if (!record) { controls.setResult({ status: 'closed', session: null, movements: [], totals: null }); return }
          const request = transaction.objectStore('cashMovements').index('by-session-id').getAll(record.id)
          readRequest(request, (movements) => {
            try {
              const totals = calculateTotals(movements)
              const displayNames = new Map([
                ...archivedUsers.map((user) => [user.id, user.displayName]),
                ...users.map((user) => [user.id, user.displayName]),
              ])
              movements = orderedMovements(movements)
              const displayMovements = movements.map((movement) => ({
                ...movement,
                actorDisplayName: displayNames.get(movement.actorUserId) ?? movement.actorUserId,
              }))
              controls.setResult({
                status: record.status,
                session: {
                  ...record,
                  openedByDisplayName: displayNames.get(record.openedByUserId) ?? record.openedByUserId,
                  closedByDisplayName: displayNames.get(record.closedByUserId) ?? record.closedByUserId,
                },
                movements: displayMovements,
                totals,
              })
            } catch (error) { controls.abort(error) }
          })
        }
        if (sessionRecord) movementsFor(sessionRecord)
        else if (sessionRequest) readRequest(sessionRequest, movementsFor)
        else if (openSessions.length) controls.abort(cashError('CASH_STATE_INCONSISTENT', 'O estado atual do caixa precisa ser verificado.'))
        else controls.setResult({ status: 'closed', session: null, movements: [], totals: null })
      }
      readRequest(stateRequest, (value) => { state = value; finish() })
      readRequest(openRequest, (value) => { openSessions = value; finish() })
      readRequest(usersRequest, (value) => { users = value; finish() })
      readRequest(archivedUsersRequest, (value) => { archivedUsers = value; finish() })
    })
  }

  return { openCash, recordMovement, closeCash, getOverview }
}
