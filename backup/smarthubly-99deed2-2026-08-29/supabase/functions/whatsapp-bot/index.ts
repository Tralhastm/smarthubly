import { callAiJson } from "../_shared/ai-fallback.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function normalizarTelefone(tel: string): string {
  return tel.replace(/[^\d+]/g, "").trim();
}

async function carregarBot(supabase: any, telefone: string) {
  const tel = normalizarTelefone(telefone);
  if (!tel) return null;

  const { data: bots } = await supabase
    .from("whatsapp_bots")
    .select("*")
    .eq("telefone", tel)
    .eq("ativo", true)
    .limit(1);

  const bot = bots?.[0];
  if (!bot) return null;

  const [orcRes, regRes] = await Promise.all([
    supabase.from("bot_orcamentos").select("servico,material,preco_min,preco_max,observacao,por_m2,area_minima").eq("bot_id", bot.id),
    supabase.from("bot_regras").select("chave,valor").eq("bot_id", bot.id)
  ]);

  return {
    ...bot,
    orcamentos: orcRes.data || [],
    regras: regRes.data || []
  };
}

export async function whatsapp_bot(req: Request, body: any) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { mensagem, telefone, telefone_do_bot, historico = [] } = body;

  const telBusca = telefone_do_bot || telefone;
  const bot = await carregarBot(supabase, telBusca);

  if (!bot) {
    return new Response(JSON.stringify({ 
      resposta_natural: "Olá! Como posso ajudar você hoje?", 
      intencao: "saudacao",
      confiavel: true 
    }), { headers: { "Content-Type": "application/json" } });
  }

  const orcamentosTxt = bot.orcamentos.map((o: any) => 
    `- ${o.servico}${o.material ? " (" + o.material + ")" : ""}: R$ ${o.preco_min} a R$ ${o.preco_max}${o.por_m2 ? " (m², min " + o.area_minima + ")" : ""}`
  ).join("\n");

  const regrasTxt = bot.regras.map((r: any) => `- ${r.chave}: ${r.valor}`).join("\n");

  const systemPrompt = `Você é o VENDEDOR HUMANO da loja "${bot.loja_nome}" (${bot.segmento || "atendimento"}).
Seu objetivo é ser "foda": atender tão bem que o cliente ache que você é uma pessoa real.

PERSONA:
- Brasileiro, informal, prestativo, mas focado em fechar negócio.
- Entende TUDO: gírias ("mano", "tá caro dms", "bora fecha", "piá"), erros de português ("ifone", "presiso"), e abreviações.
- Não use palavras robóticas ou menus. Responda como se estivesse no WhatsApp pessoal.

TABELA DE ORÇAMENTOS (Sua única fonte de preços):
${orcamentosTxt || "Nenhum preço cadastrado."}

REGRAS DO LOJISTA:
${regrasTxt || "Nenhuma regra especial."}

CONFIGURAÇÕES:
- Tom: ${bot.tom_conversa || "amigável"}
- Horário: ${bot.horario_atendimento || "não informado"}
- Materiais: ${bot.materiais_info || "não informado"}

TAREFA: Analise a mensagem e retorne um JSON puro:
{
  "resposta_natural": "Sua resposta fluída e humana.",
  "intencao": "orcamento" | "pergunta_info" | "agendar_visita" | "chamar_humano" | "saudacao" | "despedida" | "negociacao" | "desconhecido",
  "servico": "Nome exato do serviço da tabela ou null",
  "material": "inox" | "galvanizado" | null,
  "medida": "número/dimensão ou null",
  "encaminhar_humano": true/false,
  "confiavel": true/false,
  "entidade_nova": true/false
}

REGRAS DE OURO:
- NUNCA diga "sou uma IA".
- Se o cliente perguntar algo fora da tabela, redirecione educadamente.
- Use emojis moderadamente.
- Só conduza o orçamento se o cliente demonstrar interesse em um serviço.`;

  try {
    const aiRes = await callAiJson(supabase, {
      systemPrompt,
      messages: [...(historico || []).slice(-10), { role: "user", content: mensagem }],
      temperature: 0.7
    });

    return new Response(JSON.stringify({ ...aiRes, fonte: "ia-unified-bot" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ 
      resposta_natural: "Opa, tudo bem? Me conta melhor o que você precisa que eu já te ajudo!",
      intencao: "desconhecido",
      confiavel: false
    }), { headers: { "Content-Type": "application/json" } });
  }
}
