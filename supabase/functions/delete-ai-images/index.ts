// Exclui em massa todas as fotos geradas por IA (marcadas com ?ai=1) de um tenant.
// - Remove o arquivo do bucket product-images
// - Limpa o campo image dos produtos (vira string vazia)
// Mantém intactas as fotos importadas da web (?src=google) e uploads manuais.
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

// Extrai o path dentro do bucket product-images de uma URL pública.
// Ex.: https://xxx.supabase.co/storage/v1/object/public/product-images/<tenantId>/<uuid>.png?ai=1
//      => "<tenantId>/<uuid>.png"
function extractStoragePath(url: string): string | null {
  try {
    const u = new URL(url);
    const marker = "/object/public/product-images/";
    const i = u.pathname.indexOf(marker);
    if (i === -1) return null;
    return decodeURIComponent(u.pathname.slice(i + marker.length));
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { tenantId } = await req.json();
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "tenantId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = admin();

    // 1) Lista todos os produtos do tenant cuja imagem é gerada por IA (?ai=1)
    const { data: products, error: selErr } = await supabase
      .from("products")
      .select("id, image")
      .eq("tenant_id", tenantId)
      .like("image", "%?ai=1%");

    if (selErr) throw selErr;

    const list = (products || []) as Array<{ id: string; image: string }>;
    if (list.length === 0) {
      return new Response(JSON.stringify({ deleted: 0, productsCleared: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Coleta caminhos no Storage e remove (em batches de 100)
    const paths = list
      .map((p) => extractStoragePath(p.image))
      .filter((x): x is string => !!x);

    let storageDeleted = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const slice = paths.slice(i, i + 100);
      const { data, error } = await supabase.storage.from("product-images").remove(slice);
      if (error) {
        console.warn("[delete-ai-images] storage remove error", error.message);
      } else {
        storageDeleted += (data || []).length;
      }
    }

    // 3) Limpa o campo image dos produtos
    const ids = list.map((p) => p.id);
    let cleared = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const { error, count } = await supabase
        .from("products")
        .update({ image: "" }, { count: "exact" })
        .in("id", slice);
      if (error) {
        console.warn("[delete-ai-images] update error", error.message);
      } else {
        cleared += count || slice.length;
      }
    }

    return new Response(
      JSON.stringify({
        productsCleared: cleared,
        storageDeleted,
        totalAiImagesFound: list.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
