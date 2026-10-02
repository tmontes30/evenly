// Lógica pura de dinero y saldos (sin Firebase).
// Todos los montos se guardan como enteros en la unidad mínima de la moneda
// (CLP: pesos; USD/EUR: centavos) para que las divisiones cuadren exacto.

const LOCALE = 'es-CL';

export function currencyDigits(currency) {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency })
    .resolvedOptions().maximumFractionDigits;
}

export function formatMoney(amount, currency = 'CLP') {
  const d = currencyDigits(currency);
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d,
  }).format((amount || 0) / 10 ** d);
}

// "4.300.000" -> 4300000 (CLP) · "12,50" -> 1250 (USD)
export function parseMoney(text, currency = 'CLP') {
  const d = currencyDigits(currency);
  let s = String(text ?? '').replace(/[^\d.,-]/g, '');
  if (d === 0) {
    s = s.replace(/[.,]/g, '');
  } else {
    const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    if (lastSep >= 0 && s.length - lastSep - 1 <= d) {
      s = s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep + 1);
    } else {
      s = s.replace(/[.,]/g, '');
    }
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 10 ** d) : NaN;
}

// Valor para mostrar en un <input> al editar.
export function moneyToInput(amount, currency = 'CLP') {
  const d = currencyDigits(currency);
  return d === 0 ? String(amount) : (amount / 10 ** d).toFixed(d).replace('.', ',');
}

// Divide en partes iguales; el resto (unidades sobrantes) va a los primeros.
export function splitAmount(amount, ids) {
  const n = ids.length;
  const out = {};
  if (!n) return out;
  const base = Math.floor(amount / n);
  const rem = amount - base * n;
  ids.forEach((id, i) => { out[id] = base + (i < rem ? 1 : 0); });
  return out;
}

// Saldo por persona:
//   net = pagó − le corresponde + pagos hechos − pagos recibidos
//   net > 0 → le deben · net < 0 → debe
export function computeBalances(people, expenses, payments) {
  const map = new Map();
  const blank = (id, name) => ({ id, name, paid: 0, share: 0, sent: 0, received: 0, net: 0 });
  for (const p of people) map.set(p.id, blank(p.id, p.name));
  const get = (id) => {
    if (!map.has(id)) map.set(id, blank(id, '(eliminado)'));
    return map.get(id);
  };

  for (const e of expenses) {
    const ids = e.splitAmong || [];
    if (!e.amount || !ids.length) continue;
    get(e.paidBy).paid += e.amount;
    const shares = splitAmount(e.amount, ids);
    for (const id of ids) get(id).share += shares[id];
  }
  for (const p of payments) {
    if (!p.amount) continue;
    get(p.from).sent += p.amount;
    get(p.to).received += p.amount;
  }
  for (const b of map.values()) b.net = b.paid - b.share + b.sent - b.received;
  return [...map.values()];
}

// Quién le paga a quién para quedar a mano (greedy, pocas transferencias).
export function settleUp(balances) {
  const debtors = balances.filter((b) => b.net < 0).map((b) => ({ id: b.id, left: -b.net }))
    .sort((a, b) => b.left - a.left);
  const creditors = balances.filter((b) => b.net > 0).map((b) => ({ id: b.id, left: b.net }))
    .sort((a, b) => b.left - a.left);
  const out = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].left, creditors[j].left);
    if (amount > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount });
    debtors[i].left -= amount;
    creditors[j].left -= amount;
    if (!debtors[i].left) i++;
    if (!creditors[j].left) j++;
  }
  return out;
}
