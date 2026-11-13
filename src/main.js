import { openDatabase } from './core/persistence/index.js'
import { AuthenticationError } from './features/authentication/errors.js'
import { createAuthenticationService } from './features/authentication/service.js'
import { CashError, createCashService, toMinorUnits } from './features/cash/service.js'
import './styles.css'

const root = document.querySelector('.app-shell')
let auth
let cash
let pendingCashNotice = ''
let renderSequence = 0

function element(tag, attributes = {}, text = '') {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'className') node.className = value
    else if (name in node) node[name] = value
    else node.setAttribute(name, value)
  }
  if (text) node.textContent = text
  return node
}

function field(form, { id, label: labelText, type = 'text', autocomplete = 'off' }) {
  const label = element('label', { htmlFor: id }, labelText)
  const input = element('input', {
    id,
    name: id,
    type,
    required: true,
    autocomplete,
    spellcheck: false,
  })
  if (type === 'password') {
    input.inputMode = 'numeric'
    input.minLength = 6
    input.pattern = '[0-9]+'
  }
  form.append(label, input)
  return input
}

function messageFor(error) {
  if (error?.code === 'INVALID_CREDENTIALS') return 'PIN inválido ou usuário indisponível.'
  if (error?.code === 'ACCOUNT_LOCKED') return `Muitas tentativas. Aguarde ${error.retryAfterSeconds} s.`
  if (error?.code === 'NOT_AUTHORIZED') return 'Somente um administrador pode cadastrar operadores.'
  if (error?.code === 'SETUP_COMPLETE') return 'O cadastro inicial já foi concluído.'
  if (error?.code === 'INVALID_PIN') return 'Use pelo menos 6 dígitos numéricos.'
  if (error?.code === 'CRYPTO_UNAVAILABLE') return 'A criptografia do navegador não está disponível. Abra o app por localhost ou HTTPS.'
  if (error instanceof CashError) return error.message
  if (error instanceof AuthenticationError) return error.message
  return 'Não foi possível concluir a operação. Tente novamente.'
}

function formStatus(form, text, isError = false) {
  let status = form.querySelector('[role="status"]')
  if (!status) {
    status = element('p', { role: 'status', className: 'form-status' })
    form.append(status)
  }
  status.textContent = text
  status.dataset.state = isError ? 'error' : 'success'
}

function heading(title, description) {
  const eyebrow = element('p', { className: 'eyebrow' }, 'PDV Offline')
  const h1 = element('h1', {}, title)
  const intro = element('p', { className: 'intro' }, description)
  root.replaceChildren(eyebrow, h1, intro)
}

async function render() {
  if (!auth) return
  const sequence = ++renderSequence
  const user = auth.session.current()

  if (!user) {
    const users = await auth.listActiveUsers()
    if (sequence !== renderSequence || auth.session.current()) return
    pendingCashNotice = ''
    if (users.length === 0 && await auth.isFirstRun()) {
      renderInitialSetup()
    } else if (users.length > 0) {
      renderLogin(users)
    } else {
      heading('Acesso indisponível', 'Não há usuários ativos. Peça a um administrador para verificar o cadastro local.')
    }
    return
  }

  await renderAuthenticated(user, sequence)
}

function renderInitialSetup() {
  heading('Configuração inicial', 'Cadastre o primeiro administrador. O PIN será derivado antes de ser salvo no banco local.')
  const form = element('form', { className: 'auth-form' })
  const name = field(form, { id: 'admin-name', label: 'Nome do administrador', autocomplete: 'name' })
  const pin = field(form, { id: 'admin-pin', label: 'PIN do administrador', type: 'password', autocomplete: 'new-password' })
  const confirmation = field(form, { id: 'admin-pin-confirmation', label: 'Confirme o PIN', type: 'password', autocomplete: 'new-password' })
  const submit = element('button', { type: 'submit' }, 'Criar administrador')
  form.append(submit)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (pin.value !== confirmation.value) {
      formStatus(form, 'Os PINs não coincidem.', true)
      pin.value = ''
      confirmation.value = ''
      pin.focus()
      return
    }
    submit.disabled = true
    try {
      await auth.createInitialAdmin({ displayName: name.value, pin: pin.value })
      await render()
    } catch (error) {
      formStatus(form, messageFor(error), true)
    } finally {
      pin.value = ''
      confirmation.value = ''
      submit.disabled = false
    }
  })
  root.append(form)
}

function renderLogin(users) {
  heading('Entrar', 'Escolha seu usuário e informe o PIN para acessar o PDV.')
  const form = element('form', { className: 'auth-form' })
  const userLabel = element('label', { htmlFor: 'login-user' }, 'Usuário')
  const select = element('select', { id: 'login-user', name: 'userId', required: true })
  select.append(element('option', { value: '' }, 'Selecione seu nome'))
  for (const user of users) {
    select.append(element('option', { value: user.id }, `${user.displayName} — ${user.role === 'admin' ? 'Administrador' : 'Operador'}`))
  }
  form.append(userLabel, select)
  const pin = field(form, { id: 'login-pin', label: 'PIN', type: 'password', autocomplete: 'current-password' })
  const submit = element('button', { type: 'submit' }, 'Entrar')
  form.append(submit)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    submit.disabled = true
    try {
      await auth.login({ userId: select.value, pin: pin.value })
      await render()
    } catch (error) {
      formStatus(form, messageFor(error), true)
    } finally {
      pin.value = ''
      submit.disabled = false
    }
  })
  root.append(form)
}

const brlWholeFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

function money(minor) {
  const whole = Math.floor(Math.abs(minor) / 100)
  const cents = String(Math.abs(minor) % 100).padStart(2, '0')
  return `${minor < 0 ? '−' : ''}${brlWholeFormatter.format(whole)},${cents}`
}

function movementLabel(type) {
  if (type === 'opening') return 'Abertura'
  if (type === 'closing-count') return 'Contagem no fechamento'
  if (type === 'cash-in') return 'Entrada manual'
  if (type === 'cash-out') return 'Saída manual'
  return type
}

function renderMovementHistory(section, movements) {
  section.append(element('h3', {}, 'Histórico desta sessão'))
  const movementList = element('ul', { className: 'movement-list' })
  for (const movement of movements) {
    const item = element('li', { className: movement.cashEffect === 'out' ? 'movement-out' : 'movement-in' })
    const details = movement.reason ? ` · ${movement.reason}` : ''
    item.textContent = `${new Date(movement.occurredAt).toLocaleString('pt-BR')} — ${movementLabel(movement.type)}: ${money(movement.amountMinor)}${details} — responsável: ${movement.actorDisplayName}`
    movementList.append(item)
  }
  section.append(movementList)
}

function renderClosedCash(section, overview) {
  section.append(element('p', { className: 'notice' }, 'O caixa está fechado. Abra uma sessão para iniciar a operação.'))
  if (overview?.session) {
    section.append(element('p', {}, `Último fechamento: ${overview.session.closedByDisplayName} em ${new Date(overview.session.closedAt).toLocaleString('pt-BR')}.`))
    section.append(element('p', {}, `Esperado: ${money(overview.session.expectedAmountMinor)} · Contado: ${money(overview.session.closingAmountMinor)} · Diferença: ${money(overview.session.differenceMinor)}.`))
    renderMovementHistory(section, overview.movements)
  }
  const form = element('form', { className: 'auth-form compact-form' })
  const amount = field(form, { id: 'cash-opening-amount', label: 'Valor inicial em dinheiro (R$)', type: 'number' })
  amount.min = '0'
  amount.step = '0.01'
  const submit = element('button', { type: 'submit' }, 'Abrir caixa')
  form.append(submit)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    submit.disabled = true
    try {
      await cash.openCash(amount.value)
      await render()
    } catch (error) {
      formStatus(form, messageFor(error), true)
    } finally {
      submit.disabled = false
    }
  })
  section.append(form)
}

function renderOpenCash(section, overview) {
  const { session: cashSession, movements, totals } = overview
  section.append(element('p', { className: 'cash-state' }, 'Caixa aberto'))
  section.append(element('p', {}, `Aberto por ${cashSession.openedByDisplayName} em ${new Date(cashSession.openedAt).toLocaleString('pt-BR')}.`))
  section.append(element('p', {}, `Valor inicial: ${money(cashSession.openingAmountMinor)}.`))
  section.append(element('p', {}, `Entradas: ${money(totals.incomingMinor)} · Saídas: ${money(totals.outgoingMinor)} · Saldo esperado: ${money(totals.expectedMinor)}.`))
  renderMovementHistory(section, movements)

  const movementForm = element('form', { className: 'auth-form compact-form' })
  movementForm.append(element('h3', {}, 'Registrar entrada ou saída'))
  const typeLabel = element('label', { htmlFor: 'cash-movement-type' }, 'Tipo')
  const type = element('select', { id: 'cash-movement-type', name: 'type', required: true })
  type.append(element('option', { value: '' }, 'Selecione'))
  type.append(element('option', { value: 'cash-in' }, 'Entrada de dinheiro'))
  type.append(element('option', { value: 'cash-out' }, 'Saída de dinheiro'))
  movementForm.append(typeLabel, type)
  const movementAmount = field(movementForm, { id: 'cash-movement-amount', label: 'Valor (R$)', type: 'number' })
  movementAmount.min = '0.01'
  movementAmount.step = '0.01'
  const reason = field(movementForm, { id: 'cash-movement-reason', label: 'Motivo' })
  reason.maxLength = 200
  const movementPreview = element('p', { className: 'notice', 'aria-live': 'polite' }, 'Selecione o tipo e informe valor e motivo para conferir a movimentação.')
  let movementPreviewValid = false
  let movementSubmit
  const updatePreview = () => {
    movementPreviewValid = false
    try {
      if (!type.value || !reason.value.trim()) throw new Error('missing data')
      const amountMinor = toMinorUnits(movementAmount.value)
      if (amountMinor <= 0) throw new Error('invalid amount')
      const after = totals.expectedMinor + (type.value === 'cash-in' ? amountMinor : -amountMinor)
      if (after < 0) {
        movementPreview.textContent = 'A saída excede o dinheiro disponível no caixa.'
        if (movementSubmit) movementSubmit.disabled = true
        return
      }
      if (!Number.isSafeInteger(after)) throw new Error('amount exceeds safe limit')
      movementPreview.textContent = `${movementLabel(type.value)} de ${money(amountMinor)} · Motivo: ${reason.value.trim()} · Saldo após registro: ${money(after)}.`
      movementPreviewValid = true
    } catch {
      movementPreview.textContent = 'Selecione o tipo e informe um valor válido e o motivo para conferir a movimentação.'
    }
    if (movementSubmit) movementSubmit.disabled = !movementPreviewValid
  }
  type.addEventListener('change', updatePreview)
  movementAmount.addEventListener('input', updatePreview)
  reason.addEventListener('input', updatePreview)
  movementSubmit = element('button', { type: 'submit' }, 'Registrar movimentação')
  movementSubmit.disabled = true
  movementForm.append(movementPreview, movementSubmit)
  const idempotencyKey = crypto.randomUUID()
  movementForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    updatePreview()
    if (!type.value || !reason.value.trim()) {
      formStatus(movementForm, 'Informe tipo, valor e motivo.', true)
      return
    }
    if (!movementPreviewValid) {
      formStatus(movementForm, movementPreview.textContent, true)
      return
    }
    if (!window.confirm(`Confirma esta movimentação?\n${movementPreview.textContent}`)) return
    movementSubmit.disabled = true
    try {
      await cash.recordMovement({
        type: type.value,
        amount: movementAmount.value,
        reason: reason.value,
        idempotencyKey,
      })
      pendingCashNotice = 'Movimentação registrada com sucesso.'
      await render()
    } catch (error) {
      formStatus(movementForm, messageFor(error), true)
    } finally {
      movementSubmit.disabled = false
    }
  })
  section.append(movementForm)

  const form = element('form', { className: 'auth-form compact-form' })
  const amount = field(form, { id: 'cash-closing-amount', label: 'Dinheiro contado no caixa (R$)', type: 'number' })
  amount.min = '0'
  amount.step = '0.01'
  const preview = element('p', { className: 'notice' }, `Valor esperado: ${money(totals.expectedMinor)}. Informe o valor contado para calcular a diferença.`)
  amount.addEventListener('input', () => {
    try {
      const counted = toMinorUnits(amount.value)
      preview.textContent = `Esperado: ${money(totals.expectedMinor)} · Contado: ${money(counted)} · Diferença: ${money(counted - totals.expectedMinor)}.`
    } catch {
      preview.textContent = `Valor esperado: ${money(totals.expectedMinor)}. Informe o valor contado para calcular a diferença.`
    }
  })
  const submit = element('button', { type: 'submit' }, 'Conferir e fechar caixa')
  form.append(preview, submit)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    let counted
    try {
      counted = toMinorUnits(amount.value)
    } catch (error) {
      formStatus(form, messageFor(error), true)
      return
    }
    const difference = counted - totals.expectedMinor
    if (!window.confirm(`Fechar o caixa?\nEsperado: ${money(totals.expectedMinor)}\nContado: ${money(counted)}\nDiferença: ${money(difference)}`)) return
    submit.disabled = true
    try {
      await cash.closeCash(amount.value)
      await render()
    } catch (error) {
      formStatus(form, messageFor(error), true)
    } finally {
      submit.disabled = false
    }
  })
  section.append(form)
}

function roleText(role) {
  return role === 'admin' ? 'Administrador' : 'Operador'
}

function userStatusText(status) {
  return status === 'active' ? 'Ativo' : 'Desativado'
}

async function renderUserManagement(admin, sequence) {
  if (sequence !== renderSequence || auth.session.current()?.id !== admin.id || admin.role !== 'admin') return

  const section = element('section', { className: 'user-management-section' })
  section.append(element('h2', {}, 'Gerenciar usuários'))
  section.append(element('p', { className: 'user-management-help' },
    'Desativar ou reativar controla o acesso sem remover o cadastro. Excluir permanentemente remove as credenciais; a identidade mínima e o histórico ficam preservados.'))
  const feedback = element('p', { className: 'form-status', role: 'status', 'aria-live': 'polite' })
  const showFeedback = (message, isError = false) => {
    feedback.textContent = message
    feedback.dataset.state = isError ? 'error' : 'success'
  }

  const createForm = element('form', { className: 'auth-form compact-form' })
  createForm.append(element('h3', {}, 'Cadastrar usuário'))
  const name = field(createForm, { id: 'managed-user-name', label: 'Nome', autocomplete: 'name' })
  const roleLabel = element('label', { htmlFor: 'managed-user-role' }, 'Perfil')
  const role = element('select', { id: 'managed-user-role', name: 'role', required: true })
  role.append(element('option', { value: 'operator' }, 'Operador'))
  role.append(element('option', { value: 'admin' }, 'Administrador'))
  createForm.append(roleLabel, role)
  const pin = field(createForm, { id: 'managed-user-pin', label: 'PIN (mínimo 6 dígitos)', type: 'password', autocomplete: 'new-password' })
  const confirmation = field(createForm, { id: 'managed-user-pin-confirmation', label: 'Confirme o PIN', type: 'password', autocomplete: 'new-password' })
  const createButton = element('button', { type: 'submit' }, 'Cadastrar usuário')
  createForm.append(createButton)
  createForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (pin.value !== confirmation.value) {
      showFeedback('Os PINs não coincidem.', true)
      pin.value = ''
      confirmation.value = ''
      pin.focus()
      return
    }
    if (role.value === 'admin' && !window.confirm('Cadastrar este usuário com perfil de administrador?')) return
    createButton.disabled = true
    try {
      await auth.createUser({ displayName: name.value, role: role.value, pin: pin.value })
      name.value = ''
      pin.value = ''
      confirmation.value = ''
      showFeedback('Usuário cadastrado.')
      await refreshUsers()
    } catch (error) {
      showFeedback(messageFor(error), true)
      pin.value = ''
      confirmation.value = ''
    } finally {
      createButton.disabled = false
    }
  })
  section.append(createForm, feedback)

  const userList = element('div', { className: 'user-list' })
  section.append(element('h3', {}, 'Usuários cadastrados'), userList)
  root.append(section)

  async function refreshUsers() {
    try {
      const latestUsers = await auth.listUsers()
      if (sequence !== renderSequence || auth.session.current()?.id !== admin.id) return
      userList.replaceChildren(...latestUsers.map((user) => renderUserCard(user)))
    } catch (error) {
      showFeedback(messageFor(error), true)
    }
  }

  function renderUserCard(user) {
    const card = element('article', { className: 'user-card' })
    const title = element('div', { className: 'user-card-heading' })
    title.append(element('strong', {}, user.displayName))
    title.append(element('span', {}, `${roleText(user.role)} · ${userStatusText(user.status)}`))
    card.append(title)

    const actions = element('div', { className: 'user-actions' })
    const editButton = element('button', { type: 'button', className: 'secondary-button' }, 'Editar')
    const editor = element('form', { className: 'auth-form compact-form user-editor' })
    editor.hidden = true
    const editName = field(editor, { id: `edit-name-${user.id}`, label: 'Nome' })
    editName.value = user.displayName
    const editRoleLabel = element('label', { htmlFor: `edit-role-${user.id}` }, 'Perfil')
    const editRole = element('select', { id: `edit-role-${user.id}`, name: 'role', required: true })
    editRole.append(element('option', { value: 'operator' }, 'Operador'))
    editRole.append(element('option', { value: 'admin' }, 'Administrador'))
    editRole.value = user.role
    editor.append(editRoleLabel, editRole)
    const saveEdit = element('button', { type: 'submit' }, 'Salvar alterações')
    editor.append(saveEdit)
    editButton.addEventListener('click', () => { editor.hidden = !editor.hidden })
    editor.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (editRole.value !== user.role &&
          !window.confirm(`Alterar o perfil de ${user.displayName} para ${roleText(editRole.value)}?`)) return
      saveEdit.disabled = true
      try {
        await auth.updateUser({ userId: user.id, displayName: editName.value, role: editRole.value })
        showFeedback('Dados do usuário atualizados.')
        await refreshUsers()
      } catch (error) {
        showFeedback(messageFor(error), true)
      } finally {
        saveEdit.disabled = false
      }
    })

    const resetForm = element('form', { className: 'auth-form compact-form user-editor' })
    resetForm.hidden = true
    const newPin = field(resetForm, { id: `reset-pin-${user.id}`, label: 'Novo PIN', type: 'password', autocomplete: 'new-password' })
    const newPinConfirm = field(resetForm, { id: `reset-pin-confirm-${user.id}`, label: 'Confirme o novo PIN', type: 'password', autocomplete: 'new-password' })
    const resetButton = element('button', { type: 'submit' }, 'Confirmar novo PIN')
    resetForm.append(resetButton)
    resetForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (newPin.value !== newPinConfirm.value) {
        showFeedback('Os PINs não coincidem.', true)
        newPin.value = ''
        newPinConfirm.value = ''
        return
      }
      if (!window.confirm(`Redefinir o PIN de ${user.displayName}? As sessões abertas dessa conta serão encerradas.`)) return
      resetButton.disabled = true
      try {
        await auth.resetUserPin({ userId: user.id, pin: newPin.value })
        newPin.value = ''
        newPinConfirm.value = ''
        showFeedback('PIN redefinido. O usuário deverá entrar novamente.')
        await refreshUsers()
      } catch (error) {
        showFeedback(messageFor(error), true)
        newPin.value = ''
        newPinConfirm.value = ''
      } finally {
        resetButton.disabled = false
      }
    })

    const activeButton = element('button', { type: 'button', className: 'secondary-button' },
      user.status === 'active' ? 'Desativar' : 'Reativar')
    const resetToggle = element('button', { type: 'button', className: 'secondary-button' }, 'Redefinir PIN')
    const deleteButton = element('button', { type: 'button', className: 'danger-button' }, 'Excluir permanentemente')
    resetToggle.addEventListener('click', () => { resetForm.hidden = !resetForm.hidden })
    activeButton.disabled = user.id === admin.id && user.status === 'active'
    activeButton.title = activeButton.disabled ? 'Não é permitido desativar a própria conta.' : ''
    deleteButton.disabled = user.id === admin.id
    deleteButton.title = deleteButton.disabled ? 'Não é permitido excluir a própria conta.' : ''
    activeButton.addEventListener('click', async () => {
      const nextActive = user.status !== 'active'
      if (!window.confirm(`${nextActive ? 'Reativar' : 'Desativar'} a conta de ${user.displayName}?`)) return
      activeButton.disabled = true
      try {
        await auth.setUserActive({ userId: user.id, active: nextActive })
        showFeedback(`Usuário ${nextActive ? 'reativado' : 'desativado'}.`)
        await refreshUsers()
      } catch (error) {
        showFeedback(messageFor(error), true)
      } finally {
        activeButton.disabled = false
      }
    })
    deleteButton.addEventListener('click', async () => {
      if (!window.confirm(`Excluir permanentemente o usuário “${user.displayName}”? As credenciais serão removidas. Os registros de caixa e auditoria serão preservados. Esta operação é permanente.`)) return
      deleteButton.disabled = true
      try {
        await auth.deleteUser({ userId: user.id })
        showFeedback(`A conta de ${user.displayName} foi excluída. O histórico operacional e a auditoria foram preservados.`)
      } catch (error) {
        showFeedback(messageFor(error), true)
      } finally {
        await refreshUsers()
      }
    })

    actions.append(editButton, activeButton, deleteButton)
    if (user.status === 'active') actions.append(resetToggle)
    card.append(actions, editor, resetForm)
    return card
  }

  await refreshUsers()
}

async function renderAuthenticated(user, sequence) {
  let overview
  let overviewError
  try {
    overview = await cash.getOverview()
  } catch (error) {
    overviewError = error
  }
  if (sequence !== renderSequence || auth.session.current()?.id !== user.id) return
  heading(`Olá, ${user.displayName}`, `Sessão autenticada como ${user.role === 'admin' ? 'administrador' : 'operador'}.`)
  root.append(element('p', { className: 'notice' }, 'A sessão será bloqueada após 5 minutos sem atividade. Um caixa aberto permanece aberto ao sair.'))

  const logout = element('button', { type: 'button', className: 'secondary-button' }, 'Sair')
  logout.addEventListener('click', async () => {
    logout.disabled = true
    try {
      await auth.logout()
    } catch {
      // The in-memory session is cleared before the logout audit is written.
    }
    await render()
  })
  root.append(logout)

  const cashSection = element('section', { className: 'cash-section' })
  cashSection.append(element('h2', {}, 'Caixa'))
  if (pendingCashNotice) {
    cashSection.append(element('p', { className: 'form-status', role: 'status', 'data-state': 'success' }, pendingCashNotice))
    pendingCashNotice = ''
  }
  if (overviewError) cashSection.append(element('p', { className: 'form-status', role: 'status', 'data-state': 'error' }, messageFor(overviewError)))
  else if (overview.status === 'open') renderOpenCash(cashSection, overview)
  else renderClosedCash(cashSection, overview)
  root.append(cashSection)

  if (user.role === 'admin') await renderUserManagement(user, sequence)
}

try {
  const database = await openDatabase()
  auth = createAuthenticationService(database)
  cash = createCashService(database, { session: auth.session })
  auth.session.subscribe(() => render())
  window.addEventListener('pointerdown', () => auth.session.touch())
  window.addEventListener('keydown', () => auth.session.touch())
  await render()
} catch (error) {
  heading('PDV Offline', 'Não foi possível abrir o armazenamento local neste navegador.')
  root.append(element('p', { className: 'form-status', role: 'status' }, messageFor(error)))
}
