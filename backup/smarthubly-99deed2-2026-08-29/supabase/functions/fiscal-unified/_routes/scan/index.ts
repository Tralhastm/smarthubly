// Extrai dados de Nota Fiscal a partir de:
//  - XML (NF-e/NFC-e) → parse nativo, 100% preciso
//  - PDF/imagem → IA multimodal (Gemini)
//
// Retorna: { chave_nfe, supplier, total, due_date, items: [...], confidence: {...}, source_type }
// Detecta duplicidade pela chave (consulta nfe_imports).

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SYSTEM = `Você é um extrator de dados de Notas Fiscais brasileiras (NF-e, NFC-e, NFS-e), boletos e faturas.
Analise a imagem e devolva APENAS JSON conforme o schema. Para cada campo extraído, retorne TAMBÉM um número de 0 a 1 em "confidence" indicando sua certeza (1 = certeza absoluta, 0 = chute).

Regras:
- "chave_nfe": 44 dígitos da chave de acesso (se visível). null se não houver.
- "supplier_name": razão social do emitente.
- "supplier_cnpj": apenas dígitos (14).
- "issue_date" e "due_date": YYYY-MM-DD. Se NF sem vencimento, due_date = issue_date.
- "total": valor TOTAL da nota em reais (ponto decimal).
- "kind": "payable" (nota de compra/fornecedor) ou "receivable" (nota emitida pra cliente).
- "items": array de produtos/serviços. Cada item: { description, quantity, unit, unit_price, total, ncm }.
- Se algum campo não aparece, retorne null. NÃO invente dados.`;

function parseNFeXml(xml: string): any {
  // Parser leve para os campos principais. NF-e brasileira segue padrão SEFAZ.
  const pick = (re: RegExp): string | null => {
    const m = xml.match(re);
    return m ? m[1].trim() : null;
  };
  const chave = pick(/Id="NFe(\d{44})"/) || pick(/<chNFe>(\d{44})<\/chNFe>/);
  const supplier_name = pick(/<emit>[\s\S]*?<xNome>([^<]+)<\/xNome>/);
  const supplier_cnpj = pick(/<emit>[\s\S]*?<CNPJ>(\d+)<\/CNPJ>/);
  const issue_date = pick(/<dhEmi>(\d{4}-\d{2}-\d{2})/);
  const total = pick(/<ICMSTot>[\s\S]*?<vNF>([\d.]+)<\/vNF>/);
  const due_date = pick(/<dup>[\s\S]*?<dVenc>(\d{4}-\d{2}-\d{2})<\/dVenc>/) || issue_date;

  // Items <det> ... <prod><xProd/><qCom/><uCom/><vUnCom/><vProd/><NCM/>
  const items: any[] = [];
  const detRe = /<det\b[^>]*>[\s\S]*?<\/det>/g;
  let m;
  while ((m = detRe.exec(xml)) !== null) {
    const block = m[0];
    items.push({
      description: pick.call({ matchAll: block }, /<xProd>([^<]+)<\/xProd>/) || extractTag(block, 'xProd'),
      quantity: Number(extractTag(block, 'qCom')) || null,
      unit: extractTag(block, 'uCom'),
      unit_price: Number(extractTag(block, 'vUnCom')) || null,
      total: Number(extractTag(block, 'vProd')) || null,
      ncm: extractTag(block, 'NCM'),
    });
  }

  return {
    chave_nfe: chave,
    supplier_name,
    supplier_cnpj,
    issue_date,
    due_date,
    total: total ? Number(total) : null,
    kind: 'payable',
    items,
    // XML é parse exato — confiança máxima em tudo
    confidence: { _all: 1 },
    source_type: 'xml',
  };
}

function extractTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return m ? m[1].trim() : null;
}

export async function scan(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { tenant_id, xml, image_base64, mime_type, source_filename } = body;
    if (!tenant_id) {
      return new Response(JSON.stringify({ error: 'tenant_id obrigatório' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let extracted: any;

    // ============== PATH 1: XML — parse nativo ==============
    if (xml && typeof xml === 'string' && xml.includes('<')) {
      extracted = parseNFeXml(xml);
    }
    // ============== PATH 2: PDF/Imagem — IA multimodal ==============
    else if (image_base64) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      const dataUrl = image_base64.startsWith('data:')
        ? image_base64
        : `data:${mime_type || 'image/jpeg'};base64,${image_base64}`;
      const base64Only = dataUrl.replace(/^data:[^;]+;base64,/, '');
      const mimeOnly = mime_type || 'image/jpeg';

      const jsonSchemaProps = {
        chave_nfe: { type: ['string', 'null'] },
        supplier_name: { type: ['string', 'null'] },
        supplier_cnpj: { type: ['string', 'null'] },
        issue_date: { type: ['string', 'null'] },
        due_date: { type: ['string', 'null'] },
        total: { type: ['number', 'null'] },
        kind: { type: ['string', 'null'] },
        items: { type: 'array' },
        confidence: { type: 'object' },
      };

      // -------- Tentativa 1: Lovable AI --------
      const tryLovable = async (): Promise<any | null> => {
        const key = Deno.env.get('LOVABLE_API_KEY');
        if (!key) return null;
        try {
          const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { role: 'system', content: SYSTEM },
                { role: 'user', content: [
                  { type: 'text', text: 'Extraia todos os campos e itens da nota. Responda APENAS JSON.' },
                  { type: 'image_url', image_url: { url: dataUrl } },
                ]},
              ],
              response_format: { type: 'json_object' },
            }),
          });
          if (!resp.ok) { console.log('[scan-invoice] Lovable falhou', resp.status); return null; }
          const j = await resp.json();
          const raw = j?.choices?.[0]?.message?.content || '{}';
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) { console.error('[scan-invoice] Lovable exception', e); return null; }
      };

      // -------- Tentativa 2: Google AI direto (api_keys) --------
      const tryGoogle = async (): Promise<any | null> => {
        const { data: keys } = await supabase.from('api_keys')
          .select('id, api_key').eq('provider', 'google_ai').eq('is_exhausted', false)
          .order('last_used_at', { ascending: true, nullsFirst: true });
        const envKey = Deno.env.get('GOOGLE_AI_API_KEY');
        const all = [...(keys || []), ...(envKey ? [{ id: '__env__', api_key: envKey }] : [])];
        for (const k of all) {
          try {
            const resp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${k.api_key}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ role: 'user', parts: [
                    { text: SYSTEM + '\n\nExtraia todos os campos e itens da nota. Responda APENAS JSON puro.' },
                    { inlineData: { mimeType: mimeOnly, data: base64Only } },
                  ]}],
                  generationConfig: { responseMimeType: 'application/json' },
                }),
              }
            );
            if (resp.status === 429 || resp.status === 403) {
              if (k.id !== '__env__') await supabase.from('api_keys').update({ is_exhausted: true }).eq('id', k.id);
              continue;
            }
            if (!resp.ok) { console.log('[scan-invoice] Google falhou', resp.status); continue; }
            if (k.id !== '__env__') await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', k.id);
            const j = await resp.json();
            const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            const m = text.match(/(\{[\s\S]*\})/);
            return JSON.parse(m ? m[1] : text);
          } catch (e) { console.error('[scan-invoice] Google exception', e); continue; }
        }
        return null;
      };

      // -------- Tentativa 3: AI Workers (chat com imagem) --------
      const tryWorkers = async (): Promise<any | null> => {
        const { data: workers } = await supabase.from('ai_workers')
          .select('id, base_url, is_exhausted')
          .eq('is_active', true).eq('worker_type', 'chat')
          .order('is_exhausted', { ascending: true })
          .order('last_used_at', { ascending: true, nullsFirst: true });
        for (const w of (workers || [])) {
          try {
            const url = w.base_url.includes('/functions/') ? w.base_url : `${w.base_url}/functions/v1/ai-chat`;
            const resp = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: [{ role: 'user', content: [
                  { type: 'text', text: SYSTEM + '\n\nExtraia todos os campos e itens da nota. Responda APENAS JSON puro.' },
                  { type: 'image_url', image_url: { url: dataUrl } },
                ]}],
                systemPrompt: SYSTEM,
                tenantName: 'Sistema',
                niche: 'fiscal',
              }),
            });
            if (!resp.ok) {
              if ([429, 402, 503].includes(resp.status) && !w.is_exhausted) {
                await supabase.from('ai_workers').update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq('id', w.id);
              }
              continue;
            }
            const reader = resp.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = ''; let full = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n'); buffer = lines.pop() || '';
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const s = line.slice(6).trim();
                if (!s || s === '[DONE]') continue;
                try { const p = JSON.parse(s); const t = p.choices?.[0]?.delta?.content; if (t) full += t; } catch {}
              }
            }
            const m = full.match(/(\{[\s\S]*\})/);
            if (!m) continue;
            await supabase.from('ai_workers').update({ last_used_at: new Date().toISOString() }).eq('id', w.id);
            return JSON.parse(m[1]);
          } catch (e) { console.error('[scan-invoice] Worker exception', e); continue; }
        }
        return null;
      };

      extracted = await tryLovable();
      if (!extracted) { console.log('[scan-invoice] Tentando Google...'); extracted = await tryGoogle(); }
      if (!extracted) { console.log('[scan-invoice] Tentando Workers...'); extracted = await tryWorkers(); }
      if (!extracted) {
        return new Response(JSON.stringify({ error: 'Todos os provedores de IA falharam. Tente novamente em instantes.' }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Normaliza: às vezes a IA retorna {value, confidence} por campo. Achata para valor plano + objeto confidence.
      const flat: any = {};
      const conf: any = {};
      const unwrap = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) ? v.value : v;
      for (const [k, v] of Object.entries(extracted)) {
        if (k === 'items' && Array.isArray(v)) {
          flat.items = v.map((it: any) => {
            const o: any = {};
            for (const [ik, iv] of Object.entries(it || {})) o[ik] = unwrap(iv);
            return o;
          });
        } else if (k === 'confidence') {
          Object.assign(conf, v || {});
        } else {
          flat[k] = unwrap(v);
          if (v && typeof v === 'object' && !Array.isArray(v) && 'confidence' in v) conf[k] = (v as any).confidence;
        }
      }
      flat.confidence = { ...conf, ...(flat.confidence || {}) };
      extracted = flat;
      extracted.source_type = mime_type?.includes('pdf') ? 'pdf' : 'image';
      void jsonSchemaProps;
    } else {
      return new Response(JSON.stringify({ error: 'Envie xml OU image_base64' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ============== Detecta duplicidade pela chave ==============
    let duplicate: any = null;
    if (extracted.chave_nfe) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const { data: dup } = await supabase
        .from('nfe_imports')
        .select('id, created_at, status, apr_id')
        .eq('tenant_id', tenant_id)
        .eq('chave_nfe', extracted.chave_nfe)
        .eq('status', 'confirmed')
        .maybeSingle();
      if (dup) duplicate = dup;
    }

    return new Response(JSON.stringify({ ok: true, extracted, duplicate, source_filename }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('scan-invoice error', e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  } catch (e) {
    console.error("[unified:scan] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
