/**
 * Fila offline do PDV usando IndexedDB.
 * Quando o PDV perde rede, pedidos vão pra fila local e são re-tentados
 * automaticamente quando a conexão volta. Idempotência via client_uuid
 * (gerado no momento da venda) — re-envios não criam duplicata.
 */

import { supabase } from "@/integrations/supabase/client";

const DB_NAME = "pdv-queue";
const DB_VERSION = 1;
const STORE = "pending-orders";

export interface QueuedOrder {
  client_uuid: string;
  created_at: number;
  attempts: number;
  last_error?: string;
  payload: {
    order: Record<string, any>;
    items: Record<string, any>[];
  };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "client_uuid" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueOrder(payload: QueuedOrder["payload"]): Promise<string> {
  const client_uuid = crypto.randomUUID();
  const entry: QueuedOrder = { client_uuid, created_at: Date.now(), attempts: 0, payload };
  // Marca o pedido com o uuid (servidor usa pra deduplicar)
  entry.payload.order.client_uuid = client_uuid;
  await tx("readwrite", (s) => s.put(entry));
  return client_uuid;
}

export async function listQueued(): Promise<QueuedOrder[]> {
  return (await tx<QueuedOrder[]>("readonly", (s) => s.getAll())) ?? [];
}

export async function removeQueued(client_uuid: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(client_uuid));
}

async function markFailed(client_uuid: string, err: string) {
  const all = await listQueued();
  const e = all.find((x) => x.client_uuid === client_uuid);
  if (!e) return;
  e.attempts += 1;
  e.last_error = err;
  await tx("readwrite", (s) => s.put(e));
}

/**
 * Tenta enviar todos os pedidos pendentes. Roda automaticamente no `online` event
 * e pode ser chamado manualmente. Tem proteção pra não rodar 2 vezes em paralelo.
 */
let flushing = false;
export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  if (flushing || !navigator.onLine) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0, failed = 0;
  try {
    const pending = await listQueued();
    for (const entry of pending) {
      try {
        // Idempotência via client_uuid: se já existir pedido com esse uuid, skip
        const { data: existing } = await (supabase as any)
          .from("orders")
          .select("id")
          .eq("client_uuid", entry.client_uuid)
          .maybeSingle();

        if (existing?.id) {
          await removeQueued(entry.client_uuid);
          sent++;
          continue;
        }

        const { data: order, error: oErr } = await (supabase as any)
          .from("orders")
          .insert(entry.payload.order)
          .select("id")
          .single();
        if (oErr) throw oErr;

        const items = entry.payload.items.map((it) => ({ ...it, order_id: order.id }));
        if (items.length > 0) {
          const { error: iErr } = await (supabase as any).from("order_items").insert(items);
          if (iErr) throw iErr;
        }

        await removeQueued(entry.client_uuid);
        sent++;
      } catch (e: any) {
        await markFailed(entry.client_uuid, e?.message || "unknown");
        failed++;
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, failed };
}

/** Liga o auto-flush ao evento `online` e ao foco da janela. Chame uma vez no boot do PDV. */
export function startOfflineQueueWatcher() {
  if (typeof window === "undefined") return () => {};
  const handler = () => { flushQueue().catch(() => {}); };
  window.addEventListener("online", handler);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") handler();
  });
  // Flush inicial
  handler();
  return () => window.removeEventListener("online", handler);
}
