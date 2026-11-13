// The account picker in the menu header: switch player, add one (optional PIN), delete one.
import { accounts, switchTo, createAccount, deleteAccount } from '../core/accounts.js?v=b95fbae-mwewwzt6';

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) if (k) e.append(k);
  return e;
}
// root: an empty element. reload: called after a switch (reloads the page).
export function mountAccounts(root, reload = () => location.reload()) {
  const box = el('details', { class: 'acct' });
  const summary = el('summary', { class: 'acct-name' });
  const panel = el('div', { class: 'acct-panel' });
  const msg = el('p', { class: 'small', role: 'status' });
  box.append(summary, panel); root.append(box);
  const pinBox = (label) => el('input', { type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: label, 'aria-label': label, class: 'acct-pin' });
  const go = (fn) => { try { if (fn()) reload(); else render(); } catch (e) { msg.textContent = e.message; } };
  function render() {
    const A = accounts();
    summary.textContent = 'Player: ' + A.current;
    const rows = A.list.map((a) => {
      if (a.name === A.current) return el('div', { class: 'acct-row on' }, el('b', { text: a.name + (a.locked ? ' (PIN)' : '') }), el('span', { class: 'small', text: 'playing now' }));
      const pin = a.locked ? pinBox('PIN') : null;
      let armed = false;
      const del = el('button', { type: 'button', text: 'Delete', onclick: () => {
        if (!armed) { armed = true; del.textContent = 'Delete ' + a.name + '\'s progress?'; setTimeout(() => { armed = false; del.textContent = 'Delete'; }, 3000); return; }
        go(() => { deleteAccount(a.name, pin?.value || ''); return false; });
      } });
      return el('div', { class: 'acct-row' }, el('span', { text: a.name }), pin,
        el('button', { type: 'button', class: 'primary', text: 'Switch', onclick: () => go(() => switchTo(a.name, pin?.value || '')) }), del);
    });
    const name = el('input', { type: 'text', maxlength: '16', placeholder: 'New player name', 'aria-label': 'New player name' });
    const pin = pinBox('PIN (optional, 4-8 digits)');
    panel.replaceChildren(...rows,
      el('div', { class: 'acct-row' }, name, pin, el('button', { type: 'button', text: 'Add player', onclick: () => go(() => switchTo(createAccount(name.value, pin.value))) })),
      el('p', { class: 'small', text: 'Each player keeps their own skins, points, stats, season and settings on this PC. To move a player to another PC, use the save code on the Skins page. The PIN only stops others on this PC switching by accident.' }),
      msg);
  }
  render();
  return { render };
}
