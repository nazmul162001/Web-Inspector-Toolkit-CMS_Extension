/**
 * Username / password prompt used when Entire Site hits HTTP Basic Auth.
 * One dialog at a time; credentials are never stored.
 */

import { el } from '../../shared/helpers.js';
import { icon } from './icons.js';

let open = null;

function closeDialog(result) {
  if (!open) return;
  const { overlay, finish } = open;
  open = null;
  overlay.remove();
  finish(result);
}

/**
 * @param {{ origin?: string, host?: string, invalid?: boolean }} [info]
 * @returns {Promise<{ username: string, password: string } | null>}
 */
export function promptSitePassword(info = {}) {
  if (open) {
    open.update(info);
    return open.promise;
  }

  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });

  const host = info.host || (info.origin ? info.origin.replace(/^https?:\/\//, '') : '');
  const user = el('input', {
    class: 'input auth-dialog__input',
    type: 'text',
    name: 'username',
    autocomplete: 'username',
    autocapitalize: 'off',
    spellcheck: 'false',
  });
  const pass = el('input', {
    class: 'input auth-dialog__input',
    type: 'password',
    name: 'password',
    autocomplete: 'current-password',
  });
  const err = el('p', { class: 'auth-dialog__error', hidden: true }, 'Those details were not accepted. Try again.');
  const lead = el(
    'p',
    { class: 'auth-dialog__lead' },
    host ? `Enter the username and password for ${host} to continue searching the site.` : 'Enter the username and password to continue searching the site.',
  );

  const form = el('form', { class: 'auth-dialog', role: 'dialog', 'aria-modal': 'true' });
  form.append(
    el('div', { class: 'auth-dialog__icon' }, icon('lock', { size: 22 })),
    el('h2', { class: 'auth-dialog__title' }, 'This site is password protected'),
    lead,
    err,
    el('label', { class: 'auth-dialog__field' }, el('span', {}, 'Username'), user),
    el('label', { class: 'auth-dialog__field' }, el('span', {}, 'Password'), pass),
    el(
      'div',
      { class: 'auth-dialog__actions' },
      el('button', { class: 'btn', type: 'button' }, 'Cancel'),
      el('button', { class: 'btn btn--primary', type: 'submit' }, 'Continue search'),
    ),
  );

  const overlay = el('div', { class: 'auth-dialog-overlay', role: 'presentation' }, form);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeDialog(null);
  });
  form.querySelector('.btn:not(.btn--primary)').addEventListener('click', () => closeDialog(null));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    closeDialog({ username: user.value, password: pass.value });
  });
  document.addEventListener(
    'keydown',
    function onKey(event) {
      if (event.key !== 'Escape' || !open) return;
      event.preventDefault();
      document.removeEventListener('keydown', onKey);
      closeDialog(null);
    },
    { once: true },
  );

  const api = {
    promise,
    overlay,
    finish: resolve,
    update(next) {
      if (next?.invalid) err.hidden = false;
      if (next?.host || next?.origin) {
        const name = next.host || String(next.origin || '').replace(/^https?:\/\//, '');
        lead.textContent = `Enter the username and password for ${name} to continue searching the site.`;
      }
    },
  };
  open = api;
  api.update(info);
  document.body.append(overlay);
  queueMicrotask(() => user.focus());
  return promise;
}
