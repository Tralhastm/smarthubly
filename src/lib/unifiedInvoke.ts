// unificaInvocação de Edge Functions unificadas.
// O supabase.functions.invoke() só aceita slug (sem path extra), então as funções
// unificadas são chamadas via fetch direto com o path da rota:
//   ${SUPABASE_URL}/functions/v1/<unified>/<rota>
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL as string;
const supabase = createClient(SUPA_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

export type InvokeResult<T = any> = { data: T | null; error: any };

export async function unifiedInvoke(
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
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = res.ok ? await res.json() : null;
    return {
      data,
      error: res.ok ? null : { status: res.status, message: res.statusText, data },
    };
  } catch (e: any) {
    return { data: null, error: { message: e?.message || "fetch error", original: e } };
  } finally {
    clearTimeout(timer);
  }
}

// Conveniência: mantém assinatura parecida com supabase.functions.invoke
export function invokeRouter(unified: string) {
  return {
    invoke: <T = any>(pathRoute: string, options?: { body?: unknown; timeoutMs?: number }) =>
      unifiedInvoke<T>(unified, pathRoute, options?.body, options),
  };
}
