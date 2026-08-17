// Endpoint público de descadastro: GET com ?tenant=&email= -> registra opt-out e retorna HTML.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const tenant = url.searchParams.get("tenant");
  const email = (url.searchParams.get("email") || "").toLowerCase().trim();
  const html = (msg: string) => new Response(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Descadastro</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:60px auto;padding:24px;text-align:center;color:#111}h1{color:#10b981}p{color:#555;line-height:1.6}</style></head><body><h1>✓ Descadastrado</h1><p>${msg}</p></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });

  if (!tenant || !email) return html("Link inválido.");
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    await supa.from("email_unsubscribes").upsert({ tenant_id: tenant, email }, { onConflict: "tenant_id,email" });
    return html(`O e-mail <b>${email}</b> não receberá mais mensagens promocionais desta loja. E-mails sobre seus pedidos continuam sendo enviados.`);
  } catch (e: any) {
    return html("Erro ao processar descadastro. Tente novamente mais tarde.");
  }
});
