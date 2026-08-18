// Gera mensagem WhatsApp via cadeia de IA (Lovable → Google → Workers).
// Pipeline: 1) gera rascunho   2) revisor IA refina   3) salva e retorna versão final + notas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAiWithFallback } from "../_shared/ai-fallback.ts";
import { authorizeCaller, assertProspectAccess, type CallerAuth } from "../_shared/authorize-caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Catálogo COMPLETO da plataforma — alimenta a IA pra casar feature ↔ dor real
const PLATFORM_FEATURES = `PLATAFORMA (TUDO QUE FAZEMOS — escolha o que case com a DOR real):
- Site/catálogo de delivery próprio sem comissão (alternativa ao iFood/Rappi)
- Venda no balcão profissional (PDV) — mesmo quem já vende no balcão "de qualquer jeito" ganha controle
- QR Code nas mesas: cliente abre cardápio, faz pedido, chama o garçom sem gritar
- Painel do garçom: cada pedido cai com a mesa certa, edição de comanda em tempo real
- Tela da cozinha (KDS): cozinha vê exatamente o que sai de cada mesa
- Motoboys: próprios (com app), terceirizados pela plataforma, OU integração Lalamove
- Gestão financeira profissional + IA Empresarial (Clara) que responde sobre o caixa do dono
- Aba Fornecedores: pedidos pros fornecedores direto pelo sistema, chat e entregas
- Ranking de produtos mais vendidos / mais lucrativos
- Automações (recuperação de carrinho, mensagens pós-venda, follow-up de cliente que sumiu)
- Fidelidade, cupons, fiado controlado
- Multi-nicho: restaurante, hamburgueria, bar, mercado, adega, marmita, doces, conveniência, etc.
- DIFERENCIAL CONTRA CONCORRENTES: se o lojista já usa iFood/anota.ai/goomer/cardapio.app/WordPress/Wix → ataque os pontos fracos DELES (taxa alta, sem KDS, sem garçom, sem motoboy próprio, sem financeiro, sem cliente próprio) e mostre que conosco é tudo integrado E sem comissão por pedido (ou mensalidade fixa transparente).`;

const VEILED_OPENERS = `ESTILOS DE ABERTURA TRANSPARENTE (escolha 1 — varie entre rascunhos, NUNCA comece com "tudo bem?"):
- "Boa tarde! Aqui é o/a [SEU NOME], da SmartHubly — a gente monta o sistema de pedidos online sem comissão pras lojas de {CIDADE}. Vi a {LOJA} e queria mostrar uma coisa em 1 minuto, pode ser?"
- "Oi! Sou o/a [SEU NOME], da SmartHubly (plataforma de pedidos online sem taxa por venda, de {CIDADE}). Vi a {LOJA} no Google e achei que isso aqui interessa pra vocês — posso mandar rapidinho?"
- "Boa tarde, da {LOJA}! Eu trabalho na SmartHubly, a gente ajuda lojas como a de vocês a vender online sem pagar comissão por pedido. Tenho 1 minuto pra explicar?"
A ideia: declarar QUEM É e O QUE QUER logo na 1ª linha, com tom leve. Curiosidade com transparência — nunca com mistério. Curto. Sem CTA comercial agressivo no abre.`;

const SYS_INITIAL = `Você é um SDR experiente abordando dono de restaurante/loja no WhatsApp pela primeira vez.

⚠️ CONTEXTO CRÍTICO — REGRA Nº 1: ANTI-GOLPE ⚠️
O Brasil está saturado de golpes no WhatsApp. Donos de loja bloqueiam ou ignoram imediatamente qualquer mensagem de desconhecido que:
- pede para falar com "o responsável/dono" sem se identificar
- pergunta "quem cuida da operação aí?" (padrão clássico de golpe)
- cria mistério/curiosidade sem dizer quem é e o que quer
- fala "preciso falar uma coisa rápida com quem toca o negócio"
- faz perguntas vagas que só o dono saberia responder
Se a mensagem puder ser lida como golpe, ela PERDE o lead. Nunca use essas técnicas.

PROTOCOLO DE CREDIBILIDADE (obrigatório na 1ª mensagem):
1) IDENTIDADE COMPLETA na 1ª linha: nome pessoal + "da SmartHubly" + o que a SmartHubly faz em meia frase.
2) MOTIVO REAL e específico de estar escrevendo: viu a loja no Google/Maps, viu o Instagram, viu que não tem site de pedidos, etc. Algo verdadeiro do contexto do lead.
3) PERMISSÃO antes de vender: termine pedindo licença pra enviar um material rápido OU fazer uma pergunta concreta — nunca mande a proposta na 1ª mensagem.
4) TOM leve e humano, brasileiro, CURTO (3-6 linhas). Parece o vendedor que manda áudio no bairro, não spam.

OUTRAS REGRAS:
5) NÃO tente adivinhar a dor do dono. Se houver evidência REAL (avaliações negativas, sem site, etc), mencione DE LADO, como observação — nunca como acusação.
6) DEIXE O DONO FALAR A DOR DELE. A pergunta final deve ser concreta e específica (ex: "hoje vocês recebem pedido online só pelo iFood ou também aceitam por WhatsApp?") — NUNCA "quem cuida da operação?" nem perguntas vagas de identidade.
7) NUNCA fique batendo só na tecla "taxa do iFood" — pode ser que ele nem use iFood. Se houver dor real nas reviews, encaixe a feature certa do catálogo.
8) Sem clichê ("espero que esteja bem", "tudo joia?"). Sem emoji no início. Sem "olá prezado".
9) Mencione o nome da loja. Use detalhes reais do contexto SE existirem.
10) Use "[SEU NOME]" como placeholder do nome de quem está prospectando (o lojista sabe de quem está falando com quem).

${VEILED_OPENERS}

${PLATFORM_FEATURES}

Responda APENAS o texto final da mensagem, nada mais.`;

const SYS_REPLY = `Você é SDR brasileiro fechando venda no WhatsApp.
Lê o histórico TODO da conversa e responde a próxima mensagem (2-5 linhas, casual, humana).
- Considere objeções e tom do lead.
- Se o lead JÁ contou uma dor, AGORA encaixe a feature exata do catálogo abaixo que resolve.
- Não repita o que já foi dito.
- Termine com pergunta de avanço OU CTA específico (demo, ligação, mandar print).

${PLATFORM_FEATURES}

Só responda o texto da mensagem.`;

const SYS_FOLLOWUP = `Você é SDR fazendo follow-up educado de WhatsApp.
O lead recebeu sua mensagem e NÃO respondeu. Escreva 1 lembrete CURTO (2-4 linhas), leve, sem cobrar.

⚠️ ANTI-GOLPE: NÃO use frases estilo "passando pra não deixar nossa conversa morrer", "imagino que a correria aí continua", ou "vou embora, é minha última vez" — são marcadores clássicos de golpe e fazem o lead bloquear. Mantenha o tom profissional e leve: reafirme brevemente quem você é ("sigo sendo o/a [SEU NOME] da SmartHubly"), dê um motivo novo e concreto (uma feature do catálogo que case com o nicho dele, um resultado de outra loja parecida) ou faça uma pergunta diferente e específica. Se quiser, ofereça algo de baixo compromisso ("posso mandar um vídeo de 1 min?").

Tom humano, brasileiro. Só o texto.

${PLATFORM_FEATURES}`;

const SYS_REVIEWER = `Você é um EDITOR sênior de copywriting de vendas via WhatsApp em PT-BR, especialista em COLD OUTREACH que NÃO parece golpe.

⚠️ TESTE ANTI-GOLPE (execute ANTES de devolver o texto final): imagine-se um dono de loja desconfiado recebendo essa mensagem de um número desconhecido. Se QUALQUER destes sinais aparecer, corrija:
- não se identifica (falta "quem sou" + "de que empresa" na 1ª linha)
- pergunta "quem é o dono?" / "quem responde aqui?" / "com quem preciso falar?"
- cria mistério ou curiosidade sem dizer o motivo real da mensagem
- pede "uma coisa rápida" sem explicar o que é
- tom de golpe conhecido (urgência, pedido de dados, "preciso falar com o responsável")
Se reprovado no teste, reescreva: 1ª linha = identidade + empresa + motivo verdadeiro; final = pedido de licença ou pergunta concreta.

Sua missão: devolver a MELHOR versão possível:
- Tom humano brasileiro, NUNCA robótico
- Se for 1ª mensagem: identidade clara + motivo real + pedido de licença (conforme teste anti-golpe acima). Não adivinha dor — convida o dono a falar com pergunta concreta.
- Se houver pain_signals reais, encaixe SUTIL (não acuse), e termine convidando o dono a confirmar/negar.
- Curta, direta, zero clichê. Pergunta aberta forte OU CTA claro.
- Varie estilo entre tentativas (não soe sempre igual).
- Considere o catálogo completo da plataforma — não trave só em "taxa iFood".

Responda em JSON: {"final": "texto final pronto pra enviar", "notes": "1 frase curta sobre o ajuste"}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "no_auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const caller = await authorizeCaller(supabase, user.id);
    if ((caller as any).error) {
      const c = caller as { error: string; status: number };
      return new Response(JSON.stringify({ error: c.error }), { status: c.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const callerAuth = caller as CallerAuth;

    const { prospect_id, mode } = await req.json() as { prospect_id: string; mode: "initial" | "reply" | "followup" };
    if (!prospect_id) return new Response(JSON.stringify({ error: "prospect_id obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: prospect } = await supabase
      .from("remote_prospects").select("*").eq("id", prospect_id).maybeSingle();
    if (!prospect) return new Response(JSON.stringify({ error: "prospect_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const access = assertProspectAccess(callerAuth, prospect);
    if ((access as any).error) {
      const a = access as { error: string; status: number };
      return new Response(JSON.stringify({ error: a.error }), { status: a.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // IMPORTANTE: conversation_log SÓ é alimentado quando uma mensagem é ENVIADA via WhatsApp
    // (ver SuperAdminRemoteProspecting.tsx → openWhatsApp / markAsSent). Rascunhos NÃO entram aqui.
    // Logo, "regerar" sempre parte do histórico real enviado, ignorando drafts descartados.
    const log = Array.isArray(prospect.conversation_log) ? prospect.conversation_log : [];
    const transcript = log.length
      ? log.map((m: any) => `${m.from === "me" ? "EU" : "LEAD"}: ${m.text}`).join("\n")
      : "(ainda não houve troca de mensagens — esta é a 1ª abordagem)";

    const painSignals = Array.isArray(prospect.pain_signals) ? prospect.pain_signals : [];
    const reviewsSample = Array.isArray(prospect.reviews_sample) ? prospect.reviews_sample : [];
    const topReviews = reviewsSample.slice(0, 5).map((r: any, i: number) =>
      `  [${i + 1}]${r.rating ? ` (${r.rating}★)` : ""} ${String(r.text ?? "").slice(0, 220)}`
    ).join("\n");

    // ===== APRENDIZADOS ACUMULADOS — a IA evolui a cada fechamento/recusa =====
    // Prioriza lições do mesmo nicho, depois lições gerais. weight=2 (fechou) vem antes de weight=1 (recusou).
    const { data: lessonsNiche } = await supabase
      .from("prospect_learnings")
      .select("outcome, key_lesson, what_worked, what_failed, pain_signals")
      .eq("niche", prospect.niche ?? "__none__")
      .order("weight", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8);
    const { data: lessonsGlobal } = await supabase
      .from("prospect_learnings")
      .select("outcome, key_lesson, what_worked, what_failed")
      .order("weight", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10);

    const fmtLesson = (l: any, i: number) =>
      `  [${i + 1}][${l.outcome === "won" ? "FECHOU" : "RECUSOU"}] ${l.key_lesson}` +
      (l.what_worked ? `\n        ✓ funcionou: ${l.what_worked}` : "") +
      (l.what_failed ? `\n        ✗ travou: ${l.what_failed}` : "");
    const learningsBlock = [
      ...(lessonsNiche ?? []).map(fmtLesson),
      "  --- lições gerais ---",
      ...(lessonsGlobal ?? []).map(fmtLesson),
    ].join("\n");
    const learningsSection = (lessonsNiche?.length || lessonsGlobal?.length)
      ? `\n\nAPRENDIZADOS REAIS DE CONVERSAS ANTERIORES (use pra ajustar tom/ângulo — repita o que funcionou, evite o que travou):\n${learningsBlock}`
      : "";

    const stack = Array.isArray(prospect.competitor_stack) ? prospect.competitor_stack : [];
    const manualIntel = String(prospect.manual_intel ?? "").trim();
    const manualWebsite = String(prospect.manual_website_url ?? "").trim();
    const effectiveWebsite = manualWebsite || prospect.website_url || "";

    const ctx = `LOJA: ${prospect.business_name}
CIDADE: ${prospect.city ?? ""}${prospect.state ? "/" + prospect.state : ""}
BAIRRO: ${prospect.neighborhood ?? "—"}
NICHO: ${prospect.niche ?? "—"} | CATEGORIA: ${prospect.category ?? "—"}
TEM SITE: ${prospect.has_website || manualWebsite ? `sim (${effectiveWebsite || "—"})` : "NÃO (alvo)"}
SITE INSERIDO MANUALMENTE: ${manualWebsite ? "SIM — " + manualWebsite : "Não"}
PLATAFORMA QUE JÁ USA: ${stack.length ? stack.join(", ") : "(desconhecida)"}
RESUMO DA STACK: ${prospect.stack_summary ?? "—"}
INSTAGRAM: ${prospect.instagram_handle ?? "—"}
RATING: ${prospect.rating ?? "—"}${prospect.reviews_count ? ` (${prospect.reviews_count} avaliações)` : ""}
DORES DETECTADAS: ${painSignals.length ? painSignals.join(", ") : "(nenhuma — não invente, deixe o dono falar)"}
RESUMO DAS DORES: ${prospect.pain_summary ?? "—"}
TRECHOS DE AVALIAÇÕES${reviewsSample.length ? ":\n" + topReviews : ": (não coletadas)"}
${manualIntel ? `\n>>> INFORMAÇÕES MANUAIS QUE EU (operador) SEI sobre esse lojista — USE COM PESO MÁXIMO se forem úteis:\n${manualIntel}\n` : ""}
NOTAS: ${prospect.notes ?? "—"}${learningsSection}`;

    let sys = SYS_INITIAL;
    if (mode === "reply") sys = SYS_REPLY;
    if (mode === "followup") sys = SYS_FOLLOWUP;

    const userMsg = `${ctx}\n\nHISTÓRICO DA CONVERSA:\n${transcript}`;

    // ===== PASS 1: rascunho =====
    let draft = "";
    let drafterProvider = "fallback";
    try {
      const r1 = await callAiWithFallback(supabase, { systemPrompt: sys, userPrompt: userMsg, temperature: 0.85 });
      draft = r1.text;
      drafterProvider = r1.provider;
    } catch (_e) {
      draft = `Boa tarde — tô tentando falar diretamente com o responsável pela ${prospect.business_name}, pode me ajudar?`;
    }

    // ===== PASS 2: revisor IA refina =====
    let final = draft;
    let reviewNotes = "";
    let reviewerProvider = "skipped";
    try {
      const reviewerInput = `CONTEXTO DO LEAD:\n${ctx}\n\nHISTÓRICO:\n${transcript}\n\nRASCUNHO A REVISAR:\n${draft}`;
      const r2 = await callAiWithFallback(supabase, {
        systemPrompt: SYS_REVIEWER,
        userPrompt: reviewerInput,
        jsonMode: true,
        temperature: 0.4,
      });
      reviewerProvider = r2.provider;
      try {
        const parsed = JSON.parse(r2.text.match(/\{[\s\S]*\}/)?.[0] ?? r2.text);
        if (parsed?.final && typeof parsed.final === "string") {
          final = parsed.final.trim();
          reviewNotes = String(parsed.notes ?? "").trim();
        }
      } catch (e) {
        console.warn("[reviewer] JSON parse fail, usando rascunho:", e);
      }
    } catch (_e) {
      console.warn("[reviewer] Indisponível, retornando rascunho cru");
    }

    // ===== Salva =====
    const patch: Record<string, unknown> = { review_notes: reviewNotes || null };
    if (mode === "initial" || mode === "followup") {
      patch.initial_message = final;
      patch.status = "ready";
    }
    await supabase.from("remote_prospects").update(patch).eq("id", prospect_id);

    return new Response(JSON.stringify({
      message: final,
      draft,
      review_notes: reviewNotes,
      drafter_provider: drafterProvider,
      reviewer_provider: reviewerProvider,
      fallback: drafterProvider === "fallback",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[prospect-message] erro:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
