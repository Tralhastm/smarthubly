import { json } from "../../../_shared/router.ts";
import { corsHeaders } from "../../../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

export default async function handler(req: Request, payload: any) {
  try {
    const { txtContent, supplierName, priceType, profitMargin, shippingFee, tenantId } = payload;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let targetSupplierId = null;
    if (supplierName) {
      const { data: existing } = await supabase.from('suppliers').select('id').eq('tenant_id', tenantId).ilike('name', supplierName.trim()).maybeSingle();
      if (existing) {
        targetSupplierId = existing.id;
      } else {
        const { data: newSup } = await supabase.from('suppliers').insert({ tenant_id: tenantId, name: supplierName.trim(), active: true }).select('id').single();
        targetSupplierId = newSup?.id;
      }
    }

    const parseLocally = (text: string) => {
      const lines = text.split('\n');
      const products = [];
      for (const line of lines) {
        const match = line.match(/(.+?)\s*[-:]?\s*R?\$\s*([\d.,]+)/i);
        if (match) {
          products.push({
            name: match[1].trim(),
            price: parseFloat(match[2].replace('.', '').replace(',', '.')),
            category: 'Geral',
            description: ''
          });
        }
      }
      return { products };
    };

    const result = parseLocally(txtContent);
    
    if (targetSupplierId && result.products.length > 0) {
      const priceTypes = priceType === 'both' ? ['cost', 'resale'] : [priceType || 'resale'];
      for (const p of result.products) {
        await supabase.from('supplier_product_prices').upsert({
          supplier_id: targetSupplierId,
          product_name: p.name.toLowerCase(),
          unit_price: p.price,
          available: true,
          price_types: priceTypes
        }, { onConflict: 'supplier_id,product_name' });
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      count: result.products.length, 
      supplier_id: targetSupplierId,
      products: result.products 
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[unified:parse-txt] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}
