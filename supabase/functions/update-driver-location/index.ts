// Edge function: motoboy envia sua localização atual.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { token, lat, lng, accuracy, heading, speed } = body;
    if (!token || typeof lat !== 'number' || typeof lng !== 'number') {
      return new Response(JSON.stringify({ error: 'token, lat, lng obrigatórios' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return new Response(JSON.stringify({ error: 'coordenadas inválidas' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: driver, error: driverError } = await supabase
      .from('drivers').select('id, tenant_id, active').eq('access_token', token).maybeSingle();
    if (driverError) throw driverError;
    if (!driver || !driver.active) {
      return new Response(JSON.stringify({ error: 'motoboy não autorizado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const values = {
      driver_id: driver.id,
      tenant_id: driver.tenant_id,
      lat,
      lng,
      accuracy: typeof accuracy === 'number' ? accuracy : null,
      heading: typeof heading === 'number' ? heading : null,
      speed: typeof speed === 'number' ? speed : null,
      updated_at: new Date().toISOString(),
    };
    const { data: existing, error: findError } = await supabase
      .from('driver_locations').select('id').eq('driver_id', driver.id).maybeSingle();
    if (findError) throw findError;

    if (existing?.id) {
      const { error } = await supabase.from('driver_locations').update(values).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('driver_locations').insert({ id: crypto.randomUUID(), ...values });
      if (error) throw error;
    }

    return new Response(JSON.stringify({ ok: true, updated_at: values.updated_at }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('update-driver-location error', error);
    return new Response(JSON.stringify({ error: error?.message || 'erro interno ao salvar localização' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
