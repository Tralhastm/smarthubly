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

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name, store_mode")
    .eq("auto_backup_catalog", true)
    .neq("store_mode", "affiliate");

  let backedUp = 0;

  for (const t of tenants ?? []) {
    try {
      const [{ data: products }, { data: variants }, { data: addons }] = await Promise.all([
        supabase.from("products").select("*").eq("tenant_id", t.id),
        supabase.from("product_variants").select("*").eq("tenant_id", t.id),
        supabase.from("product_addons").select("*").eq("tenant_id", t.id),
      ]);

      const snapshot = {
        tenant_id: t.id,
        tenant_name: t.name,
        snapshotted_at: new Date().toISOString(),
        products: products ?? [],
        variants: variants ?? [],
        addons: addons ?? [],
      };
      const json = JSON.stringify(snapshot);

      await supabase.from("catalog_backups").insert({
        tenant_id: t.id,
        product_count: products?.length ?? 0,
        variant_count: variants?.length ?? 0,
        addon_count: addons?.length ?? 0,
        snapshot,
        size_bytes: json.length,
      });

      // Retenção: apaga backups > 30d
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from("catalog_backups").delete().eq("tenant_id", t.id).lt("created_at", cutoff);

      backedUp++;
    } catch (err: any) {
      console.error("backup error", t.id, err?.message);
    }
  }

  await supabase.from("automation_runs").insert({
    automation_type: "catalog_backup",
    status: "success",
    metrics: { tenants_backed_up: backedUp },
  });

  return new Response(JSON.stringify({ ok: true, backed_up: backedUp }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
