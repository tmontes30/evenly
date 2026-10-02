import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where,
  serverTimestamp, writeBatch, arrayUnion, arrayRemove,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import {
  computeBalances, settleUp, formatMoney, parseMoney, moneyToInput,
} from './balance.js';

const TABS = [
  ['resumen', 'Resumen'],
  ['gastos', 'Gastos'],
  ['pagos', 'Pagos'],
  ['ajustes', 'Grupo'],
];
const CURRENCIES = ['CLP', 'USD', 'EUR', 'ARS', 'PEN', 'MXN', 'COP', 'BRL'];

const ICON = {
  edit: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 12h14m-6-6 6 6-6 6"/></svg>',
};

// ---------- helpers ----------
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
};
const initial = (name) => esc((name || '?').trim().charAt(0).toUpperCase());
const millis = (ts) => (ts && ts.toMillis ? ts.toMillis() : Date.now());
const byRecent = (a, b) => (b.date || '').localeCompare(a.date || '') || millis(b.createdAt) - millis(a.createdAt);

function friendly(err) {
  if (err?.code === 'permission-denied') return 'No tienes permiso para hacer esto.';
  if (err?.code === 'unavailable') return 'Sin conexión. Inténtalo de nuevo.';
  return err?.message || String(err);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- config check ----------
if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('TU_')) {
  $('#boot').innerHTML = `<div class="login-card"><h1 class="login-title">Falta configurar Firebase</h1>
    <p class="muted">Pega la configuración de tu proyecto en <code>firebase-config.js</code>. Los pasos están en el README.</p></div>`;
  throw new Error('firebase-config.js sin completar');
}

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

// ---------- state ----------
const state = {
  user: null,
  groups: [],
  groupsLoaded: false,
  groupsUnsub: null,
  gid: null,
  tab: 'resumen',
  group: null,
  groupError: null,
  people: [],
  expenses: [],
  payments: [],
  groupUnsubs: [],
};

const fmt = (amount) => formatMoney(amount, state.group?.currency || 'CLP');
const parse = (text) => parseMoney(text, state.group?.currency || 'CLP');
const personName = (id) => state.people.find((p) => p.id === id)?.name ?? '(eliminado)';
const sortedPeople = () => [...state.people].sort((a, b) => a.name.localeCompare(b.name, 'es'));
const groupRef = () => doc(db, 'groups', state.gid);

// ---------- auth ----------
$('#login-btn').addEventListener('click', async () => {
  $('#login-error').textContent = '';
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') $('#login-error').textContent = friendly(err);
  }
});
$('#logout-btn').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  state.user = user;
  $('#boot').hidden = true;
  $('#login-view').hidden = !!user;
  $('#app-view').hidden = !user;
  state.groupsUnsub?.();
  state.groupsUnsub = null;
  unsubGroup();
  if (!user) return;

  $('#user-email').textContent = user.email;
  const photo = $('#user-photo');
  photo.hidden = !user.photoURL;
  if (user.photoURL) photo.src = user.photoURL;

  state.groupsLoaded = false;
  state.groupsUnsub = onSnapshot(
    query(collection(db, 'groups'), where('memberEmails', 'array-contains', user.email)),
    (qs) => {
      state.groups = qs.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
      state.groupsLoaded = true;
      if (!state.gid) render();
    },
    (err) => toast(friendly(err)),
  );
  route();
});

// ---------- routing ----------
window.addEventListener('hashchange', route);

function route() {
  if (!state.user) return;
  const m = location.hash.match(/^#\/g\/([^/]+)(?:\/(\w+))?/);
  const gid = m ? m[1] : null;
  state.tab = m && TABS.some(([k]) => k === m[2]) ? m[2] : 'resumen';
  if (gid !== state.gid) {
    unsubGroup();
    if (gid) subscribeGroup(gid);
  }
  render();
  window.scrollTo(0, 0);
}

function unsubGroup() {
  state.groupUnsubs.forEach((u) => u());
  Object.assign(state, {
    groupUnsubs: [], gid: null, group: null, groupError: null, people: [], expenses: [], payments: [],
  });
}

function subscribeGroup(gid) {
  state.gid = gid;
  const ref = doc(db, 'groups', gid);
  const onErr = (err) => { state.groupError = err; render(); };
  state.groupUnsubs.push(onSnapshot(ref, (s) => {
    if (!s.exists()) { location.hash = '#/'; return; }
    state.group = { id: s.id, ...s.data() };
    render();
  }, onErr));
  for (const name of ['people', 'expenses', 'payments']) {
    state.groupUnsubs.push(onSnapshot(collection(ref, name), (qs) => {
      state[name] = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, onErr));
  }
}

// ---------- render ----------
const main = $('#main');

function render() {
  if (!state.user) return;
  main.innerHTML = state.gid ? renderGroup() : renderGroups();
}

function renderGroups() {
  if (!state.groupsLoaded) return '<div class="loading"><div class="spinner"></div></div>';
  const cards = state.groups.map((g) => `
    <a class="card group-card" href="#/g/${esc(g.id)}/resumen">
      <span class="avatar lg">${initial(g.name)}</span>
      <span class="group-card-body">
        <span class="group-card-title">${esc(g.name)}</span>
        <span class="muted small">${g.memberEmails.length} ${g.memberEmails.length === 1 ? 'persona con acceso' : 'personas con acceso'} · ${esc(g.currency)}</span>
      </span>
      <span class="chev">${ICON.arrow}</span>
    </a>`).join('');
  return `
    <section class="page-head">
      <div><h1>Tus grupos</h1><p class="muted">Matri, viajes, depto, asados… cada uno con sus cuentas.</p></div>
      <button class="btn primary" data-action="new-group">+ Nuevo grupo</button>
    </section>
    ${cards ? `<div class="group-grid">${cards}</div>` : `
      <div class="empty card">
        <h3>Todavía no tienes grupos</h3>
        <p class="muted">Crea uno para empezar a anotar gastos. Si alguien te invitó, pídele que agregue tu email (${esc(state.user.email)}).</p>
        <button class="btn primary" data-action="new-group">Crear mi primer grupo</button>
      </div>`}`;
}

function renderGroup() {
  if (state.groupError) {
    return `<div class="empty card">
      <h3>No puedes ver este grupo</h3>
      <p class="muted">No existe o tu email (${esc(state.user.email)}) no tiene acceso.</p>
      <a class="btn" href="#/">Volver a mis grupos</a></div>`;
  }
  if (!state.group) return '<div class="loading"><div class="spinner"></div></div>';
  const g = state.group;
  const tabs = TABS.map(([k, label]) => `
    <a href="#/g/${esc(g.id)}/${k}" class="tab ${state.tab === k ? 'active' : ''}">${label}</a>`).join('');
  const body = {
    resumen: renderSummary, gastos: renderExpenses, pagos: renderPayments, ajustes: renderSettings,
  }[state.tab]();
  return `
    <section class="group-head">
      <a href="#/" class="back" aria-label="Volver">${ICON.back}</a>
      <h1>${esc(g.name)}</h1>
    </section>
    <nav class="tabs">${tabs}</nav>
    ${body}`;
}

function needPeople() {
  return `<div class="empty card">
    <h3>Agrega a las personas del grupo</h3>
    <p class="muted">Primero define quiénes participan en los gastos.</p>
    <a class="btn primary" href="#/g/${esc(state.gid)}/ajustes">Agregar personas</a></div>`;
}

function renderSummary() {
  if (!state.people.length) return needPeople();
  const balances = computeBalances(state.people, state.expenses, state.payments)
    .sort((a, b) => b.net - a.net);
  const transfers = settleUp(balances);
  const total = state.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const paidBack = state.payments.reduce((s, p) => s + (p.amount || 0), 0);
  const pending = transfers.reduce((s, t) => s + t.amount, 0);

  const settleList = transfers.length ? `<ul class="list">${transfers.map((t) => `
    <li class="settle">
      <div class="settle-who">
        <span class="avatar">${initial(personName(t.from))}</span>
        <span><b>${esc(personName(t.from))}</b> le debe a <b>${esc(personName(t.to))}</b></span>
      </div>
      <span class="amount neg">${fmt(t.amount)}</span>
      <button class="btn sm" data-action="settle" data-from="${esc(t.from)}" data-to="${esc(t.to)}" data-amount="${t.amount}">Registrar pago</button>
    </li>`).join('')}</ul>`
    : `<div class="all-even"><b>¡Están todos a mano!</b><span class="muted">Nadie le debe nada a nadie.</span></div>`;

  const cards = balances.map((b) => {
    const cls = b.net > 0 ? 'pos' : b.net < 0 ? 'neg' : '';
    const label = b.net > 0 ? `Le deben ${fmt(b.net)}` : b.net < 0 ? `Debe ${fmt(-b.net)}` : 'A mano';
    return `<div class="card person">
      <div class="person-head">
        <span class="avatar">${initial(b.name)}</span>
        <b>${esc(b.name)}</b>
        <span class="badge ${cls}">${label}</span>
      </div>
      <dl class="rows">
        <div><dt>Pagó en gastos</dt><dd>${fmt(b.paid)}</dd></div>
        <div><dt>Le corresponde</dt><dd>${fmt(b.share)}</dd></div>
        <div><dt>Pagos hechos</dt><dd>${fmt(b.sent)}</dd></div>
        <div><dt>Pagos recibidos</dt><dd>${fmt(b.received)}</dd></div>
      </dl>
    </div>`;
  }).join('');

  return `
    <div class="stats">
      <div class="card stat"><span class="muted small">Gasto total</span><strong>${fmt(total)}</strong><span class="muted small">${state.expenses.length} gastos</span></div>
      <div class="card stat"><span class="muted small">Ya devuelto</span><strong>${fmt(paidBack)}</strong><span class="muted small">${state.payments.length} pagos</span></div>
      <div class="card stat"><span class="muted small">Pendiente</span><strong class="${pending ? 'neg' : 'pos'}">${fmt(pending)}</strong><span class="muted small">para quedar a mano</span></div>
    </div>
    <section class="section">
      <div class="section-head"><h2>Para quedar a mano</h2></div>
      <div class="card">${settleList}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Detalle por persona</h2></div>
      <div class="person-grid">${cards}</div>
    </section>`;
}

function splitLabel(ids) {
  if (ids.length === state.people.length && state.people.every((p) => ids.includes(p.id))) return 'entre todos';
  return `entre ${ids.map((id) => esc(personName(id))).join(', ')}`;
}

function renderExpenses() {
  if (!state.people.length) return needPeople();
  const items = [...state.expenses].sort(byRecent).map((e) => `
    <li class="item">
      <div class="item-main">
        <div class="item-title">${esc(e.description)}</div>
        <div class="item-sub muted small">${fmtDate(e.date)} · Pagó <b>${esc(personName(e.paidBy))}</b> · ${splitLabel(e.splitAmong || [])}</div>
      </div>
      <div class="item-amount">${fmt(e.amount)}</div>
      <div class="item-actions">
        <button class="icon-btn" data-action="edit-expense" data-id="${esc(e.id)}" title="Editar">${ICON.edit}</button>
        <button class="icon-btn danger" data-action="del-expense" data-id="${esc(e.id)}" title="Eliminar">${ICON.trash}</button>
      </div>
    </li>`).join('');
  return `
    <div class="section-head">
      <h2>Gastos</h2>
      <button class="btn primary" data-action="add-expense">+ Agregar gasto</button>
    </div>
    ${items ? `<ul class="card list">${items}</ul>`
    : '<div class="empty card"><h3>Sin gastos todavía</h3><p class="muted">Anota quién pagó qué y entre quiénes se divide.</p></div>'}`;
}

function renderPayments() {
  if (!state.people.length) return needPeople();
  const items = [...state.payments].sort(byRecent).map((p) => `
    <li class="item">
      <div class="item-main">
        <div class="item-title"><b>${esc(personName(p.from))}</b> <span class="muted">${ICON.arrow}</span> <b>${esc(personName(p.to))}</b></div>
        <div class="item-sub muted small">${fmtDate(p.date)}${p.note ? ` · ${esc(p.note)}` : ''}</div>
      </div>
      <div class="item-amount">${fmt(p.amount)}</div>
      <div class="item-actions">
        <button class="icon-btn" data-action="edit-payment" data-id="${esc(p.id)}" title="Editar">${ICON.edit}</button>
        <button class="icon-btn danger" data-action="del-payment" data-id="${esc(p.id)}" title="Eliminar">${ICON.trash}</button>
      </div>
    </li>`).join('');
  return `
    <div class="section-head">
      <h2>Pagos</h2>
      <button class="btn primary" data-action="add-payment">+ Registrar pago</button>
    </div>
    ${items ? `<ul class="card list">${items}</ul>`
    : '<div class="empty card"><h3>Sin pagos todavía</h3><p class="muted">Cuando alguien le devuelva plata a otro, regístralo aquí.</p></div>'}`;
}

function renderSettings() {
  const g = state.group;
  const isOwner = g.ownerEmail === state.user.email;
  const hasMoves = state.expenses.length || state.payments.length;
  const people = sortedPeople().map((p) => `
    <li class="item">
      <div class="item-main item-person"><span class="avatar">${initial(p.name)}</span><span>${esc(p.name)}</span></div>
      <div class="item-actions">
        <button class="icon-btn" data-action="rename-person" data-id="${esc(p.id)}" title="Renombrar">${ICON.edit}</button>
        <button class="icon-btn danger" data-action="del-person" data-id="${esc(p.id)}" title="Eliminar">${ICON.trash}</button>
      </div>
    </li>`).join('');
  const emails = g.memberEmails.map((e) => `
    <li class="item">
      <div class="item-main"><span>${esc(e)}</span>${e === g.ownerEmail ? ' <span class="badge">Creador</span>' : ''}</div>
      <div class="item-actions">
        ${e === g.ownerEmail ? '' : `<button class="icon-btn danger" data-action="del-email" data-email="${esc(e)}" title="Quitar acceso">${ICON.trash}</button>`}
      </div>
    </li>`).join('');

  return `
    <section class="section">
      <div class="section-head"><h2>Personas</h2></div>
      <p class="muted small">Quienes participan en los gastos. No necesitan cuenta.</p>
      <div class="card">
        ${people ? `<ul class="list">${people}</ul>` : ''}
        <form class="inline-form" data-form="add-person">
          <input name="name" placeholder="Nombre (ej: Cata)" required maxlength="40" autocomplete="off">
          <button class="btn primary">Agregar</button>
        </form>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Acceso</h2></div>
      <p class="muted small">Emails de Google que pueden ver y editar este grupo.</p>
      <div class="card">
        <ul class="list">${emails}</ul>
        <form class="inline-form" data-form="add-email">
          <input name="email" type="email" placeholder="email@gmail.com" required autocomplete="off">
          <button class="btn primary">Dar acceso</button>
        </form>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Grupo</h2></div>
      <div class="card">
        <form class="stack-form" data-form="group-settings">
          <label>Nombre<input name="name" value="${esc(g.name)}" required maxlength="60"></label>
          <label>Moneda
            <select name="currency" ${hasMoves ? 'disabled' : ''}>
              ${CURRENCIES.map((c) => `<option ${c === g.currency ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
            ${hasMoves ? '<span class="muted small">No se puede cambiar cuando ya hay gastos o pagos.</span>' : ''}
          </label>
          <div><button class="btn primary">Guardar</button></div>
        </form>
      </div>
    </section>

    ${isOwner ? `<section class="section">
      <div class="card danger-zone">
        <div><b>Eliminar grupo</b><p class="muted small">Borra el grupo con todos sus gastos y pagos. No se puede deshacer.</p></div>
        <button class="btn danger" data-action="delete-group">Eliminar</button>
      </div>
    </section>` : ''}`;
}

// ---------- dialog ----------
const dlg = $('#dlg');

function openDialog({ title, body, submitLabel = 'Guardar', onSubmit, onOpen }) {
  dlg.innerHTML = `
    <form class="dlg">
      <h2>${title}</h2>
      ${body}
      <p class="form-error"></p>
      <div class="dlg-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${submitLabel}</button>
      </div>
    </form>`;
  const form = $('form', dlg);
  const errEl = $('.form-error', form);
  $('[data-close]', form).addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('[type=submit]', form);
    btn.disabled = true;
    errEl.textContent = '';
    try {
      await onSubmit(new FormData(form), form);
      dlg.close();
    } catch (err) {
      errEl.textContent = friendly(err);
    } finally {
      btn.disabled = false;
    }
  });
  onOpen?.(form);
  dlg.showModal();
}
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

const personOptions = (selected) => sortedPeople().map((p) => `
  <option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

function readAmount(fd) {
  const amount = parse(fd.get('amount'));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Ingresa un monto válido mayor a 0.');
  return amount;
}

function newGroupDialog() {
  openDialog({
    title: 'Nuevo grupo',
    submitLabel: 'Crear grupo',
    body: `
      <label>Nombre<input name="name" required maxlength="60" placeholder="Ej: Matri, Viaje al sur" autocomplete="off"></label>
      <label>Moneda<select name="currency">${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label>Personas <span class="muted small">(una por línea, opcional)</span>
        <textarea name="people" rows="3" placeholder="Tomás&#10;Cata"></textarea></label>`,
    onSubmit: async (fd) => {
      const name = fd.get('name').trim();
      if (!name) throw new Error('Ponle un nombre al grupo.');
      const ref = await addDoc(collection(db, 'groups'), {
        name,
        currency: fd.get('currency'),
        ownerEmail: state.user.email,
        memberEmails: [state.user.email],
        createdAt: serverTimestamp(),
      });
      const names = [...new Set(fd.get('people').split('\n').map((s) => s.trim()).filter(Boolean))];
      if (names.length) {
        const batch = writeBatch(db);
        names.forEach((n) => batch.set(doc(collection(ref, 'people')), { name: n, createdAt: serverTimestamp() }));
        await batch.commit();
      }
      location.hash = `#/g/${ref.id}/${names.length ? 'resumen' : 'ajustes'}`;
    },
  });
}

function expenseDialog(expense) {
  const all = state.people.map((p) => p.id);
  const split = expense?.splitAmong ?? all;
  openDialog({
    title: expense ? 'Editar gasto' : 'Nuevo gasto',
    body: `
      <label>Descripción<input name="description" required maxlength="80" placeholder="Ej: Banquetera, fotógrafo" value="${esc(expense?.description)}" autocomplete="off"></label>
      <div class="row-2">
        <label>Monto<input name="amount" required inputmode="decimal" placeholder="0" value="${expense ? esc(moneyToInput(expense.amount, state.group.currency)) : ''}" autocomplete="off"></label>
        <label>Fecha<input name="date" type="date" required value="${esc(expense?.date || today())}"></label>
      </div>
      <label>¿Quién pagó?<select name="paidBy" required>${personOptions(expense?.paidBy)}</select></label>
      <fieldset class="checks">
        <legend>Dividir en partes iguales entre <button type="button" class="link" data-toggle-all>Todos / ninguno</button></legend>
        ${sortedPeople().map((p) => `
          <label class="check"><input type="checkbox" name="split" value="${esc(p.id)}" ${split.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}
        <p class="muted small" data-split-hint></p>
      </fieldset>`,
    onOpen: (form) => {
      const boxes = [...form.querySelectorAll('input[name=split]')];
      const hint = $('[data-split-hint]', form);
      const update = () => {
        const n = boxes.filter((b) => b.checked).length;
        const amount = parse(form.amount.value);
        hint.textContent = n && amount > 0 ? `${fmt(Math.floor(amount / n))} c/u aprox. (${n} ${n === 1 ? 'persona' : 'personas'})` : '';
      };
      $('[data-toggle-all]', form).addEventListener('click', () => {
        const allOn = boxes.every((b) => b.checked);
        boxes.forEach((b) => { b.checked = !allOn; });
        update();
      });
      form.addEventListener('input', update);
      update();
    },
    onSubmit: async (fd) => {
      const splitAmong = fd.getAll('split');
      if (!splitAmong.length) throw new Error('Elige al menos una persona para dividir.');
      const data = {
        description: fd.get('description').trim(),
        amount: readAmount(fd),
        paidBy: fd.get('paidBy'),
        splitAmong,
        date: fd.get('date'),
      };
      if (expense) {
        await updateDoc(doc(groupRef(), 'expenses', expense.id), data);
      } else {
        await addDoc(collection(groupRef(), 'expenses'), {
          ...data, createdBy: state.user.email, createdAt: serverTimestamp(),
        });
        toast('Gasto agregado');
      }
    },
  });
}

function paymentDialog(payment, preset = {}) {
  const p = payment || preset;
  openDialog({
    title: payment ? 'Editar pago' : 'Registrar pago',
    body: `
      <div class="row-2">
        <label>Paga<select name="from" required>${personOptions(p.from)}</select></label>
        <label>Recibe<select name="to" required>${personOptions(p.to ?? sortedPeople()[1]?.id)}</select></label>
      </div>
      <div class="row-2">
        <label>Monto<input name="amount" required inputmode="decimal" placeholder="0" value="${p.amount ? esc(moneyToInput(p.amount, state.group.currency)) : ''}" autocomplete="off"></label>
        <label>Fecha<input name="date" type="date" required value="${esc(p.date || today())}"></label>
      </div>
      <label>Nota <span class="muted small">(opcional)</span><input name="note" maxlength="80" placeholder="Ej: transferencia" value="${esc(p.note)}" autocomplete="off"></label>`,
    onSubmit: async (fd) => {
      const data = {
        from: fd.get('from'),
        to: fd.get('to'),
        amount: readAmount(fd),
        date: fd.get('date'),
        note: fd.get('note').trim(),
      };
      if (data.from === data.to) throw new Error('Quien paga y quien recibe deben ser distintos.');
      if (payment) {
        await updateDoc(doc(groupRef(), 'payments', payment.id), data);
      } else {
        await addDoc(collection(groupRef(), 'payments'), {
          ...data, createdBy: state.user.email, createdAt: serverTimestamp(),
        });
        toast('Pago registrado');
      }
    },
  });
}

function renamePersonDialog(person) {
  openDialog({
    title: 'Renombrar persona',
    body: `<label>Nombre<input name="name" required maxlength="40" value="${esc(person.name)}" autocomplete="off"></label>`,
    onSubmit: async (fd) => {
      await updateDoc(doc(groupRef(), 'people', person.id), { name: fd.get('name').trim() });
    },
  });
}

// ---------- actions ----------
async function run(fn) {
  try { await fn(); } catch (err) { toast(friendly(err)); }
}

main.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const find = (list) => state[list].find((x) => x.id === id);

  switch (action) {
    case 'new-group': return newGroupDialog();
    case 'add-expense': return expenseDialog();
    case 'edit-expense': return expenseDialog(find('expenses'));
    case 'add-payment': return paymentDialog();
    case 'edit-payment': return paymentDialog(find('payments'));
    case 'settle':
      return paymentDialog(null, { from: el.dataset.from, to: el.dataset.to, amount: Number(el.dataset.amount) });
    case 'rename-person': return renamePersonDialog(find('people'));
    case 'del-expense':
      if (confirm('¿Eliminar este gasto?')) run(() => deleteDoc(doc(groupRef(), 'expenses', id)));
      return;
    case 'del-payment':
      if (confirm('¿Eliminar este pago?')) run(() => deleteDoc(doc(groupRef(), 'payments', id)));
      return;
    case 'del-person': {
      const used = state.expenses.some((x) => x.paidBy === id || (x.splitAmong || []).includes(id))
        || state.payments.some((x) => x.from === id || x.to === id);
      if (used) return toast('No se puede eliminar: tiene gastos o pagos asociados.');
      if (confirm(`¿Eliminar a ${personName(id)}?`)) run(() => deleteDoc(doc(groupRef(), 'people', id)));
      return;
    }
    case 'del-email': {
      const email = el.dataset.email;
      const self = email === state.user.email;
      const msg = self ? 'Si te quitas, dejarás de ver este grupo. ¿Seguro?' : `¿Quitar el acceso a ${email}?`;
      if (confirm(msg)) {
        run(async () => {
          await updateDoc(groupRef(), { memberEmails: arrayRemove(email) });
          if (self) location.hash = '#/';
        });
      }
      return;
    }
    case 'delete-group':
      if (!confirm(`¿Eliminar "${state.group.name}" con todos sus gastos y pagos? No se puede deshacer.`)) return;
      run(async () => {
        const ref = groupRef();
        const docs = ['people', 'expenses', 'payments'].flatMap((n) => state[n].map((x) => doc(ref, n, x.id)));
        for (let i = 0; i < docs.length; i += 400) {
          const batch = writeBatch(db);
          docs.slice(i, i + 400).forEach((d) => batch.delete(d));
          await batch.commit();
        }
        location.hash = '#/';
        await deleteDoc(ref);
        toast('Grupo eliminado');
      });
      return;
    default:
  }
});

main.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  switch (form.dataset.form) {
    case 'add-person': {
      const name = fd.get('name').trim();
      if (!name) return;
      if (state.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        toast('Ya hay alguien con ese nombre.');
        return;
      }
      run(() => addDoc(collection(groupRef(), 'people'), { name, createdAt: serverTimestamp() }));
      return;
    }
    case 'add-email': {
      const email = fd.get('email').trim().toLowerCase();
      if (!email) return;
      run(async () => {
        await updateDoc(groupRef(), { memberEmails: arrayUnion(email) });
        toast(`${email} ahora tiene acceso`);
      });
      return;
    }
    case 'group-settings': {
      const data = { name: fd.get('name').trim() };
      if (fd.get('currency')) data.currency = fd.get('currency');
      run(async () => {
        await updateDoc(groupRef(), data);
        toast('Cambios guardados');
      });
      return;
    }
    default:
  }
});
