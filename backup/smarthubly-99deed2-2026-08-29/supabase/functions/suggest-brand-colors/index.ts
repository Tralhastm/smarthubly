// Edge function: sugere paleta de cores via IA com cadeia de fallback
// (Lovable AI → Google AI super-admin → AI Workers).
// Otimizada: timeout curto, sem bloquear quando o gateway tá lento.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAiJson } from "../_shared/ai-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cache em memória de respostas pra niches comuns (TTL 1h)
const cache = new Map<string, { at: number; data: any }>();
const TTL_MS = 60 * 60 * 1000;

const SYSTEM = `Você é especialista em branding e psicologia das cores aplicada ao varejo brasileiro.
Receba o nicho do negócio e devolva UMA paleta perfeita.
REGRAS:
- Priorize legibilidade. Fundo deve ser CLARO (próximo ao branco) na maioria dos casos varejo/delivery.
- Modo escuro só pra nicho noturno (bar, gaming, estética dark).
- Use psicologia: laranja/vermelho=apetite, verde=saúde/frescor, azul=confiança, roxo=luxo, rosa=beleza, marrom=artesanal.
- Devolva apenas JSON válido com a estrutura: {"primary":"#RRGGBB","bg":"#RRGGBB","mode":"light|dark","reasoning":"2-3 frases em PT-BR"}.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { niche = "", description = "", storeName = "" } = await req.json();
    const key = `${niche.toLowerCase().trim()}|${description.toLowerCase().trim()}`;

    // Cache hit: resposta instantânea
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < TTL_MS) {
      return new Response(JSON.stringify({ ...cached.data, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const userPrompt = `Loja: ${storeName || "—"}\nNicho: ${niche}\nDescrição: ${description || "—"}\n\nResponda apenas com o JSON da paleta.`;

    // Timeout race: se IA demorar mais de 12s, devolve sugestão padrão
    const aiPromise = callAiJson<{ primary: string; bg: string; mode: string; reasoning: string }>(
      supabase,
      { systemPrompt: SYSTEM, userPrompt, maxTokens: 300, temperature: 0.7 },
    );
    const timeout = new Promise<null>(r => setTimeout(() => r(null), 12_000));
    const result = await Promise.race([aiPromise, timeout]);

    if (!result) {
      // Fallback inteligente sem IA: heurística por nicho
      const fb = heuristicPalette(niche);
      cache.set(key, { at: Date.now(), data: fb });
      return new Response(JSON.stringify({ ...fb, fallback: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    cache.set(key, { at: Date.now(), data: result });
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[suggest-brand-colors]", e);
    // Mesmo no erro, devolve algo útil
    const fb = heuristicPalette("");
    return new Response(JSON.stringify({ ...fb, fallback: true, error: e instanceof Error ? e.message : "erro" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function heuristicPalette(niche: string) {
  const n = niche.toLowerCase();
  if (/(hambur|lanch|pizza|fast|burguer)/.test(n))
    return { primary: "#DC2626", bg: "#FFFFFF", mode: "light", reasoning: "Vermelho desperta apetite e urgência — perfeito pra fast food. Fundo branco mantém o foco no produto." };
  if (/(açai|acai|sorvete|gelato|fruta|hortifruti|salada|saud|veg)/.test(n))
    return { primary: "#059669", bg: "#FFFFFF", mode: "light", reasoning: "Verde transmite frescor e saúde. Combina com produtos naturais e refrescantes." };
  if (/(cafe|café|padar|doc|confeit|bolo)/.test(n))
    return { primary: "#92400E", bg: "#FAF7F2", mode: "light", reasoning: "Marrom + creme passa aconchego artesanal, ideal pra cafés e padarias." };
  if (/(salão|salao|barbe|estét|estet|man|cab|beauty|beleza)/.test(n))
    return { primary: "#DB2777", bg: "#FFFFFF", mode: "light", reasoning: "Rosa transmite cuidado e beleza, com fundo branco pra elegância e leveza." };
  if (/(farm|drog|saude|saúde)/.test(n))
    return { primary: "#059669", bg: "#FFFFFF", mode: "light", reasoning: "Verde é cor universal de saúde e bem-estar, transmite segurança." };
  if (/(bar|pub|nigh|noite|whisky|drink|cerveja|bebida)/.test(n))
    return { primary: "#D4A84C", bg: "#0F0F0F", mode: "dark", reasoning: "Escuro com dourado = atmosfera noturna premium, ideal pra bar e bebidas." };
  if (/(boutique|moda|roupa|perfu|luxury)/.test(n))
    return { primary: "#7C3AED", bg: "#FFFFFF", mode: "light", reasoning: "Roxo passa exclusividade e criatividade, ótimo pra moda e premium." };
  if (/(tech|gam|elet|inform)/.test(n))
    return { primary: "#3B82F6", bg: "#0F172A", mode: "dark", reasoning: "Azul + escuro é a linguagem visual de tech e gaming." };
  // Default seguro
  return { primary: "#2563EB", bg: "#FFFFFF", mode: "light", reasoning: "Azul confiança em fundo branco funciona para qualquer varejo: limpo, profissional e confiável." };
}
