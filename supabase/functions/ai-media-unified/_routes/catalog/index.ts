// ai-media-unified/_routes/catalog/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../../_shared/cors.ts";
import { _callAiJson, _callAiVisionJson } from "../../_shared/ai-fallback.ts";
import { authorizeCaller } from "../../_shared/authorize-caller.ts";
import { getAuthUser } from "../../_shared/auth.ts";

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
  variations?: any;
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
      return json({ 
        error: "pdf_not_supported", 
        hint: "O processamento direto de PDF está em manutenção. Por favor, envie o catálogo como imagem ou copie o texto e envie como TXT." 
      }, 400);
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

    const SYSTEM = `Você é um extrator inteligente de catálogos de fornecedores brasileiros. Extraia produtos, preços e variações (cor, memória).`;

    const USER = `Extraia desta ${kind === "image" ? "imagem" : "lista"} TODOS os produtos com preços.
Regras:
1. JSON: { \"items\": [{ \"name\", \"price\", \"category\", \"description\", \"available\", \"variations\" }] }
2. \"name\": Limpo, ex: \"iPhone 15 Pro Max\"
3. \"price\": Numérico (R$)
4. \"variations\": { \"storage\": \"256GB\", \"color\": \"Blue\" }`;

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
          userPrompt: `CONTEÚDO:\n${text.slice(0, 10000)}\n\n${USER}`,
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
    const priceTypes = payload.priceType === 'both' ? ['cost', 'resale'] : [payload.priceType || 'resale'];

    for (const it of items) {
      const name = String(it.name || it.product_name || "").trim().toLowerCase();
      const price = Number(it.price ?? it.unit_price ?? it.preco ?? NaN);
      if (!name || !Number.isFinite(price) || price <= 0) {
        skipped++;
        continue;
      }
      
      const { error } = await admin.from("supplier_product_prices").upsert(
        {
          supplier_id: targetSupplierId,
          product_name: name,
          unit_price: price,
          available: it.available ?? it.disponivel ?? true,
          description: it.description || null,
          variations: it.variations || null,
          price_types: priceTypes
        },
        { onConflict: "supplier_id,product_name" }
      );
      if (error) skipped++;
    }

    return json({ total: items.length, skipped, warnings, items: items.slice(0, 10) });

  } catch (e) {
    console.error("[catalog] error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
