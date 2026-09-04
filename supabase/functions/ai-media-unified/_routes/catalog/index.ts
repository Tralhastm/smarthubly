// ai-media-unified/_routes/catalog/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../../../_shared/cors.ts";
import { _callAiJson, _callAiVisionJson } from "../../../_shared/ai-fallback.ts";
import { authorizeCaller } from "../../../_shared/authorize-caller.ts";
import { getAuthUser } from "../../../_shared/auth.ts";

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface CatalogItem {
  name?: string;
  product_name?: string;
  price?: number;
  unit_price?: number;
  preco?: number;
  category?: string;
  description?: string;
  available?: boolean;
  disponivel?: boolean;
  cost_price?: number;
  resale_price?: number;
  variants?: Array<{ name?: string; price?: number; cost_price?: number; resale_price?: number; available?: boolean }>;
  variations?: any;
}

/** A mesma chave tolerante usada no catálogo para comparar nomes de produtos. */
function productMatchKey(value: string | null | undefined): string {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return normalized.split(/\s+/).filter(Boolean).sort().join(' ');
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function catalog(req: Request, body?: any): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const user = await getAuthUser(req);
    if (!user) return json({ error: "unauthorized" }, 401);

    const auth = await authorizeCaller(admin as any, user.id);
    if ("error" in auth) return json({ error: auth.error }, auth.status);

    const ct = req.headers.get("content-type") || "";
    let payload: any = {};
    
    if (ct.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File;
      if (!file) return json({ error: "file_required" }, 400);
      
      const kind = file.name.endsWith(".pdf") ? "pdf" : file.type.startsWith("image/") ? "image" : "txt";
      const buffer = await file.arrayBuffer();
      const content = kind === "txt" ? new TextDecoder().decode(buffer) : btoa(String.fromCharCode(...new Uint8Array(buffer)));
      
      payload = {
        supplierId: formData.get("supplierId"),
        supplierName: formData.get("supplierName"),
        priceType: formData.get("priceType") || "resale",
        profitMargin: parseFloat(formData.get("profitMargin") as string) || 0,
        tenantId: formData.get("tenantId") || auth.tenantId,
        kind,
        content,
        merge: formData.get("merge") !== "false"
      };
    } else {
      // O router unificado já faz o parse do JSON e passa no segundo argumento 'body'
      payload = body ?? (ct.includes("application/json") ? await req.json() : {});
    }
    
    const { supplierId, supplierName, tenantId, kind, content, merge = true } = payload;

    if (!kind || !content) {
      return json({ error: "missing_fields_kind_or_content" }, 400);
    }

    // Resolve ou cria fornecedor se supplierName for enviado
    let targetSupplierId = supplierId;
    let targetTenantId = tenantId || auth.tenantId;

    if (!targetSupplierId && supplierName && targetTenantId) {
      const { data: existing } = await admin.from('suppliers').select('id, tenant_id').eq('tenant_id', targetTenantId).ilike('name', supplierName.trim()).maybeSingle();
      if (existing) {
        targetSupplierId = existing.id;
      } else {
        const { data: newSup } = await admin.from('suppliers').insert({
          tenant_id: targetTenantId,
          name: supplierName.trim(),
          active: true
        }).select('id').single();
        targetSupplierId = newSup?.id;
      }
    }

    if (!targetSupplierId) return json({ error: "supplier_id_or_name_required" }, 400);

    const { data: supplier, error: sErr } = await admin
      .from("suppliers")
      .select("id, name, tenant_id")
      .eq("id", targetSupplierId)
      .maybeSingle();
    if (sErr || !supplier) return json({ error: "supplier_not_found" }, 404);
    
    if (!auth.isSuperAdmin && supplier.tenant_id !== auth.tenantId) {
      return json({ error: "forbidden" }, 403);
    }

    let text = "";
    let imageData: { data: string; mimeType: string } | undefined;

    if (kind === "pdf") {
      // PDF handling: pass as document to AI or text if possible. 
      // For now, treat as text/binary if short, or vision if we have a bridge.
      // Re-enabling with vision fallback.
      imageData = { data: content, mimeType: "application/pdf" };
    } else if (kind === "image") {
      let b64 = content;
      let mimeType = "image/png";
      if (typeof content === 'string' && content.startsWith('data:')) {
        const m = content.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.*)$/);
        if (m) {
          mimeType = m[1];
          b64 = m[2];
        }
      }
      imageData = { data: b64, mimeType };
    } else {
      text = String(content);
    }

    const SYSTEM = `Você é um extrator inteligente de catálogos de fornecedores brasileiros. Extraia produtos, custos, preços de venda e variações sem inventar dados.`;

    const USER = `Extraia desta ${kind === "image" ? "imagem" : "lista"} TODOS os produtos com preços.
Regras:
1. Retorne JSON: { \"items\": [{ \"name\", \"price\", \"cost_price\", \"resale_price\", \"category\", \"description\", \"available\", \"variants\" }] }.
2. \"name\" é o modelo sem a cor. Não junte modelos diferentes; preserve memória, RAM, 4G/5G, NFC, Pro, Max e edições especiais.
3. Se cores, capacidades ou outras opções do mesmo modelo tiverem preços diferentes, use como \"price\" o menor preço explícito e retorne cada opção em \"variants\": [{ \"name\": \"Preto\", \"price\": 1350, \"cost_price\": 1350, \"resale_price\": 0 }].
4. Se todas as opções tiverem o mesmo preço, também pode retornar as opções, mas não crie diferença de preço. Nunca invente cor ou preço.
5. Informe cost_price quando o catálogo der custo e resale_price quando der venda sugerida; use 0 quando ausente. Para cada variante, faça o mesmo.
6. \"variations\" antigo pode ser mantido como complemento, mas \"variants\" deve conter as opções que têm preço próprio.`;

    let items: CatalogItem[] = [];
    let warnings: string[] = [];

    try {
      if (kind === "image") {
        const res: any = await _callAiVisionJson(admin, {
          systemPrompt: SYSTEM,
          userPrompt: USER,
          imageData: imageData!,
          temperature: 0.1,
        });
        items = res?.items || [];
        warnings = res?.warnings || [];
      } else {
        const res: any = await _callAiJson(admin, {
          systemPrompt: SYSTEM,
          userPrompt: `CONTEÚDO:\n${text.slice(0, 30000)}\n\n${USER}`,
          temperature: 0.1,
        });
        items = res?.items || [];
        warnings = res?.warnings || [];
      }
    } catch (e: any) {
      return json({ error: "ai_unavailable", detail: String(e?.message || e) }, 503);
    }

    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: "no_items_extracted", warnings }, 422);
    }

    let skipped = 0;
    const skippedProducts: string[] = [];
    const matchedProducts: string[] = [];
    const priceTypes = payload.priceType === 'both' ? ['cost', 'resale'] : [payload.priceType || 'resale'];

    // O painel do fornecedor nunca cria produtos: somente o catálogo oficial
    // da loja é fonte de verdade para os itens que podem ser atualizados.
    const { data: catalogProducts, error: catalogError } = await admin
      .from('products')
      .select('id, name, price')
      .eq('tenant_id', targetTenantId);
    if (catalogError) return json({ error: 'catalog_products_query_failed', detail: catalogError.message }, 500);
    const productsByKey = new Map<string, any>();
    for (const product of catalogProducts || []) {
      const key = productMatchKey(product.name);
      if (key && !productsByKey.has(key)) productsByKey.set(key, product);
    }
    const catalogIds = [...productsByKey.values()].map((p: any) => p.id);
    const { data: existingVariants } = catalogIds.length
      ? await admin.from('product_variants').select('*').in('product_id', catalogIds)
      : { data: [] as any[] };
    const variantsByProduct = new Map<string, any[]>();
    for (const variant of existingVariants || []) {
      const list = variantsByProduct.get(variant.product_id) || [];
      list.push(variant);
      variantsByProduct.set(variant.product_id, list);
    }

    const results = [];
    for (const it of items) {
      const sourceName = String(it.name || it.product_name || "").trim();
      const name = sourceName.toLowerCase();
      const catalogProduct = productsByKey.get(productMatchKey(sourceName));
      if (!catalogProduct) {
        skipped++;
        if (sourceName) skippedProducts.push(sourceName);
        continue;
      }
      const variants = Array.isArray(it.variants) ? it.variants : [];
      const variantPrices = variants.map((v: any) => positiveNumber(v.price ?? v.cost_price ?? v.resale_price)).filter(Boolean);
      const cost = positiveNumber(it.cost_price);
      const resale = positiveNumber(it.resale_price);
      const generic = positiveNumber(it.price ?? it.unit_price ?? it.preco);
      const fallback = variantPrices.length ? Math.min(...variantPrices) : generic;
      const effectiveCost = cost || fallback;
      const effectiveResale = resale || generic || fallback;
      const newPrice = priceTypes.includes('cost') ? effectiveCost : effectiveResale;
      if (!name || !Number.isFinite(newPrice) || newPrice <= 0) {
        skipped++;
        continue;
      }
      
      // Busca produto real para ver margem se for custo
      let marginAlert = null;
      if (priceTypes.includes('cost')) {
        if (catalogProduct.price > 0) {
          const margin = ((catalogProduct.price - newPrice) / catalogProduct.price) * 100;
          if (margin < 10) marginAlert = `Margem crítica: ${margin.toFixed(0)}% (Venda: R$${catalogProduct.price})`;
        }
      }

      const { error } = await admin.from("supplier_product_prices").upsert(
        {
          supplier_id: targetSupplierId,
          product_name: String(catalogProduct.name).toLowerCase(),
          unit_price: newPrice,
          available: it.available ?? it.disponivel ?? true,
          description: it.description || null,
          variations: variants.length ? variants : (it.variations || null),
          price_types: priceTypes,
          metadata: {
            cost_price: effectiveCost || null,
            resale_price: effectiveResale || null,
            source_name: sourceName,
          },
        },
        { onConflict: "supplier_id,product_name" }
      );
      
      if (error) {
        skipped++;
      } else {
        matchedProducts.push(String(catalogProduct.name));
        // Se a linha informa cores, ela substitui exatamente as variações
        // atuais. Assim, cores que saíram do fornecedor deixam de aparecer.
        if (variants.length > 0) {
          const current = variantsByProduct.get(catalogProduct.id) || [];
          const incomingNames = new Set<string>();
          for (let i = 0; i < variants.length; i++) {
            const incoming: any = variants[i];
            const variantName = String(incoming.name || '').trim();
            if (!variantName) continue;
            const variantKey = variantName.toLocaleLowerCase('pt-BR');
            incomingNames.add(variantKey);
            const variantCost = positiveNumber(incoming.cost_price) || effectiveCost || positiveNumber(incoming.price);
            const variantResale = positiveNumber(incoming.resale_price) || effectiveResale || positiveNumber(incoming.price);
            const selectedVariantPrice = priceTypes.includes('cost') ? variantCost : variantResale;
            const old = current.find((v: any) => String(v.name).trim().toLocaleLowerCase('pt-BR') === variantKey);
            const row = {
              product_id: catalogProduct.id,
              tenant_id: targetTenantId,
              name: variantName,
              price_delta: selectedVariantPrice - Number(catalogProduct.price || 0),
              cost_price: variantCost || null,
              suggested_price: variantResale || selectedVariantPrice,
              needs_price_review: false,
              price_source: 'supplier_catalog',
              in_stock: incoming.available ?? incoming.disponivel ?? true,
              sort_order: i,
            };
            if (old) await admin.from('product_variants').update(row).eq('id', old.id);
            else await admin.from('product_variants').insert(row);
          }
          const staleIds = current
            .filter((v: any) => !incomingNames.has(String(v.name).trim().toLocaleLowerCase('pt-BR')))
            .map((v: any) => v.id);
          if (staleIds.length) await admin.from('product_variants').delete().in('id', staleIds);
        }
        if (marginAlert) results.push({ name: it.name, alert: marginAlert });
      }
    }

    return json({ total: items.length, updated: matchedProducts.length, skipped, skippedProducts: skippedProducts.slice(0, 100), matchedProducts: matchedProducts.slice(0, 100), warnings, alerts: results.slice(0, 20), items: items.slice(0, 100), products: items.slice(0, 100) });

  } catch (e) {
    console.error("[catalog] error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
