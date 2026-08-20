// Returns a per-driver Web App Manifest so that, when a motoboy installs
// the PWA from his tokenized panel URL, the home-screen icon opens DIRECTLY
// on his own panel (with token) instead of the landing page.
//
// The manifest is personalized per STORE: the icon shows the store's logo
// and the app name shows the store's name (instead of a generic "Motoboy"),
// so when a driver works for multiple stores each install is distinct.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const toDataIcon = async (src: string): Promise<{ src: string; type: string } | null> => {
  if (!src || src.startsWith('data:')) return src ? { src, type: src.slice(5, src.indexOf(';')) || 'image/png' } : null;
  try {
    const r = await fetch(src, { redirect: 'follow' });
    if (!r.ok) return null;
    const type = r.headers.get('content-type')?.split(';')[0] || 'image/png';
    if (!type.startsWith('image/')) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { src: `data:${type};base64,${btoa(binary)}`, type };
  } catch { return null; }
};

export async function driver_manifest(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') || '';
  const token = url.searchParams.get('token') || '';
  const origin = url.searchParams.get('origin') || `https://${url.hostname}`;
  const startPathParam = url.searchParams.get('start_path') || '';
  const scopePathParam = url.searchParams.get('scope_path') || '';

  // Fetch tenant info (name + logo) from the public view so the manifest
  // identity matches the store the driver is delivering for.
  let tenantName = 'Painel Motoboy';
  let tenantLogo = '';
  if (slug) {
    try {
      const supaUrl = Deno.env.get('SUPABASE_URL');
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
      if (supaUrl && anonKey) {
        const r = await fetch(
          `${supaUrl}/rest/v1/tenants_public?slug=eq.${encodeURIComponent(slug)}&select=name,logo_url&limit=1`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
        );
        if (r.ok) {
          const arr = await r.json();
          if (Array.isArray(arr) && arr[0]) {
            if (arr[0].name) tenantName = String(arr[0].name);
            if (arr[0].logo_url) tenantLogo = String(arr[0].logo_url);
          }
        }
      }
    } catch { /* fallback to defaults */ }
  }

  const startUrl = startPathParam
    ? `${origin}${startPathParam}`
    : (slug && token
      ? `${origin}/loja/${encodeURIComponent(slug)}/motoboy/${encodeURIComponent(token)}`
      : `${origin}/`);
  const scopeUrl = scopePathParam ? `${origin}${scopePathParam}` : startUrl;

  // Embed the logo as a data URL. Chrome often ignores manifest icons hosted
  // on a different origin or without ideal CORS headers, which makes the PWA
  // prompt fall back to the default/blank icon. Embedding keeps the manifest
  // self-contained for every store/domain.
  const icon = tenantLogo ? await toDataIcon(tenantLogo) : null;
  const iconSrc = icon?.src || `${origin}/placeholder.svg`;
  const iconType = icon?.type || 'image/svg+xml';

  // Short name fits on the home-screen label (max ~12 chars works well).
  const shortName = tenantName.length > 12 ? tenantName.slice(0, 12) : tenantName;

  const manifest = {
    name: tenantName,
    short_name: shortName,
    start_url: startUrl,
    scope: scopeUrl,
    id: startUrl,
    display: 'standalone',
    background_color: '#0F172A',
    theme_color: '#3B82F6',
    icons: [
      { src: iconSrc, sizes: '192x192', type: iconType, purpose: 'any maskable' },
      { src: iconSrc, sizes: '512x512', type: iconType, purpose: 'any maskable' },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });

  } catch (e) {
    console.error("[unified:driver-manifest] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
