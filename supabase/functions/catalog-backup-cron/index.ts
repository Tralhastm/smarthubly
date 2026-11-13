// Cron diário (#20) — Backup automático do catálogo
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RETENTION_DAYS = 30;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: tenants, error: tenantsError } = await supabase
    .from("tenants")
    .select("id, name, store_mode")
    .eq("auto_backup_catalog", true)
    .or("store_mode.neq.affiliate,store_mode.is.null");

  if (tenantsError) {
    console.error("tenants query failed", tenantsError.message);
    await supabase.from("automation_runs").insert({
      automation_type: "catalog_backup",
      status: "error",
      metrics: { tenants_backed_up: 0 },
      error_message: `tenants query failed: ${tenantsError.message}`,
    });
    return new Response(JSON.stringify({ ok: false, error: tenantsError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let backedUp = 0;
  const failures: string[] = [];

  for (const t of tenants ?? []) {
    try {
      const [productsRes, variantsRes, addonsRes] = await Promise.all([
        supabase.from("products").select("*").eq("tenant_id", t.id),
        supabase.from("product_variants").select("*").eq("tenant_id", t.id),
        supabase.from("product_addons").select("*").eq("tenant_id", t.id),
      ]);

      // Uma leitura falha não pode virar "catálogo vazio" salvo como backup válido.
      const readError = productsRes.error || variantsRes.error || addonsRes.error;
      if (readError) throw new Error(`catalog read failed: ${readError.message}`);

      const products = productsRes.data ?? [];
      const variants = variantsRes.data ?? [];
      const addons = addonsRes.data ?? [];

      const snapshot = {
        tenant_id: t.id,
        tenant_name: t.name,
        snapshotted_at: new Date().toISOString(),
        products,
        variants,
        addons,
      };
      const json = JSON.stringify(snapshot);

      const { error: insertError } = await supabase.from("catalog_backups").insert({
        tenant_id: t.id,
        product_count: products.length,
        variant_count: variants.length,
        addon_count: addons.length,
        snapshot,
        // Tamanho real do payload em bytes (UTF-8), não quantidade de unidades UTF-16.
        size_bytes: new TextEncoder().encode(json).length,
      });
      if (insertError) throw new Error(`backup insert failed: ${insertError.message}`);

      // Retenção: apaga backups > 30d (falha aqui não invalida o snapshot recém-criado,
      // mas precisa aparecer no resultado para não passar como execução perfeita).
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { error: deleteError } = await supabase
        .from("catalog_backups")
        .delete()
        .eq("tenant_id", t.id)
        .lt("created_at", cutoff);
      if (deleteError) {
        failures.push(`${t.id}: retention failed: ${deleteError.message}`);
      }

      backedUp++;
    } catch (err: any) {
      console.error("backup error", t.id, err?.message);
      failures.push(`${t.id}: ${err?.message ?? String(err)}`);
    }
  }

  const status = failures.length === 0 ? "success" : backedUp > 0 ? "error" : "error";
  const { error: logError } = await supabase.from("automation_runs").insert({
    automation_type: "catalog_backup",
    status,
    metrics: { tenants_backed_up: backedUp, tenants_total: tenants?.length ?? 0, failures: failures.slice(0, 10) },
    error_message: failures.length ? failures.slice(0, 10).join(" | ") : null,
  });
  if (logError) console.error("catalog_backup run log failed", logError.message);

  return new Response(
    JSON.stringify({ ok: failures.length === 0, backed_up: backedUp, failures }),
    { status: failures.length === 0 ? 200 : 207, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
