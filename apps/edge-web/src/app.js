export {};

const elements = {
  acceptInviteForm: /** @type {HTMLFormElement} */ (
    select('#accept-invite-form')
  ),
  adminTools: select('#admin-tools'),
  capabilityForm: /** @type {HTMLFormElement} */ (select('#capability-form')),
  createInviteForm: /** @type {HTMLFormElement} */ (
    select('#create-invite-form')
  ),
  createdInvite: select('#created-invite'),
  error: select('#error-summary'),
  invitePanel: select('#invite-panel'),
  inviteTab: /** @type {HTMLButtonElement} */ (select('#invite-tab')),
  loginForm: /** @type {HTMLFormElement} */ (select('#login-form')),
  loginPanel: select('#login-panel'),
  loginTab: /** @type {HTMLButtonElement} */ (select('#login-tab')),
  logoutButton: /** @type {HTMLButtonElement} */ (select('#logout-button')),
  mfaForm: /** @type {HTMLFormElement} */ (select('#mfa-form')),
  mfaResult: select('#mfa-result'),
  mfaSecret: select('#mfa-secret'),
  recoveryCodes: select('#recovery-codes'),
  sessionSummary: select('#session-summary'),
  signedIn: select('#signed-in'),
  signedOut: select('#signed-out'),
  status: select('#runtime-status'),
};

elements.loginTab.addEventListener('click', () => selectTab('login'));
elements.inviteTab.addEventListener('click', () => selectTab('invite'));
for (const tab of [elements.loginTab, elements.inviteTab]) {
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next =
      tab === elements.loginTab ? elements.inviteTab : elements.loginTab;
    next.focus();
    selectTab(next === elements.loginTab ? 'login' : 'invite', false);
  });
}

elements.loginForm.addEventListener('submit', (event) =>
  submit(event, async (form) => {
    const data = formData(form);
    const session = await request('/api/v1/sessions', {
      body: compact({
        email: data.email,
        password: data.password,
        recoveryCode: data.recoveryCode,
        totpCode: data.totpCode,
      }),
      method: 'POST',
    });
    showSession(session);
    announce('Sessão iniciada com segurança.');
    form.reset();
  }),
);

elements.acceptInviteForm.addEventListener('submit', (event) =>
  submit(event, async (form) => {
    const data = formData(form);
    await request('/api/v1/invitations/accept', {
      body: { password: data.password, token: data.token },
      method: 'POST',
    });
    form.reset();
    selectTab('login');
    announce('Conta ativada. Entre com seu e-mail e a senha criada.');
  }),
);

elements.logoutButton.addEventListener('click', async () => {
  await withBusy(elements.logoutButton, async () => {
    await request('/api/v1/sessions/current', {
      authenticated: true,
      method: 'DELETE',
    });
    showSignedOut();
    announce('Sessão encerrada.');
  });
});

elements.mfaForm.addEventListener('submit', (event) =>
  submit(event, async (form) => {
    const data = formData(form);
    const enrollment = await request('/api/v1/mfa/enrollments', {
      authenticated: true,
      body: { reason: data.reason },
      idempotent: true,
      method: 'POST',
    });
    elements.mfaSecret.textContent = `Segredo: ${enrollment.secret}`;
    elements.recoveryCodes.replaceChildren(
      ...enrollment.recoveryCodes.map((/** @type {string} */ code) => {
        const item = document.createElement('li');
        item.textContent = code;
        return item;
      }),
    );
    elements.mfaResult.hidden = false;
    elements.mfaResult.focus();
    announce('Autenticador cadastrado. Guarde os códigos de recuperação.');
  }),
);

elements.createInviteForm.addEventListener('submit', (event) =>
  submit(event, async (form) => {
    const data = formData(form);
    const invitation = await request('/api/v1/invitations', {
      authenticated: true,
      body: {
        email: data.email,
        expiresAt: new Date(String(data.expiresAt)).toISOString(),
        functionName: data.functionName,
        reason: data.reason,
      },
      idempotent: true,
      method: 'POST',
    });
    elements.createdInvite.textContent = `Código do convite (exibido uma vez): ${invitation.token}`;
    elements.createdInvite.hidden = false;
    elements.createdInvite.focus();
    announce('Convite criado.');
  }),
);

elements.capabilityForm.addEventListener('submit', (event) =>
  submit(event, async (form) => {
    const submitter = /** @type {HTMLButtonElement|null} */ (event.submitter);
    const change = submitter?.value;
    if (change !== 'grant' && change !== 'revoke') {
      throw new Error('Invalid capability action');
    }
    const data = formData(form);
    await request(`/api/v1/capabilities/${change}`, {
      authenticated: true,
      body: {
        capability: data.capability,
        reason: data.reason,
        targetId: data.targetId,
      },
      idempotent: true,
      method: 'POST',
    });
    announce(
      change === 'grant' ? 'Capacidade concedida.' : 'Capacidade revogada.',
    );
  }),
);

void restoreSession();

async function restoreSession() {
  try {
    showSession(await request('/api/v1/sessions/current'));
    announce('Sessão restaurada.');
  } catch {
    showSignedOut();
    announce('Entre para continuar.');
  }
}

/** @param {Record<string, any>} session */
function showSession(session) {
  elements.signedOut.hidden = true;
  elements.signedIn.hidden = false;
  const capabilities = Array.isArray(session.capabilities)
    ? session.capabilities
    : Array.isArray(session.user?.capabilities)
      ? session.user.capabilities
      : [];
  const functionName = String(
    session.functionName ?? session.user?.functionName ?? '',
  );
  elements.sessionSummary.textContent = functionName
    ? `Função: ${functionName}.`
    : 'Conta autenticada.';
  elements.adminTools.hidden = !capabilities.includes('COMMERCIAL_ADMIN');
  elements.signedIn.querySelector('h2')?.focus();
}

function showSignedOut() {
  elements.signedIn.hidden = true;
  elements.signedOut.hidden = false;
  elements.loginPanel.querySelector('h2')?.focus();
}

/** @param {'login'|'invite'} selected @param {boolean} [moveFocus] */
function selectTab(selected, moveFocus = true) {
  const loginSelected = selected === 'login';
  elements.loginTab.setAttribute('aria-selected', String(loginSelected));
  elements.loginTab.tabIndex = loginSelected ? 0 : -1;
  elements.inviteTab.setAttribute('aria-selected', String(!loginSelected));
  elements.inviteTab.tabIndex = loginSelected ? -1 : 0;
  elements.loginPanel.hidden = !loginSelected;
  elements.invitePanel.hidden = loginSelected;
  if (moveFocus) {
    (loginSelected ? elements.loginPanel : elements.invitePanel)
      .querySelector('h2')
      ?.focus();
  }
}

/** @param {SubmitEvent} event @param {(form: HTMLFormElement) => Promise<void>} action */
async function submit(event, action) {
  event.preventDefault();
  const form = /** @type {HTMLFormElement} */ (event.currentTarget);
  await withBusy(form, () => action(form));
}

/** @param {HTMLElement} element @param {() => Promise<void>} action */
async function withBusy(element, action) {
  clearError();
  element.setAttribute('aria-busy', 'true');
  const controls =
    /** @type {Array<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>} */ ([
      ...element.querySelectorAll('button, input, select'),
    ]);
  for (const control of controls) control.disabled = true;
  if (element.tagName === 'BUTTON') {
    /** @type {HTMLButtonElement} */ (element).disabled = true;
  }
  try {
    await action();
  } catch (error) {
    showError(publicMessage(error));
  } finally {
    element.removeAttribute('aria-busy');
    for (const control of controls) control.disabled = false;
    if (element.tagName === 'BUTTON') {
      /** @type {HTMLButtonElement} */ (element).disabled = false;
    }
  }
}

/** @param {string} url @param {{authenticated?: boolean, body?: unknown, idempotent?: boolean, method?: string}} [options] @returns {Promise<any>} */
async function request(url, options = {}) {
  const headers = /** @type {Record<string, string>} */ ({
    accept: 'application/json',
  });
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.authenticated) headers['x-csrf-token'] = readCookie('crm_csrf');
  if (options.idempotent)
    headers['idempotency-key'] = globalThis.crypto.randomUUID();
  const response = await globalThis.fetch(url, {
    credentials: 'same-origin',
    headers,
    method: options.method ?? 'GET',
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = /** @type {Error & {code?: unknown, status?: number}} */ (
      new Error('Request failed')
    );
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return {};
  return response.json();
}

/** @param {HTMLFormElement} form */
function formData(form) {
  return Object.fromEntries(
    [...new globalThis.FormData(form).entries()].map(([key, value]) => [
      key,
      String(value),
    ]),
  );
}

/** @param {Record<string, unknown>} value */
function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== '' && item !== undefined,
    ),
  );
}

/** @param {string} name */
function readCookie(name) {
  const matches = document.cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : '';
}

/** @param {string} message */
function announce(message) {
  elements.status.textContent = message;
}

/** @param {string} message */
function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
  elements.error.focus();
}

function clearError() {
  elements.error.hidden = true;
  elements.error.textContent = '';
}

/** @param {unknown} error */
function publicMessage(error) {
  const code =
    error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (code === 'INVALID_CREDENTIALS')
    return 'Não foi possível entrar com os dados informados.';
  if (code === 'AUTHENTICATION_THROTTLED')
    return 'Muitas tentativas. Aguarde e tente novamente.';
  if (code === 'IDEMPOTENCY_KEY_REUSED')
    return 'A solicitação já foi usada com outros dados. Tente novamente.';
  if (code === 'FORBIDDEN')
    return 'Você não tem permissão para concluir esta ação.';
  return 'Não foi possível concluir. Revise os dados e tente novamente.';
}

/** @param {string} selector */
function select(selector) {
  const element = document.querySelector(selector);
  if (element === null) {
    throw new Error(`Missing element: ${selector}`);
  }
  return /** @type {HTMLElement} */ (element);
}
