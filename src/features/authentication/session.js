const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000

export function createSessionStore({
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  channelFactory = defaultChannelFactory,
} = {}) {
  let user = null
  let lastActivityAt = 0
  let timeout
  const listeners = new Set()
  const channel = channelFactory?.('pdv-offline-auth-session')

  function notify(reason, subject = user) {
    for (const listener of listeners) listener(subject, reason)
  }

  function clear(reason) {
    const previousUser = user
    if (timeout !== undefined) clearTimeout(timeout)
    timeout = undefined
    user = null
    lastActivityAt = 0
    notify(reason, previousUser)
  }

  channel?.addEventListener('message', (event) => {
    if (event.data?.type === 'logout') clear('remote-logout')
    if (event.data?.type === 'invalidate-user' && event.data.userId === user?.id) {
      clear(event.data.reason || 'user-invalidated')
    }
  })

  function expireIfIdle() {
    if (user && now() - lastActivityAt >= idleTimeoutMs) clear('idle-timeout')
  }

  function scheduleExpiry() {
    if (timeout !== undefined) clearTimeout(timeout)
    timeout = setTimeout(expireIfIdle, idleTimeoutMs)
  }

  return {
    current() {
      expireIfIdle()
      return user
    },
    set(userRecord) {
      user = Object.freeze({
        id: userRecord.id,
        displayName: userRecord.displayName,
        role: userRecord.role,
      })
      lastActivityAt = now()
      scheduleExpiry()
      notify('login')
      return user
    },
    touch() {
      expireIfIdle()
      if (!user) return false
      lastActivityAt = now()
      scheduleExpiry()
      return true
    },
    logout() {
      if (user) {
        channel?.postMessage({ type: 'logout' })
        clear('logout')
      }
    },
    invalidate(userId, reason = 'user-invalidated') {
      if (typeof userId !== 'string' || !userId) return
      channel?.postMessage({ type: 'invalidate-user', userId, reason })
      if (user?.id === userId) clear(reason)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function defaultChannelFactory(name) {
  if (typeof window === 'undefined' || typeof BroadcastChannel !== 'function') return null
  return new BroadcastChannel(name)
}
