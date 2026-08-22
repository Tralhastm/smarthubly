/* whatsapp-bot-conversador — SmartHubly Edge Function (v6)
 * CONVERSOR NÍVEL SOFIA para o produto "Bot WhatsApp" do SmartHubly.
 * Não é mais um classificador de intenções: conversa fluidamente, com
 * histórico de sessão, no mesmo nível do vendedor IA das lojas:
 *   - prompt consultivo com catálogo, tabela de orçamentos e regras do lojista
 *   - responde perguntas abertas (material, garantia, prazo, entrega...)
 *   - conduz o orçamento naturalmente (pergunta serviço → medida → material)
 *   - nunca inventa preço: só cita valores da tabela de orçamentos
 *   - extração de ENTIDADES (servico/medida/material) p/ o cálculo local seguro
 *   - detecta vontade de falar com humano
 * Cascata: Gemini (chaves em rotação) → resposta padrão segura se tudo falhar.
 * Multi-tenant: resolve o bot pelo telefone (whatsapp_bots); se não houver,
 * aceita "perfil" inline no body (perfil do config.json do bot standalone).
 * Sem auth (verify_jwt=false) — validação feita pelo bot cliente.
 */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ||
  "https://qbcplbcdxoyqpmcehnvu.supabase.co";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Workers de chat da SmartHubly (sem token, formato OpenAI SSE) — camada 0: quota própria, não consome Gemini.
const WORKERS: string[] = [
  "https://xmnhawlazaxrtorjavqe.supabase.co/functions/v1/ai-chat",
  "https://smekruzpxblgujsbkeao.supabase.co/functions/v1/ai-chat",
  "https://wjqhujbikjugkjnqavzc.supabase.co/functions/v1/ai-chat",
  "https://otniliznphksdavkitdu.supabase.co/functions/v1/ai-chat",
];

async function chamarWorker(prompt: string): Promise<any | null> {
  const messages = [{ role: "system" as const, content: "Responda SEMPRE em JSON puro, sem markdown e sem prefixo:" + prompt.slice(0, 3000) },
    { role: "user" as const, content: "Continue." }];
  for (const url of WORKERS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, stream: true }),
      });
      if (!res.ok) continue;
      const reader = res.body?.getReader();
      if (!reader) continue;
      const decoder = new TextDecoder();
      let content = "";
      let done = false;
      // timeout 45s
      const timeout = setTimeout(() => { done = true; reader.cancel().catch(() => {}); }, 45000);
      try {
        while (!done) {
          const { value, done: d } = await reader.read();
          if (d) break;
          const txt = decoder.decode(value, { stream: true });
          const lines = txt.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const payload = trimmed.slice(6).trim();
            if (payload === "[DONE]") { done = true; break; }
            try {
              const obj = JSON.parse(payload);
              const delta = obj?.choices?.[0]?.delta?.content || "";
              if (typeof delta === "string") content += delta;
            } catch { /* fragmento SSE, ignora */ }
          }
        }
      } finally {
        clearTimeout(timeout);
        reader.releaseLock?.();
      }
      if (!content) continue;
      let parsed: any;
      try { parsed = JSON.parse(content); }
      catch {
        const m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (m) {
          try { parsed = JSON.parse(m[1]); }
          catch { parsed = null; }
        } else {
          const m2 = content.match(/\{[\s\S]*\}/);
          if (m2) {
            try { parsed = JSON.parse(m2[0]); }
            catch { parsed = null; }
          }
        }
      }
      if (!parsed || !parsed.resposta_natural) continue;
      return {
        intencao: parsed.intencao || "pergunta_info",
        confiavel: typeof parsed.confiavel === "boolean" ? parsed.confiavel : true,
        encaminhar_humano: !!parsed.encaminhar_humano,
        resposta_natural: parsed.resposta_natural,
        servico: parsed.servico || null,
        medida: parsed.medida || null,
        material: parsed.material || null,
        extra: parsed.extra || "",
        entidade_nova: !!parsed.entidade_nova,
      };
    } catch {
      continue;
    }
  }
  return null;
}

// Ordem empírica: AIzaSyBX6dHQ tem quota estável no 2.5-flash; AQ.* retorna 404 no endpoint v1beta
// (chave do painel, serve p/ outro fluxo) — deixada por último como última esperança.
const KEYS: string[] = [
  "AIzaSyBX6dHQKVJw96EeDBLYgazOxOUpyFxUAmg",
  "AIzaSyASOPA6l7frTwOUhZmZvTpx2n88JXkPptc",
  "AQ.Ab8RN6JnCK8xYOY69s5j87RmGvekDfoNirItvutr3OfuTwCxFw",
];
// Ordem por confiabilidade testada: 2.5-flash e 3.5-flash respondem em todas as chaves.
// gemini-2.5-flash-lite retorna 404 nas chaves AQ.* e 429 no free tier; 3.6-flash retorna 503.
const MODELOS: string[] = ["gemini-2.5-flash", "gemini-3.5-flash"];

interface BotConfig {
  loja_nome: string;
  telefone: string;
  segmento: string;
  mensagem_boas_vindas: string;
  humano_telefone: string;
  tom_conversa: string;
  horario_atendimento: string;
  materiais_info: string;
  ativos: boolean;
  orcamentos: { servico: string; material?: string; preco_min: number | null; preco_max: number | null; observacao?: string; por_m2?: boolean; area_minima?: number }[];
  regras: { chave: string; valor: string }[];
  historico: { role: "user" | "assistant"; content: string }[];
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    servico: { type: "STRING", nullable: true },
    material: { type: "STRING", nullable: true },
    medida: { type: "STRING", nullable: true },
    intencao: { type: "STRING" },
    extra: { type: "STRING", nullable: true },
    resposta_natural: { type: "STRING" },
    confiavel: { type: "BOOLEAN" },
    encaminhar_humano: { type: "BOOLEAN" },
    entidade_nova: { type: "BOOLEAN" },
    historico_limpo: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
  },
  required: ["intencao", "confiavel", "encaminhar_humano", "resposta_natural", "entidade_nova"],
};

function normalizarTelefone(tel: string): string {
  return tel.replace(/[^\d+]/g, "").trim();
}

async function carregarBot(telefone: string): Promise<BotConfig | null> {
  const tel = normalizarTelefone(telefone);
  if (!tel) return null;
  const headers = {
    apikey: SERVICE_ROLE || Deno.env.get("SUPABASE_ANON_KEY") || "",
    Authorization: "Bearer " + (SERVICE_ROLE || Deno.env.get("SUPABASE_ANON_KEY") || ""),
  };
  const rBot = await fetch(
    `${SUPABASE_URL}/rest/v1/whatsapp_bots?telefone=eq.${tel}&select=*`,
    { headers },
  );
  if (!rBot.ok) return null;
  const bots = (await rBot.json()) as any[];
  const bot = bots?.find((b: any) => b.ativo) || bots?.[0] || null;
  if (!bot) return null;
  const [rOrc, rReg] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/bot_orcamentos?bot_id=eq.${bot.id}&select=servico,material,preco_min,preco_max,observacao,por_m2,area_minima`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/bot_regras?bot_id=eq.${bot.id}&select=chave,valor`, { headers }),
  ]);
  return {
    loja_nome: bot.loja_nome || "",
    telefone: bot.telefone || tel,
    segmento: bot.segmento || "",
    mensagem_boas_vindas: bot.mensagem_boas_vindas || "",
    humano_telefone: bot.humano_telefone || "",
    tom_conversa: bot.tom_conversa || "",
    horario_atendimento: bot.horario_atendimento || "",
    materiais_info: bot.materiais_info || "",
    ativos: bot.ativo !== false,
    orcamentos: rOrc.ok ? ((await rOrc.json()) as any[]) : [],
    regras: rReg.ok ? ((await rReg.json()) as any[]) : [],
    historico: [],
  };
}

function montarPrompt(bot: BotConfig, mensagem: string, hist: any[]): string {
  const orcamentosTxt = (bot.orcamentos || []).length
    ? (bot.orcamentos as any[]).map((o) =>
        `- ${o.servico}${o.material ? " (" + o.material + ")" : ""}: ${o.preco_min !== null && o.preco_min !== undefined ? "R$ " + Number(o.preco_min).toFixed(2).replace(".", ",") : "?"} a ${o.preco_max !== null && o.preco_max !== undefined ? "R$ " + Number(o.preco_max).toFixed(2).replace(".", ",") : "?"}${o.por_m2 ? " (preço por m², mínimo " + (o.area_minima || 1) + " m²)" : ""}${o.observacao ? " · " + o.observacao : ""}`)
      .join("\n")
    : "(nenhuma tabela de orçamento cadastrada ainda)";
  const regrasTxt = (bot.regras || []).length
    ? (bot.regras as any[]).map((r) => "- " + r.chave + ": " + r.valor).join("\n")
    : "(nenhuma regra especial)";
  const histTxt = hist.length
    ? "\nHISTÓRICO DA CONVERSA (as mensagens mais antigas vêm primeiro; a ÚLTIMA mensagem do histórico é a anterior à atual):\n" +
      hist.map((h: any) => (h.role === "user" ? "CLIENTE: " : "BOT: ") + (h.content || "")).join("\n")
    : "";
  return (
    "Você é o ATENDENTE virtual da loja '" + bot.loja_nome + "'" +
    (bot.segmento ? " (" + bot.segmento + ")" : "") + ". Você conversa como um atendente humano experiente, caloroso e direto — NÃO como robô de menu.\n\n" +
    "TABELA DE ORÇAMENTOS/SERVIÇOS DA LOJA (SUA ÚNICA FONTE DE PREÇOS — nunca invente):\n" + orcamentosTxt + "\n\n" +
    "REGRAS DO LOJISTA:\n" + (regrasTxt || "(nenhuma regra especial)") + "\n\n" +
    "CONFIGURAÇÕES:\n" +
    (bot.tom_conversa ? "- Tom de conversa: " + bot.tom_conversa + "\n" : "") +
    (bot.horario_atendimento ? "- Horário de atendimento: " + bot.horario_atendimento + "\n" : "") +
    (bot.materiais_info ? "- Info de materiais: " + bot.materiais_info.slice(0, 400) + "\n" : "") +
    (bot.mensagem_boas_vindas ? "- Boas-vindas oficial: \"" + bot.mensagem_boas_vindas + "\"\n" : "") +
    histTxt +
    "\n\n---\nMENSAGEM ATUAL DO CLIENTE: " + JSON.stringify(mensagem) + "\n---\n\n" +
    "SUA TAREFA — responda SEMPRE em JSON puro, sem markdown, sem crases:\n" +
    "1) resposta_natural: sua resposta de atendente. Tom brasileiro informal e educado, curtinho (1-3 frases), use no máximo 1 emoji. Se o cliente pediu orçamento e faltam dados, conduza naturalmente: pergunte o que falta (serviço → medida → material) de forma humana, citando exemplos. Se já tem tudo, diga que o orçamento está pronto e apresente os dados em 'servico/medida/material' p/ o sistema calcular. NUNCA invente preço, prazo, horário ou número de telefone que não esteja nas configurações acima. Se o cliente pedir o telefone da loja e não houver número nas configurações, diga que um especialista vai chamá-lo por aqui no WhatsApp — nunca escreva um número falso. Se o cliente perguntar algo que a loja não oferece, seja honesto e sugira o serviço mais próximo da tabela.\n" +
    "2) intencao: uma de [orcamento, pergunta_info, agendar_visita, chamar_humano, saudacao, despedida, resposta_sim, resposta_nao, negociacao, desconhecido]. 'orcamento' = está coletando/entregando orçamento; 'pergunta_info' = dúvida sobre preço/material/horário/garantia (SÓ encaminha humano se a resposta NÃO estiver nas configurações); 'chamar_humano' = cliente pediu EXPLICITAMENTE pessoa/atendente/responsável. Se a pergunta já tem resposta no horário de atendimento/info de materiais das configurações, responda direto e NUNCA marque encaminhar_humano.\n" +
    "3) servico: o NOME EXATO, letra por letra, de UM serviço da tabela (copie da linha da tabela, ex: 'Grade / Muro em grade', 'Portão (correr ou basculante)') — apenas se a mensagem atual o menciona pela primeira vez; senão null. Se falar 'grade', use 'Grade / Muro em grade'; 'portão', use 'Portão (correr ou basculante)'.\n" +
    "4) medida: número/dimensão mencionada (ex: '12', '3x2', '3,5 metros', '150cm') ou null — apenas se a mensagem atual traz medida nova.\n" +
    "5) material: 'inox' | 'galvanizado' ou null — apenas se a mensagem atual traz material novo.\n" +
    "6) entidade_nova: true SE a mensagem atual trouxe servico OU medida OU material novo em relação ao histórico; false caso contrário.\n" +
    "7) confiavel: true se você entende bem a mensagem; false se está ambígua.\n" +
    "8) encaminhar_humano: true APENAS se a mensagem atual pede explicitamente pessoa real.\n" +
    "9) historico_limpo: o histórico atualizado INCLUINDO a mensagem atual do cliente e SUA resposta, em ordem. Máximo 16 mensagens (6 mais recentes do par cliente/bot). Se passar, descarte as mais antigas.\n" +
    "Regras finais: resposta_natural NUNCA deve conter preços calculados — quem calcula é o sistema; você só coleta dados e conversa. Não mande listas numeradas. Não use negrito. Se a mensagem não tem relação com a loja (assuntos pessoais, spam), responda educado redirecionando: intencao='desconhecido', confiavel=false. IMPORTANTE — só conduza o funil de orçamento (perguntar medida/material) se o histórico de conversa mostrar que um orçamento está em andamento (o cliente já falou de um serviço com a loja). Se NÃO houver orçamento em andamento no histórico, responda sobre a empresa/pergunta do cliente sem empurrar orçamento e nunca pergunte medida ou material.\n" +
    "ATENÇÃO CRÍTICA — o campo 'resposta_natural' é OBRIGATÓRIO e NUNCA deve ser vazio, mesmo que você não tenha certeza da resposta: quando em dúvida, diga que vai anotar o contato e encaminhar a um atendente. Nunca responda com texto de 'não entendi' para mensagens normais em português sobre a loja."
  );
}

async function chamarGemini(prompt: string): Promise<any> {
  let lastErr = "";
  for (const key of KEYS) {
    for (const modelo of MODELOS) {
      try {
        const res = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/" + modelo +
            ":generateContent?key=" + encodeURIComponent(key),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 700,
                responseMimeType: "application/json",
                responseSchema: SCHEMA,
              },
            }),
          },
        );
        // 400 com schema inválido (ex.: ARRAY sem items) nunca resolve em retry:
        if (!res.ok && res.status === 400) {
          const txtErr = await res.text().catch(() => "");
          if (/response_schema|schema/i.test(txtErr)) {
            console.log("⚠️ schema rejeitado (400) — tentando SEM schema neste par chave/modelo");
            const res2 = await fetch(
              "https://generativelanguage.googleapis.com/v1beta/models/" + modelo +
                ":generateContent?key=" + encodeURIComponent(key),
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
                }),
              },
            );
            if (res2.ok) {
              const parsed = await parseGeminiRaw(res2);
              if (parsed) return { ...parsed, erro: null };
            }
            continue;
          }
        }
        if (!res.ok) {
          lastErr = `Gemini ${res.status}`;
          if (res.status === 429 || res.status === 403 || res.status >= 500) continue;
          continue;
        }
        const data = await res.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!raw) { lastErr = "resposta vazia"; continue; }
        let parsed: any;
        try { parsed = JSON.parse(raw); }
        catch {
          const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
          parsed = m ? JSON.parse(m[1]) : null;
        }
        if (!parsed || !parsed.intencao || !parsed.resposta_natural) { lastErr = "JSON incompleto"; continue; }
        return { ...parsed, erro: null };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        continue;
      }
    }
  }
  console.log("⚠️ serralheria-intent: todas as tentativas Gemini falharam:", lastErr);
  return null;
}

async function parseGeminiRaw(res: Response): Promise<any | null> {
  const data = await res.json().catch(() => null);
  if (!data) return null;
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!raw) return null;
  let parsed: any;
  try { parsed = JSON.parse(raw); }
  catch {
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) {
      try { parsed = JSON.parse(m[1]); }
      catch { parsed = null; }
    } else {
      const m2 = raw.match(/\{[\s\S]*\}/);
      if (m2) {
        try { parsed = JSON.parse(m2[0]); }
        catch { parsed = null; }
      }
    }
  }
  if (!parsed || !parsed.resposta_natural) return null;
  return {
    intencao: parsed.intencao || "pergunta_info",
    confiavel: typeof parsed.confiavel === "boolean" ? parsed.confiavel : true,
    encaminhar_humano: !!parsed.encaminhar_humano,
    resposta_natural: parsed.resposta_natural,
    servico: parsed.servico || null,
    medida: parsed.medida || null,
    material: parsed.material || null,
    extra: parsed.extra || "",
    entidade_nova: !!parsed.entidade_nova,
  };
}

function stripAcentos(s: string): string {
  // NFD separa acentos em combining marks; remover garante match com literais acentuados.
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function fallbackBot(bot: BotConfig, mensagem: string): any {
  const m = stripAcentos((mensagem || "").toLowerCase());
  let intencao = "desconhecido";
  let resposta = "";
  let encaminhar = false;
  const boasVindas = bot.mensagem_boas_vindas ||
    "Olá! Que bom te ver por aqui! Bem-vindo(a) à " + bot.loja_nome + "! Me diz o que você precisa que eu te ajudo na hora. 😊";
  if (/oi|ola|bom dia|boa tarde|boa noite|opa|salve|alo|e ai/.test(m)) {
    intencao = "saudacao"; resposta = boasVindas;
  } else if (/tchau|obrigad|valeu|vlw|falou|ate mais/.test(m)) {
    intencao = "despedida";
    resposta = "Obrigado por falar com a " + bot.loja_nome + "! 👋 Qualquer coisa, chama aqui. 😊";
  } else if (/(pessoa|atendente|humano|responsavel|fechar|visita|agendar)/.test(m)) {
    intencao = "chamar_humano"; encaminhar = true;
    resposta = "Claro! Vou te encaminhar pro responsável agora. Um instante! 😊";
  } else if (/(orcamento|valor|preco|quanto|cotacao)/.test(m)) {
    intencao = "orcamento";
    resposta = "Claro! Me passa os detalhes do que você precisa (serviço, medida e material) que eu monto o orçamento rapidinho. 😊";
  } else if (/(funcion|horario|aberto|sabado|domingo|semana|expediente)/.test(m) && bot.horario_atendimento) {
    intencao = "pergunta_info";
    resposta = bot.horario_atendimento + (bot.materiais_info ? "\n\n" + bot.materiais_info.slice(0, 300) : "");
  } else if (/(material|galvanizado|inox|enferruja|aco|diferenca)/.test(m) && bot.materiais_info) {
    intencao = "pergunta_info";
    resposta = bot.materiais_info.slice(0, 400);
  } else if (/(onde|endereco|atende|bairro|cidade|regiao|entrega)/.test(m)) {
    intencao = "pergunta_info";
    resposta = "Atendemos em toda a região! Me passa seu endereço que confirmamos a cobertura. 😊";
  } else if (/(garantia|prazo|tempo de entrega|quanto tempo|durabilidade)/.test(m)) {
    intencao = "pergunta_info";
    resposta = "Boa pergunta! Prazos e garantia variam conforme o serviço e o material. Me diz o que você precisa que o responsável te passa os detalhes certinhos por aqui mesmo. 😊";
  } else {
    resposta = "Não entendi direito 😅 Me diz em uma frase o que você precisa — por exemplo: \"quero um portão de 3 metros em inox\".";
  }
  return {
    erro: "IA sem resposta",
    intencao, confiavel: intencao !== "desconhecido", encaminhar_humano: encaminhar,
    resposta_natural: resposta, servico: null, medida: null, material: null,
    entidade_nova: false, historico_limpo: [],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const telefone: string = (body.telefone || body.numero || body.phone || "").toString().trim();
  const mensagem: string = (body.mensagem || body.texto || body.text || "").toString().trim();
  const historico: any[] = Array.isArray(body.historico) ? body.historico : [];
  const maxHist = 16;
  const hist = historico.slice(-maxHist);

  // 1) carregar bot pelo telefone (multi-tenant) OU usar perfil inline
  let bot: BotConfig | null = await carregarBot(telefone);
  if (!bot && body.perfil) {
    const p = body.perfil;
    bot = {
      loja_nome: p.nome_empresa || p.loja_nome || "loja",
      telefone: p.bot_telefone || telefone,
      segmento: p.segmento || p.niche || "",
      mensagem_boas_vindas: p.mensagem_boas_vindas || "",
      humano_telefone: p.humano_telefone || "",
      tom_conversa: p.tom_conversa || "amigável, direto e informal",
      horario_atendimento: p.horarios || "",
      materiais_info: p.materiais_info || "",
      ativos: true,
      orcamentos: Object.entries(p.servicos || {}).map(([servico, v]: any) => {
        const preco = v.preco_por_m2 || v.preco_por_un || [null, null];
        return {
          servico, material: null,
          preco_min: preco[0] !== undefined ? preco[0] : null,
          preco_max: preco[1] !== undefined ? preco[1] : null,
          observacao: "", por_m2: !!v.por_m2, area_minima: v.area_minima || 1,
        };
      }),
      regras: [],
      historico: [],
    };
    if (Array.isArray(p.extras)) {
      (bot.orcamentos as any[]).push({
        servico: "Adicionais", material: null,
        preco_min: null, preco_max: null,
        observacao: (p.extras as any[]).map((e: any) => e.nome + " (R$ " + Number(e.preco).toFixed(2) + ")").join("; "),
      });
    }
  }
  // Perfil inline (config.json do Termux) COMPLEMENTA o bot do banco:
  // o registro do banco pode estar desatualizado; o config é a fonte de verdade em produção.
  if (bot && body.perfil) {
    const p = body.perfil as any;
    if (p.horarios && !bot.horario_atendimento) bot.horario_atendimento = p.horarios;
    if (p.materiais_info && !bot.materiais_info) bot.materiais_info = p.materiais_info;
    if (p.mensagem_boas_vindas && !bot.mensagem_boas_vindas) bot.mensagem_boas_vindas = p.mensagem_boas_vindas;
    if (Array.isArray(p.servicos) && p.servicos.length) {
      bot.orcamentos = p.servicos.map((s: any) => ({
        servico: s.nome || s.servico,
        material: s.material || null,
        preco_min: s.preco_min ?? s.preco_inicial ?? null,
        preco_max: s.preco_max ?? s.preco_final ?? null,
        observacao: s.observacao || "",
        por_m2: !!s.por_m2,
        area_minima: s.area_minima || 1,
      }));
    }
  }
  if (!bot) {
    return corsJson({
      erro: "loja não cadastrada: número " + (telefone || "(vazio)") + " não tem bot ativo na SmartHubly",
      intencao: "desconhecido", confiavel: false, encaminhar_humano: false,
      resposta_natural: "", entidade_nova: false, historico_limpo: [],
    });
  }
  if (!mensagem) {
    return corsJson({
      erro: "mensagem vazia",
      intencao: "irrelevante", confiavel: false, encaminhar_humano: false,
      resposta_natural: "Não recebi nenhuma mensagem. O que você precisa? 😊",
      entidade_nova: false, historico_limpo: [],
    });
  }

  // 2) conversar com IA — camada 0: workers próprios; camada 1: Gemini direto
  const prompt = montarPrompt(bot, mensagem, hist);
  let ia = await chamarWorker(prompt);
  if (!ia) ia = await chamarGemini(prompt);
  if (ia) {
    ia.extra = ia.extra || ia.resumo || "";
    ia.material = ia.material || null;
    // Se a IA não retornou historico_limpo (workers não têm o campo no schema),
    // gerar localmente a partir do histórico recebido + mensagem + resposta.
    if (!Array.isArray(ia.historico_limpo) || !ia.historico_limpo.length) {
      const histNovo: string[] = [];
      for (const h of hist) histNovo.push((h.role === "user" ? "CLIENTE: " : "BOT: ") + (h.content || ""));
      histNovo.push("CLIENTE: " + mensagem);
      const resp = (ia.resposta_natural || "").trim();
      if (resp) histNovo.push("BOT: " + resp);
      ia.historico_limpo = histNovo.slice(-16);
    }
    return corsJson({ ...ia, loja: bot.loja_nome });
  }
  // 3) fallback local por palavras-chave (com contexto da loja)
  const fb = fallbackBot(bot, mensagem);
  return corsJson({ ...fb, loja: bot.loja_nome });
});

function corsJson(obj: any): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
