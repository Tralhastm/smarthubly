// Edge function: motoboy envia sua localização atual.
// Autenticada por driver access_token (sem JWT do supabase) — qualquer um com o token do motoboy pode atualizar.
// Faz upsert em driver_locations.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { token, lat, lng, accuracy, heading, speed } = body;

    if (!token || typeof lat !== 'number' || typeof lng !== 'number') {
      return new Response(JSON.stringify({ error: 'token, lat, lng obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return new Response(JSON.stringify({ error: 'coordenadas inválidas' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Valida motoboy via access_token
    const { data: driver, error: dErr } = await supabase
      .from('drivers')
      .select('id, tenant_id, active')
      .eq('access_token', token)
      .maybeSingle();

    if (dErr || !driver || !driver.active) {
      return new Response(JSON.stringify({ error: 'motoboy não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upsert por driver_id (constraint UNIQUE)
    const { error: upErr } = await supabase
      .from('driver_locations')
      .upsert({
        driver_id: driver.id,
        tenant_id: driver.tenant_id,
        lat, lng,
        accuracy: typeof accuracy === 'number' ? accuracy : null,
        heading: typeof heading === 'number' ? heading : null,
        speed: typeof speed === 'number' ? speed : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'driver_id' });

    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('update-driver-location error', e);
    return new Response(JSON.stringify({ error: e?.message || 'erro interno' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
