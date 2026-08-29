// Migrates products.image base64 data URIs into the product-images storage bucket
// and replaces the column value with the public URL.
// Call: POST { tenant_id?: string, limit?: number }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function dataUriToBytes(uri: string): { bytes: Uint8Array; mime: string } | null {
  const m = uri.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  } catch {
    return null;
  }
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  return "bin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const tenant_id: string | undefined = body.tenant_id;
  const limit: number = Math.min(Number(body.limit ?? 50), 200);

  let q = supabase
    .from("products")
    .select("id, tenant_id, image")
    .like("image", "data:image/%")
    .limit(limit);
  if (tenant_id) q = q.eq("tenant_id", tenant_id);

  const { data: rows, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];
  for (const row of rows ?? []) {
    const parsed = dataUriToBytes(row.image as string);
    if (!parsed) {
      results.push({ id: row.id, ok: false, reason: "invalid_data_uri" });
      continue;
    }
    const ext = extFromMime(parsed.mime);
    const path = `${row.tenant_id}/migrated-${row.id}.${ext}`;
    const up = await supabase.storage
      .from("product-images")
      .upload(path, parsed.bytes, { contentType: parsed.mime, upsert: true });
    if (up.error) {
      results.push({ id: row.id, ok: false, reason: up.error.message });
      continue;
    }
    const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
    const url = pub.publicUrl;
    const upd = await supabase.from("products").update({ image: url }).eq("id", row.id);
    if (upd.error) {
      results.push({ id: row.id, ok: false, reason: upd.error.message });
      continue;
    }
    results.push({ id: row.id, ok: true, url, bytes: parsed.bytes.length });
  }

  return new Response(
    JSON.stringify({
      processed: results.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
