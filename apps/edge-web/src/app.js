import { ApiError, request } from './lib/api-client.js';
import { KanbanEventStream } from './lib/event-stream.js';
import { createDealDetailView } from './features/deal-detail-view.js';
import { createKanbanView } from './features/kanban-view.js';
import { el, select, withBusy } from './lib/ui.js';

const elements = {
  publicShell: select('#public-shell'),
  applicationShell: select('#application-shell'),
  outlet: select('#main-content'),
  signedOut: select('#signed-out'),
  loginForm: /** @type {HTMLFormElement} */ (select('#login-form')),
  inviteForm: /** @type {HTMLFormElement} */ (select('#accept-invite-form')),
  loginTab: /** @type {HTMLButtonElement} */ (select('#login-tab')),
  inviteTab: /** @type {HTMLButtonElement} */ (select('#invite-tab')),
  loginPanel: select('#login-panel'),
  invitePanel: select('#invite-panel'),
  logout: select('#logout-button'),
  status: select('#runtime-status'),
  error: select('#error-summary'),
  summary: select('#session-summary'),
  connection: select('#connection-state'),
  navToggle: /** @type {HTMLButtonElement} */ (select('#nav-toggle')),
  mobileNav: select('#mobile-nav'),
};
let session = /** @type {Record<string, any>|null} */ (null);
let activeView = /** @type {any} */ (null);
let lastAnnouncement = '';
const stream = new KanbanEventStream({
  onChange(event) {
    activeView?.refreshFromEvent(event);
  },
  onReset() {
    activeView?.reset();
    announce('A conexão foi ressincronizada.');
  },
  onState(state) {
    elements.connection.textContent =
      state === 'conectado'
        ? 'Atualização ao vivo'
        : state === 'reconectando'
          ? 'Reconectando…'
          : 'Conectando…';
    elements.connection.dataset.state = state;
  },
});

elements.loginTab.addEventListener('click', () => selectTab('login'));
elements.inviteTab.addEventListener('click', () => selectTab('invite'));
for (const tab of [elements.loginTab, elements.inviteTab])
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next =
      tab === elements.loginTab ? elements.inviteTab : elements.loginTab;
    next.focus();
    selectTab(next === elements.loginTab ? 'login' : 'invite', false);
  });
elements.loginForm.addEventListener(
  'submit',
  (event) =>
    void submit(event, async (form) => {
      const data = formData(form);
      const response = await request('/api/v1/sessions', {
        method: 'POST',
        body: compact({
          email: data.email,
          password: data.password,
          recoveryCode: data.recoveryCode,
          totpCode: data.totpCode,
        }),
      });
      form.reset();
      showSession(/** @type {Record<string,any>} */ (response.data));
      announce('Sessão iniciada com segurança.');
    }),
);
elements.inviteForm.addEventListener(
  'submit',
  (event) =>
    void submit(event, async (form) => {
      const data = formData(form);
      await request('/api/v1/invitations/accept', {
        method: 'POST',
        body: { password: data.password, token: data.token },
      });
      form.reset();
      selectTab('login');
      announce('Conta ativada. Entre com seu e-mail e a senha criada.');
    }),
);
elements.logout.addEventListener(
  'click',
  () =>
    void withBusy(elements.logout, async () => {
      try {
        await request('/api/v1/sessions/current', { method: 'DELETE' });
      } finally {
        showSignedOut();
        announce('Sessão encerrada.');
      }
    }),
);
elements.navToggle.addEventListener('click', () => {
  const expanded = elements.navToggle.getAttribute('aria-expanded') === 'true';
  elements.navToggle.setAttribute('aria-expanded', String(!expanded));
  elements.mobileNav.hidden = expanded;
});
document.addEventListener('click', (event) => {
  const anchor =
    event.target instanceof globalThis.Element
      ? event.target.closest('a[data-route]')
      : null;
  if (!anchor || !session) return;
  event.preventDefault();
  navigate(anchor.getAttribute('href') ?? '/kanban');
});
globalThis.addEventListener('popstate', () => renderRoute());
void restoreSession();

async function restoreSession() {
  try {
    const response = await request('/api/v1/sessions/current');
    showSession(/** @type {Record<string,any>} */ (response.data), false);
    announce('Sessão restaurada.');
  } catch {
    showSignedOut(false);
    announce('Entre para continuar.');
  }
}
/** @param {Record<string,any>} value @param {boolean} [replace] */
function showSession(value, replace = true) {
  session = value;
  elements.publicShell.hidden = true;
  elements.applicationShell.hidden = false;
  elements.signedOut.hidden = true;
  const user = value.user ?? value;
  const functionName = String(
    value.functionName ?? user.functionName ?? 'Conta autenticada',
  );
  elements.summary.textContent = functionName;
  if (replace && globalThis.location.pathname === '/')
    globalThis.history.replaceState({}, '', '/kanban');
  renderRoute();
  stream.start();
}
/** @param {boolean} [focus] */
function showSignedOut(focus = true) {
  session = null;
  stream.close();
  activeView?.dispose();
  activeView = null;
  elements.outlet.replaceChildren();
  elements.applicationShell.hidden = true;
  elements.publicShell.hidden = false;
  elements.signedOut.hidden = false;
  clearError();
  if (globalThis.location.pathname !== '/')
    globalThis.history.replaceState({}, '', '/');
  if (focus) elements.loginPanel.querySelector('h2')?.focus();
}
/** @param {string} path */
function navigate(path) {
  if (globalThis.location.pathname !== path)
    globalThis.history.pushState({}, '', path);
  elements.mobileNav.hidden = true;
  elements.navToggle.setAttribute('aria-expanded', 'false');
  renderRoute();
}
function renderRoute() {
  if (!session) return;
  activeView?.dispose();
  activeView = null;
  clearError();
  const pathname = globalThis.location.pathname;
  const match = pathname.match(/^\/negocios\/([^/]+)$/);
  for (const link of document.querySelectorAll('[data-nav]'))
    link.toggleAttribute(
      'aria-current',
      (pathname.startsWith('/negocios/') &&
        link.getAttribute('data-nav') === 'kanban') ||
        pathname.slice(1) === link.getAttribute('data-nav'),
    );
  const context = {
    navigate,
    announce,
    showError,
    onCursor(/** @type {string} */ cursor) {
      if (cursor && !stream.cursor) stream.cursor = cursor;
    },
  };
  if (match)
    activeView = createDealDetailView(
      elements.outlet,
      decodeURIComponent(match[1]),
      context,
    );
  else if (pathname === '/conta') renderAccount();
  else {
    if (pathname !== '/kanban')
      globalThis.history.replaceState({}, '', '/kanban');
    activeView = createKanbanView(elements.outlet, context);
  }
}
function renderAccount() {
  const value = session ?? {};
  const user = value.user ?? value;
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities
    : Array.isArray(user.capabilities)
      ? user.capabilities
      : [];
  const h1 = el('h1', { tabindex: '-1', text: 'Conta e segurança' });
  const mfa = /** @type {HTMLFormElement} */ (
    el(
      'form',
      {},
      el('label', { for: 'mfa-reason', text: 'Motivo do cadastro' }),
      el('input', {
        id: 'mfa-reason',
        name: 'reason',
        value: 'Proteger acesso privilegiado',
        required: true,
      }),
      el('button', { type: 'submit', text: 'Cadastrar autenticador' }),
    )
  );
  const result = el('div', { class: 'one-time', tabindex: '-1', hidden: true });
  mfa.addEventListener(
    'submit',
    (event) =>
      void submit(event, async (form, button) => {
        const key = globalThis.crypto.randomUUID();
        const response = await withBusy(button, () =>
          request('/api/v1/mfa/enrollments', {
            method: 'POST',
            idempotencyKey: key,
            body: {
              reason: String(new globalThis.FormData(form).get('reason')),
            },
          }),
        );
        const data = /** @type {Record<string,any>} */ (response.data);
        result.replaceChildren(
          el('h3', { text: 'Guarde estas informações agora' }),
          el('p', { text: `Segredo: ${String(data.secret ?? '')}` }),
          el(
            'ul',
            {},
            ...(Array.isArray(data.recoveryCodes)
              ? data.recoveryCodes
              : []
            ).map((code) => el('li', { text: String(code) })),
          ),
        );
        result.hidden = false;
        result.focus();
        announce('Autenticador cadastrado. Guarde os códigos de recuperação.');
      }),
  );
  const sections = [
    el(
      'section',
      { class: 'surface' },
      el('h2', { text: 'Sessão ativa' }),
      el('p', {
        text: `Função: ${String(value.functionName ?? user.functionName ?? 'não informada')}.`,
      }),
      el('p', {
        text: capabilities.length
          ? `Capacidades: ${capabilities.join(', ')}.`
          : 'Sem capacidades administrativas.',
      }),
    ),
    el(
      'section',
      { class: 'surface' },
      el('h2', { text: 'Verificação em duas etapas' }),
      el('p', {
        text: 'Proteja ações privilegiadas com um autenticador TOTP.',
      }),
      mfa,
      result,
    ),
  ];
  elements.outlet.replaceChildren(
    el(
      'div',
      { class: 'page account-page' },
      el(
        'header',
        { class: 'page-heading' },
        el('div', {}, el('p', { class: 'eyebrow', text: 'Preferências' }), h1),
      ),
      ...sections,
    ),
  );
  h1.focus();
}
/** @param {SubmitEvent} event @param {(form:HTMLFormElement,button:HTMLElement)=>Promise<void>} action */
async function submit(event, action) {
  event.preventDefault();
  clearError();
  const form = /** @type {HTMLFormElement} */ (event.currentTarget);
  const button = /** @type {HTMLElement} */ (
    event.submitter ?? form.querySelector('button[type="submit"]')
  );
  try {
    await withBusy(button, () => action(form, button));
  } catch (error) {
    showError(publicMessage(error));
  }
}
/** @param {'login'|'invite'} selected @param {boolean} [moveFocus] */
function selectTab(selected, moveFocus = true) {
  const login = selected === 'login';
  elements.loginTab.setAttribute('aria-selected', String(login));
  elements.loginTab.tabIndex = login ? 0 : -1;
  elements.inviteTab.setAttribute('aria-selected', String(!login));
  elements.inviteTab.tabIndex = login ? -1 : 0;
  elements.loginPanel.hidden = !login;
  elements.invitePanel.hidden = login;
  if (moveFocus)
    (login ? elements.loginPanel : elements.invitePanel)
      .querySelector('h2')
      ?.focus();
}
/** @param {string} message */
function announce(message) {
  if (message === lastAnnouncement) return;
  lastAnnouncement = message;
  elements.status.textContent = '';
  globalThis.setTimeout(() => {
    elements.status.textContent = message;
  }, 20);
}
/** @param {string} message @param {boolean} [focus] */
function showError(message, focus = true) {
  elements.error.textContent = message;
  elements.error.hidden = false;
  if (focus) elements.error.focus();
}
function clearError() {
  elements.error.hidden = true;
  elements.error.textContent = '';
}
/** @param {unknown} error */
function publicMessage(error) {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_CREDENTIALS')
      return 'Não foi possível entrar com os dados informados.';
    if (error.status === 403)
      return 'Você não tem permissão para concluir esta ação.';
  }
  return 'Não foi possível concluir. Revise os dados e tente novamente.';
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
/** @param {Record<string,unknown>} value */
function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== '' && item !== undefined,
    ),
  );
}
