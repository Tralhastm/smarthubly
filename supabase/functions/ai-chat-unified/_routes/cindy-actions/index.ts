// Cindy Actions — executor de ações da Cindy (copiloto do super admin).
// POST /gen-post    -> gera um post de marketing (texto + imagem opcional) via marketing-post
//                      e devolve pronto pra salvar/baixar.
// POST /reply-ticket -> grava uma resposta de suporte dentro de um support_ticket
//                      e atualiza status do ticket quando pedido.
//
// Autenticação: JWT da sessão do Supabase + plataforma_roles = 'super_admin'.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabase() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function requireSuperAdmin(authHeader: string | null): Promise<string> {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("unauthorized");
  const token = authHeader.slice(7);
  const supabase = getSupabase();
  const { data: session, error } = await supabase.auth.getUser(token);
  if (error || !session?.user) throw new Error("unauthorized");
  const { data: role, error: rErr } = await supabase
    .from("platform_roles")
    .select("role")
    .eq("user_id", session.user.id)
    .eq("role", "super_admin")
    .maybeSingle();
  if (rErr || !role) throw new Error("super_admin_required");
  return session.user.id;
}

export async function cindy_actions(req: Request, body?: unknown): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ct = req.headers.get("content-type") || "";
    const payload: any = body ?? (ct.includes("application/json") ? await req.json().catch(() => ({})) : {});

    await requireSuperAdmin(req.headers.get("Authorization"));
    const body = payload;
    const url = new URL(req.url);
    const path = url.pathname
      .replace(/^\/functions\/v1\/cindy-actions|^\/cindy-actions/, "")
      .replace(/\/$/, "") || "/gen-post";

    if (path === "/gen-post") {
      // body: { format?: string, scope?: "tenant"|"platform", tenantId?: string,
      //         tone?: string, extraContext?: string, audience?: string,
      //         generateImage?: boolean, imageStyle?: string, imagePrompt?: string }
      const { format = "post_dia", scope = "platform", tenantId, tone, extraContext,
        audience, generateImage = false, imageStyle, imagePrompt } = body;
      const validFormats = ["post_dia", "story", "bio", "reels_script", "carousel", "whatsapp", "hashtags"];
      if (!validFormats.includes(format)) return j({ error: "format_invalido" }, 400);
      if (scope === "tenant" && !tenantId) return j({ error: "tenantId_obrigatorio" }, 400);

      const res = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/marketing-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope, tenantId, format, tone, extraContext, audience,
          generateImage, imageStyle, imagePrompt,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return j({ error: "marketing_post_failed", detail: err?.error || String(res.status) }, 502);
      }
      const data = await res.json();
      return j({
        ok: true,
        content: data.content,
        image: data.image,
        overlay: data.overlay,
        format,
        saved_at: new Date().toISOString(),
      });
    }

    if (path === "/reply-ticket") {
      // body: { ticketId: string, content: string, senderName?: string, setResolved?: boolean }
      const { ticketId, content, senderName, setResolved } = body;
      if (!ticketId || !content || typeof content !== "string" || content.trim().length === 0) {
        return j({ error: "ticketId_e_content_obrigatorios" }, 400);
      }
      const supabase = getSupabase();
      const { data: ticket, error: getErr } = await supabase
        .from("support_tickets")
        .select("id, subject, tenant_id")
        .eq("id", ticketId)
        .maybeSingle();
      if (getErr || !ticket) return j({ error: "ticket_nao_encontrado" }, 404);

      const { error: insErr } = await supabase
        .from("support_messages")
        .insert({
          ticket_id: ticketId,
          sender_type: "support",
          sender_name: senderName || "Suporte SmartHubly",
          content: content.trim(),
        });
      if (insErr) return j({ error: "falha_ao_enviar_mensagem", detail: insErr.message }, 500);

      if (setResolved) {
        await supabase
          .from("support_tickets")
          .update({ status: "resolved", resolution: content.trim(), resolved_at: new Date().toISOString() })
          .eq("id", ticketId)
          .then(() => {}, () => {});
      }

      return j({
        ok: true,
        ticketId,
        subject: ticket.subject,
        tenantId: ticket.tenant_id,
        replied_at: new Date().toISOString(),
      });
    }

    if (path === "/list-tickets") {
      // Lista tickets abertos para a Cindy poder citar no contexto (usada pelo front ou pela IA)
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("support_tickets")
        .select("id, subject, description, status, priority, tenant_id, category, created_at")
        .in("status", ["open", "pending", "waiting"])
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      const lines = (data || []).map((t: any) =>
        `· [${t.id.slice(0, 8)}] ${t.subject} (${t.status || "open"}) | criado ${new Date(t.created_at).toLocaleString("pt-BR")}`);
      return j({ ok: true, tickets: data || [], summary: lines.join("\n") || "(nenhum chamado aberto)" });
    }

    return j({ error: "rota_desconhecida" }, 404);
  } catch (e: any) {
    console.error("[unified:cindy-actions] error", e);
    const msg = String(e?.message || e);
    const status = msg === "super_admin_required" ? 403 : (msg === "unauthorized" ? 401 : 500);
    return j({ error: msg }, status);
  }
}
