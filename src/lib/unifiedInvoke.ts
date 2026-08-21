// unificaInvocação de Edge Functions unificadas.
// O supabase.functions.invoke() só aceita slug (sem path extra), então as funções
// unificadas são chamadas via fetch direto com o path da rota:
//   ${SUPABASE_URL}/functions/v1/<unified>/<rota>
import { createClient } from "@supabase/supabase-js";

// VITE_SUPABASE_PUBLISHABLE_KEY é a padrão do projeto (.env/.env.build); ANON_KEY é alias para compatibilidade
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPA_KEY =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ??
  "";
const supabase = createClient(SUPA_URL, SUPA_KEY);

export type InvokeResult<T = any> = { data: T | null; error: any };

async function doInvoke(
  unified: string,
  pathRoute: string,
  body?: unknown,
  opts?: { timeoutMs?: number }
): Promise<InvokeResult> {
  const url = `${SUPA_URL}/functions/v1/${unified}/${pathRoute}`;
  const timeout = opts?.timeoutMs ?? 300_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token ?? "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: SUPA_KEY,
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = res.ok ? await res.json().catch(() => null) : null;
    if (res.ok) {
      return { data, error: null };
    }
    // Tenta extrair a mensagem de erro detalhada do corpo da Edge Function
    let detail = res.statusText;
    try {
      // res já foi consumido pelo res.json() acima; refazer via clone não é possível,
      // então re-invoca a leitura a partir do data (que pode conter {error})
      if (data && typeof data === "object" && (data as any).error) {
        detail = typeof (data as any).error === "string" ? (data as any).error : JSON.stringify((data as any).error);
      }
    } catch {
      /* ignora */
    }
    return {
      data: null,
      error: { status: res.status, message: detail, context: res },
    };
  } catch (e: any) {
    return { data: null, error: { message: e?.message || "fetch error", original: e } };
  } finally {
    clearTimeout(timer);
  }
}

export async function unifiedInvoke(
  unified: string,
  pathRoute: string,
  body?: unknown,
  opts?: { timeoutMs?: number; retries?: number }
): Promise<InvokeResult> {
  const retries = opts?.retries ?? 2;
  let lastError: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = await doInvoke(unified, pathRoute, body, opts);
    if (!r.error) return r;
    lastError = r.error;
    // Não faz retry se a falha for de autorização (401) — problema de sessão, não de rede
    if ((r.error as any)?.status === 401 || (r.error as any)?.status === 403) return r;
    // Espera progressivamente antes de tentar de novo (rede do celular oscila)
    await new Promise(res => setTimeout(res, 1000 * (attempt + 1)));
  }
  return { data: null, error: lastError };
}

// Conveniência: mantém assinatura parecida com supabase.functions.invoke
export function invokeRouter(unified: string) {
  return {
    invoke: <T = any>(pathRoute: string, options?: { body?: unknown; timeoutMs?: number }) =>
      unifiedInvoke<T>(unified, pathRoute, options?.body, options),
  };
}
