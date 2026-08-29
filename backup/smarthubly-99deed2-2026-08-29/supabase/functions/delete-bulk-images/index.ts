// Exclui em massa fotos de produtos por origem:
//   source: 'ai'      -> apaga fotos com marker ?ai=1 (geradas por IA)
//   source: 'google'  -> apaga fotos com marker ?src=google (importadas da web)
//   source: 'all_auto'-> apaga ambas (mantém uploads manuais)
// Remove arquivos do bucket product-images e limpa o campo image dos produtos.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function extractStoragePath(url: string): string | null {
  try {
    const u = new URL(url);
    const marker = "/object/public/product-images/";
    const i = u.pathname.indexOf(marker);
    if (i === -1) return null;
    return decodeURIComponent(u.pathname.slice(i + marker.length));
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { tenantId, source } = await req.json();
    if (!tenantId || !source || !['ai', 'google', 'all_auto'].includes(source)) {
      return new Response(JSON.stringify({ error: "tenantId and source ('ai'|'google'|'all_auto') required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = admin();

    // Monta filtro OR conforme a origem
    let query = supabase.from("products").select("id, image").eq("tenant_id", tenantId);
    if (source === 'ai') {
      query = query.like("image", "%?ai=1%");
    } else if (source === 'google') {
      query = query.like("image", "%?src=google%");
    } else { // all_auto
      query = query.or("image.like.%?ai=1%,image.like.%?src=google%");
    }
    const { data: products, error: selErr } = await query;
    if (selErr) throw selErr;

    const list = (products || []) as Array<{ id: string; image: string }>;
    if (list.length === 0) {
      return new Response(JSON.stringify({ deleted: 0, productsCleared: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paths = list.map((p) => extractStoragePath(p.image)).filter((x): x is string => !!x);
    let storageDeleted = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const slice = paths.slice(i, i + 100);
      const { data, error } = await supabase.storage.from("product-images").remove(slice);
      if (error) console.warn("[delete-bulk] storage remove error", error.message);
      else storageDeleted += (data || []).length;
    }

    const ids = list.map((p) => p.id);
    let cleared = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const { error, count } = await supabase
        .from("products")
        .update({ image: "" }, { count: "exact" })
        .in("id", slice);
      if (error) console.warn("[delete-bulk] update error", error.message);
      else cleared += count || slice.length;
    }

    return new Response(
      JSON.stringify({ source, productsCleared: cleared, storageDeleted, totalFound: list.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
