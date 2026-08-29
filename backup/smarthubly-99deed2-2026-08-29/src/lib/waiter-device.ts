/**
 * Identificador persistente do device do garçom (localStorage).
 * Usado para garantir que só o celular que abriu a comanda pode editá-la.
 */

const KEY = 'waiter-device-id';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = 'dev_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    localStorage.setItem(KEY, id);
  }
  return id;
}

/** Código curto e legível pra mostrar ao cliente (sem 0/O/1/I). */
export function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 6; i++) out += chars[arr[i] % chars.length];
  return out;
}
