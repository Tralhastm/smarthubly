// Endpoint público de descadastro: GET com ?tenant=&email= -> registra opt-out e retorna HTML.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string
  ));

export async function unsubscribe_public(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
    const url = new URL(req.url);
    const tenant = url.searchParams.get("tenant") || parsed?.tenant || null;
    const email = (url.searchParams.get("email") || parsed?.email || "").toLowerCase().trim();
    const html = (msg: string, status = 200) => new Response(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Descadastro</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:60px auto;padding:24px;text-align:center;color:#111}h1{color:#10b981}p{color:#555;line-height:1.6}</style></head><body><h1>✓ Descadastrado</h1><p>${msg}</p></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

    if (!tenant || !email || !email.includes("@")) return html("Link inválido.", 400);

    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { error } = await supa
      .from("email_unsubscribes")
      .upsert({ tenant_id: tenant, email }, { onConflict: "tenant_id,email" });

    // Sem persistência não existe descadastro: nunca responder sucesso nesse caso.
    if (error) {
      console.error("[unified:unsubscribe-public] upsert failed", { tenant, error: error.message });
      return html("Erro ao processar descadastro. Tente novamente mais tarde.", 500);
    }

    // Mantém a supressão global em sincronia para o disparador de campanhas/fila.
    const { error: suppressError } = await supa
      .from("suppressed_emails")
      .upsert({ email, reason: "unsubscribe" }, { onConflict: "email" });
    if (suppressError) {
      console.error("[unified:unsubscribe-public] suppress failed", { error: suppressError.message });
    }

    return html(`O e-mail <b>${escapeHtml(email)}</b> não receberá mais mensagens promocionais desta loja. E-mails sobre seus pedidos continuam sendo enviados.`);
  } catch (e) {
    console.error("[unified:unsubscribe-public] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
