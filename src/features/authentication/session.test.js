import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionStore } from './session.js'

afterEach(() => vi.useRealTimers())

describe('sessão autenticada em memória', () => {
  it('expira automaticamente após cinco minutos sem atividade', () => {
    vi.useFakeTimers()
    const session = createSessionStore()
    const onChange = vi.fn()
    session.subscribe(onChange)
    session.set({ id: 'user-1', displayName: 'Operador', role: 'operator', pinCredential: { secret: true } })

    expect(session.current()).toEqual({ id: 'user-1', displayName: 'Operador', role: 'operator' })
    expect(Object.isFrozen(session.current())).toBe(true)

    vi.advanceTimersByTime(5 * 60 * 1000)

    expect(session.current()).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith(
      { id: 'user-1', displayName: 'Operador', role: 'operator' },
      'idle-timeout',
    )
  })

  it('renova o prazo com atividade e cancela o temporizador no logout', () => {
    vi.useFakeTimers()
    const session = createSessionStore()
    session.set({ id: 'user-1', displayName: 'Operador', role: 'operator' })

    vi.advanceTimersByTime(4 * 60 * 1000)
    expect(session.touch()).toBe(true)
    vi.advanceTimersByTime(4 * 60 * 1000)
    expect(session.current()).not.toBeNull()

    session.logout()
    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(session.current()).toBeNull()
  })

  it('propaga logout para as outras abas do mesmo perfil', () => {
    const channels = []
    const channelFactory = () => {
      const listeners = new Set()
      const channel = {
        addEventListener(_type, listener) { listeners.add(listener) },
        postMessage(data) {
          for (const peer of channels) {
            if (peer !== channel) peer.dispatch(data)
          }
        },
        dispatch(data) {
          for (const listener of listeners) listener({ data })
        },
      }
      channels.push(channel)
      return channel
    }
    const firstTab = createSessionStore({ channelFactory })
    const secondTab = createSessionStore({ channelFactory })
    firstTab.set({ id: 'admin-1', displayName: 'Admin', role: 'admin' })
    secondTab.set({ id: 'operator-1', displayName: 'Operador', role: 'operator' })

    secondTab.logout()

    expect(secondTab.current()).toBeNull()
    expect(firstTab.current()).toBeNull()
  })

  it('invalida apenas a conta afetada em outras abas após mudança administrativa', () => {
    const channels = []
    const channelFactory = () => {
      const listeners = new Set()
      const channel = {
        addEventListener(_type, listener) { listeners.add(listener) },
        postMessage(data) {
          for (const peer of channels) if (peer !== channel) peer.dispatch(data)
        },
        dispatch(data) { for (const listener of listeners) listener({ data }) },
      }
      channels.push(channel)
      return channel
    }
    const administratorTab = createSessionStore({ channelFactory })
    const operatorTab = createSessionStore({ channelFactory })
    administratorTab.set({ id: 'admin-1', displayName: 'Admin', role: 'admin' })
    operatorTab.set({ id: 'operator-1', displayName: 'Operador', role: 'operator' })

    administratorTab.invalidate('operator-1', 'account-disabled')

    expect(operatorTab.current()).toBeNull()
    expect(administratorTab.current()).toMatchObject({ id: 'admin-1', role: 'admin' })
  })
})
