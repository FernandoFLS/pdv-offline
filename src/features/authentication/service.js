import { getAllRecords, getRecord } from '../../core/persistence/records.js'
import { runTransaction } from '../../core/persistence/transactions.js'
import { createPinCredential, verifyPinCredential } from '../../core/security/pin-credentials.js'
import { AuthenticationError } from './errors.js'
import { createSessionStore } from './session.js'

const MAX_FAILED_ATTEMPTS = 5
const INITIAL_LOCK_MS = 30_000
const MAX_LOCK_MS = 15 * 60_000

function authenticationError(code, message, details) {
  return new AuthenticationError(code, message, details)
}

function safeUser(user) {
  return { id: user.id, displayName: user.displayName, role: user.role }
}

function safeManagedUser(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
  }
}

function adminActor(session) {
  const actor = session.current()
  if (!actor || actor.role !== 'admin') {
    throw authenticationError('NOT_AUTHORIZED', 'Somente um administrador autenticado pode gerenciar usuários.')
  }
  return actor
}

function revalidateAdmin(transaction, controls, actor, session, onAuthorized) {
  const request = transaction.objectStore('users').get(actor.id)
  request.onsuccess = () => {
    const current = session.current()
    if (current?.id !== actor.id || current.role !== 'admin' ||
        request.result?.status !== 'active' || request.result.role !== 'admin') {
      controls.abort(authenticationError('NOT_AUTHORIZED', 'A sessão administrativa não está mais ativa.'))
      return
    }
    onAuthorized()
  }
}

function validateRole(role) {
  if (!['admin', 'operator'].includes(role)) {
    throw authenticationError('INVALID_ROLE', 'Escolha o perfil de administrador ou operador.')
  }
}

function makeId() {
  if (!globalThis.crypto?.randomUUID) {
    const error = new Error('Geração segura de identificadores não está disponível.')
    error.code = 'CRYPTO_UNAVAILABLE'
    throw error
  }
  return globalThis.crypto.randomUUID()
}

function validateDisplayName(displayName) {
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 60) {
    throw authenticationError('INVALID_DISPLAY_NAME', 'Informe um nome com até 60 caracteres.')
  }
  return displayName.trim()
}

function isActive(user) {
  return user?.status === 'active'
}

function sameCredential(left, right) {
  return left?.version === right?.version &&
    left?.algorithm === right?.algorithm &&
    left?.hash === right?.hash &&
    left?.iterations === right?.iterations &&
    left?.salt === right?.salt &&
    left?.derivedKey === right?.derivedKey
}

function lockedError(until, now) {
  return authenticationError('ACCOUNT_LOCKED', 'Muitas tentativas. Aguarde antes de tentar novamente.', {
    retryAfterSeconds: Math.max(1, Math.ceil((until - now) / 1000)),
  })
}

function auditRecord({ action, entityId, actorUserId, now, meta }) {
  const record = {
    id: makeId(),
    entityType: 'user',
    entityId,
    action,
    occurredAt: new Date(now).toISOString(),
  }
  if (actorUserId) record.actorUserId = actorUserId
  if (meta) record.meta = meta
  return record
}

export function createAuthenticationService(database, {
  session = createSessionStore(),
  now = () => Date.now(),
} = {}) {
  session.subscribe((user, reason) => {
    if (reason !== 'idle-timeout' || !user) return
    const timestamp = now()
    runTransaction(database, ['auditLog'], 'readwrite', (transaction) => {
      transaction.objectStore('auditLog').add(auditRecord({
        action: 'authentication.idle-timeout',
        entityId: user.id,
        actorUserId: user.id,
        now: timestamp,
      }))
    }).catch(() => {})
  })

  async function recordFailedAttempt(userId, expectedCredential) {
    const timestamp = now()
    return runTransaction(database, ['users', 'auditLog'], 'readwrite', (transaction, controls) => {
      const users = transaction.objectStore('users')
      const request = users.get(userId)
      request.onsuccess = () => {
        const user = request.result
        if (!isActive(user) || !sameCredential(user.pinCredential, expectedCredential)) {
          controls.abort(authenticationError('INVALID_CREDENTIALS', 'PIN inválido ou usuário indisponível.'))
          return
        }
        if (user.lockedUntil > timestamp) {
          controls.abort(lockedError(user.lockedUntil, timestamp))
          return
        }

        const attempts = (Number.isInteger(user.failedPinAttempts) ? user.failedPinAttempts : 0) + 1
        const lockoutLevel = Number.isInteger(user.lockoutLevel) ? Math.max(0, user.lockoutLevel) : 0
        const locked = attempts >= MAX_FAILED_ATTEMPTS
        const lockDuration = Math.min(INITIAL_LOCK_MS * (2 ** Math.min(lockoutLevel, 10)), MAX_LOCK_MS)
        const updated = {
          ...user,
          failedPinAttempts: locked ? 0 : attempts,
          lockoutLevel: locked ? Math.min(lockoutLevel + 1, 10) : lockoutLevel,
          lockedUntil: locked ? timestamp + lockDuration : 0,
        }
        users.put(updated)
        if (locked) {
          transaction.objectStore('auditLog').add(auditRecord({
            action: 'authentication.locked',
            entityId: userId,
            now: timestamp,
          }))
        }
        controls.setResult({ lockedUntil: updated.lockedUntil })
      }
    })
  }

  async function completeLogin(userId, expectedCredential) {
    const timestamp = now()
    return runTransaction(database, ['users', 'auditLog'], 'readwrite', (transaction, controls) => {
      const users = transaction.objectStore('users')
      const request = users.get(userId)
      request.onsuccess = () => {
        const user = request.result
        if (!isActive(user) || !sameCredential(user.pinCredential, expectedCredential)) {
          controls.abort(authenticationError('INVALID_CREDENTIALS', 'PIN inválido ou usuário indisponível.'))
          return
        }
        if (user.lockedUntil > timestamp) {
          controls.abort(lockedError(user.lockedUntil, timestamp))
          return
        }

        users.put({ ...user, failedPinAttempts: 0, lockoutLevel: 0, lockedUntil: 0 })
        transaction.objectStore('auditLog').add(auditRecord({
          action: 'authentication.login',
          entityId: user.id,
          actorUserId: user.id,
          now: timestamp,
        }))
        controls.setResult(safeUser(user))
      }
    })
  }

  async function listUsers() {
    const actor = adminActor(session)
    return runTransaction(database, ['users'], 'readonly', (transaction, controls) => {
      const users = transaction.objectStore('users')
      const allRequest = users.getAll()
      let allUsers
      let authorized = false
      const finish = () => {
        if (!authorized || !allUsers) return
        controls.setResult(allUsers.map(safeManagedUser))
      }
      allRequest.onsuccess = () => { allUsers = allRequest.result; finish() }
      revalidateAdmin(transaction, controls, actor, session, () => {
        authorized = true
        finish()
      })
    })
  }

  async function createManagedUser({ displayName, pin, role = 'operator' }, auditAction) {
    const actor = adminActor(session)
    const name = validateDisplayName(displayName)
    validateRole(role)
    const pinCredential = await createPinCredential(pin)
    const timestamp = now()
    const user = {
      id: makeId(), displayName: name, role, status: 'active',
      createdAt: new Date(timestamp).toISOString(), pinCredential,
      failedPinAttempts: 0, lockoutLevel: 0, lockedUntil: 0,
    }
    await runTransaction(database, ['users', 'auditLog'], 'readwrite', (transaction, controls) => {
      revalidateAdmin(transaction, controls, actor, session, () => {
        transaction.objectStore('users').add(user)
        transaction.objectStore('auditLog').add(auditRecord({
          action: auditAction, entityId: user.id, actorUserId: actor.id, now: timestamp,
          meta: { displayName: user.displayName, role: user.role },
        }))
        controls.setResult(safeUser(user))
      })
    })
    return safeManagedUser(user)
  }

  async function updateUser({ userId, displayName, role }) {
    const actor = adminActor(session)
    const name = validateDisplayName(displayName)
    validateRole(role)
    if (typeof userId !== 'string' || !userId) {
      throw authenticationError('USER_NOT_FOUND', 'O usuário selecionado não foi encontrado.')
    }
    const timestamp = now()
    let affectedUser
    const updatedUser = await runTransaction(database, ['users', 'auditLog'], 'readwrite', (transaction, controls) => {
      const users = transaction.objectStore('users')
      revalidateAdmin(transaction, controls, actor, session, () => {
        const targetRequest = users.get(userId)
        targetRequest.onsuccess = () => {
          const target = targetRequest.result
          if (!target) {
            controls.abort(authenticationError('USER_NOT_FOUND', 'O usuário selecionado não foi encontrado.'))
            return
          }
          const applyUpdate = () => {
            const updated = { ...target, displayName: name, role }
            users.put(updated)
            transaction.objectStore('auditLog').add(auditRecord({
              action: 'user.updated', entityId: target.id, actorUserId: actor.id, now: timestamp,
              meta: {
                previous: { displayName: target.displayName, role: target.role },
                next: { displayName: name, role },
              },
            }))
            controls.setResult(updated)
            affectedUser = { id: target.id, roleChanged: target.role !== role }
          }
          if (isActive(target) && target.role === 'admin' && role !== 'admin') {
            const allRequest = users.getAll()
            allRequest.onsuccess = () => {
              const otherActiveAdmins = allRequest.result.filter((user) =>
                user.id !== target.id && isActive(user) && user.role === 'admin')
              if (otherActiveAdmins.length === 0) {
                controls.abort(authenticationError('LAST_ADMIN', 'Não é possível remover o último administrador ativo.'))
                return
              }
              applyUpdate()
            }
          } else {
            applyUpdate()
          }
        }
      })
    })
    if (affectedUser?.roleChanged) session.invalidate?.(affectedUser.id, 'permissions-changed')
    return safeManagedUser(updatedUser)
  }

  async function resetUserPin({ userId, pin }) {
    const actor = adminActor(session)
    if (typeof userId !== 'string' || !userId) {
      throw authenticationError('USER_NOT_FOUND', 'O usuário selecionado não foi encontrado.')
    }
    const pinCredential = await createPinCredential(pin)
    const timestamp = now()
    const updatedUser = await runTransaction(database, ['users', 'auditLog'], 'readwrite', (transaction, controls) => {
      const users = transaction.objectStore('users')
      revalidateAdmin(transaction, controls, actor, session, () => {
        const request = users.get(userId)
        request.onsuccess = () => {
          const target = request.result
          if (!target) {
            controls.abort(authenticationError('USER_NOT_FOUND', 'O usuário selecionado não foi encontrado.'))
            return
          }
          users.put({ ...target, pinCredential, failedPinAttempts: 0, lockoutLevel: 0, lockedUntil: 0 })
          transaction.objectStore('auditLog').add(auditRecord({
            action: 'user.pin-reset', entityId: target.id, actorUserId: actor.id, now: timestamp,
          }))
          controls.setResult({ ...target, pinCredential, failedPinAttempts: 0, lockoutLevel: 0, lockedUntil: 0 })
        }
      })
    })
    session.invalidate?.(userId, 'pin-reset')
    return safeManagedUser(updatedUser)
  }

  async function setUserActive({ userId, active }) {
    const actor = adminActor(session)
    if (typeof userId !== 'string' || !userId || typeof active !== 'boolean') {
      throw authenticationError('INVALID_USER_STATUS', 'O estado do usuário informado é inválido.')
    }
    if (userId === actor.id && !active) {
      throw authenticationError('SELF_DEACTIVATION', 'Não é permitido desativar a própria conta.')
    }
    const timestamp = now()
    let wasDeactivated = false
    const updatedUser = await runTransaction(database, ['users', 'auditLog'], 'readwrite', (transaction, controls) => {
      const users = transaction.objectStore('users')
      revalidateAdmin(transaction, controls, actor, session, () => {
        const targetRequest = users.get(userId)
        targetRequest.onsuccess = () => {
          const target = targetRequest.result
          if (!target) {
            controls.abort(authenticationError('USER_NOT_FOUND', 'O usuário selecionado não foi encontrado.'))
            return
          }
          const nextStatus = active ? 'active' : 'inactive'
          if (target.status === nextStatus) {
            controls.setResult(target)
            return
          }
          const applyStatus = () => {
            const updated = { ...target, status: nextStatus }
            users.put(updated)
            transaction.objectStore('auditLog').add(auditRecord({
              action: active ? 'user.activated' : 'user.deactivated',
              entityId: target.id, actorUserId: actor.id, now: timestamp,
              meta: { previousStatus: target.status, nextStatus },
            }))
            controls.setResult(updated)
            wasDeactivated = !active
          }
          if (!active && isActive(target) && target.role === 'admin') {
            const allRequest = users.getAll()
            allRequest.onsuccess = () => {
              const otherActiveAdmins = allRequest.result.filter((user) =>
                user.id !== target.id && isActive(user) && user.role === 'admin')
              if (otherActiveAdmins.length === 0) {
                controls.abort(authenticationError('LAST_ADMIN', 'Não é possível desativar o último administrador ativo.'))
                return
              }
              applyStatus()
            }
          } else {
            applyStatus()
          }
        }
      })
    })
    if (wasDeactivated) session.invalidate?.(userId, 'account-disabled')
    return safeManagedUser(updatedUser)
  }

  async function deleteUser({ userId }) {
    const actor = adminActor(session)
    if (typeof userId !== 'string' || !userId) {
      throw authenticationError('USER_NOT_FOUND', 'O usuário selecionado não foi encontrado.')
    }
    if (userId === actor.id) {
      throw authenticationError('SELF_DELETION', 'Não é permitido excluir a própria conta.')
    }
    const timestamp = now()
    const deletedUser = await runTransaction(
      database,
      ['users', 'userIdentityArchive', 'auditLog'],
      'readwrite',
      (transaction, controls) => {
        const users = transaction.objectStore('users')
        const identityArchive = transaction.objectStore('userIdentityArchive')
        revalidateAdmin(transaction, controls, actor, session, () => {
          const targetRequest = users.get(userId)
          targetRequest.onsuccess = () => {
            const target = targetRequest.result
            if (!target) {
              controls.abort(authenticationError('USER_NOT_FOUND', 'O usuário selecionado não foi encontrado.'))
              return
            }

            const archiveAndDelete = () => {
              const identity = {
                id: target.id,
                displayName: target.displayName,
                role: target.role,
                status: target.status,
                createdAt: target.createdAt,
                deletedAt: new Date(timestamp).toISOString(),
                deletedByUserId: actor.id,
              }
              identityArchive.add(identity)
              transaction.objectStore('auditLog').add(auditRecord({
                action: 'user.deleted',
                entityId: target.id,
                actorUserId: actor.id,
                now: timestamp,
                meta: {
                  displayName: target.displayName,
                  role: target.role,
                  status: target.status,
                  createdAt: target.createdAt,
                },
              }))
              users.delete(target.id)
              controls.setResult({ ...safeManagedUser(target), deletedAt: identity.deletedAt })
            }

            if (isActive(target) && target.role === 'admin') {
              const adminsRequest = users.getAll()
              adminsRequest.onsuccess = () => {
                const otherActiveAdmins = adminsRequest.result.filter((user) =>
                  user.id !== target.id && isActive(user) && user.role === 'admin')
                if (otherActiveAdmins.length === 0) {
                  controls.abort(authenticationError('LAST_ADMIN', 'Não é possível excluir o último administrador ativo.'))
                  return
                }
                archiveAndDelete()
              }
            } else {
              archiveAndDelete()
            }
          }
        })
      },
    )
    session.invalidate?.(userId, 'account-deleted')
    return deletedUser
  }

  return {
    session,

    async isFirstRun() {
      return (await getAllRecords(database, 'users')).length === 0
    },

    async listActiveUsers() {
      const users = await getAllRecords(database, 'users')
      return users.filter(isActive).map(safeUser)
    },

    listUsers,
    createUser(input) {
      return createManagedUser(input, 'user.created')
    },
    updateUser,
    resetUserPin,
    setUserActive,
    deleteUser,

    async createInitialAdmin({ displayName, pin }) {
      const name = validateDisplayName(displayName)
      const pinCredential = await createPinCredential(pin)
      const timestamp = now()
      const user = {
        id: makeId(),
        displayName: name,
        role: 'admin',
        status: 'active',
        createdAt: new Date(timestamp).toISOString(),
        pinCredential,
        failedPinAttempts: 0,
        lockoutLevel: 0,
        lockedUntil: 0,
      }

      await runTransaction(database, ['users', 'auditLog'], 'readwrite', (transaction, controls) => {
        const users = transaction.objectStore('users')
        const request = users.count()
        request.onsuccess = () => {
          if (request.result !== 0) {
            controls.abort(authenticationError('SETUP_COMPLETE', 'O cadastro inicial já foi concluído.'))
            return
          }
          users.add(user)
          transaction.objectStore('auditLog').add(auditRecord({
            action: 'authentication.admin-created',
            entityId: user.id,
            actorUserId: user.id,
            now: timestamp,
          }))
          controls.setResult(safeUser(user))
        }
      })
      return safeUser(user)
    },

    async createOperator(input) {
      return createManagedUser({ ...input, role: 'operator' }, 'authentication.operator-created')
    },

    async login({ userId, pin }) {
      const user = await getRecord(database, 'users', userId)
      if (!isActive(user) || !user.pinCredential) {
        throw authenticationError('INVALID_CREDENTIALS', 'PIN inválido ou usuário indisponível.')
      }

      const timestamp = now()
      if (user.lockedUntil > timestamp) throw lockedError(user.lockedUntil, timestamp)

      const valid = await verifyPinCredential(pin, user.pinCredential)
      if (!valid) {
        const attempt = await recordFailedAttempt(user.id, user.pinCredential)
        if (attempt.lockedUntil > now()) throw lockedError(attempt.lockedUntil, now())
        throw authenticationError('INVALID_CREDENTIALS', 'PIN inválido ou usuário indisponível.')
      }

      const principal = await completeLogin(user.id, user.pinCredential)
      session.set(principal)
      return principal
    },

    async logout() {
      const user = session.current()
      session.logout()
      if (!user) return
      const timestamp = now()
      await runTransaction(database, ['auditLog'], 'readwrite', (transaction) => {
        transaction.objectStore('auditLog').add(auditRecord({
          action: 'authentication.logout',
          entityId: user.id,
          actorUserId: user.id,
          now: timestamp,
        }))
      })
    },
  }
}
