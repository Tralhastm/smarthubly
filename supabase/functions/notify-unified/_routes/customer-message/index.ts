import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function generateVapidAuthHeader(endpoint: string, vapidPublicKey: string, vapidPrivateKey: string, sub: string) {
  function b64dec(str: string): Uint8Array {
    const padding = "=".repeat((4 - (str.length % 4)) % 4);
    const b64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64enc(data: Uint8Array): string {
    let s = ""; for (const b of data) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  const audience = new URL(endpoint).origin;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const headerB64 = b64enc(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payloadB64 = b64enc(new TextEncoder().encode(JSON.stringify({ aud: audience, exp: expiration, sub })));
  const unsignedToken = `${headerB64}.${payloadB64}`;
  const privateKeyBytes = b64dec(vapidPrivateKey);
  const publicKeyBytes = b64dec(vapidPublicKey);
  const x = b64enc(publicKeyBytes.slice(1, 33));
  const y = b64enc(publicKeyBytes.slice(33, 65));
  const d = b64enc(privateKeyBytes);
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x, y, d }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsignedToken)));
  const token = `${unsignedToken}.${b64enc(signature)}`;
  return { authorization: `vapid t=${token}, k=${b64enc(publicKeyBytes)}` };
}

async function encryptPayload(payload: string, p256dhKey: string, authSecret: string) {
  function b64dec(str: string): Uint8Array {
    const padding = "=".repeat((4 - (str.length % 4)) % 4);
    const b64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const clientPublicKey = b64dec(p256dhKey);
  const clientAuth = b64dec(authSecret);
  const localKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", localKeyPair.publicKey));
  const clientKey = await crypto.subtle.importKey("raw", clientPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, localKeyPair.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number) {
    const k = await crypto.subtle.importKey("raw", ikm, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const prk = new Uint8Array(await crypto.subtle.sign("HMAC", k, salt.length > 0 ? salt : new Uint8Array(32)));
    const prkKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const okm = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, new Uint8Array([...info, 1])));
    return okm.slice(0, length);
  }
  const enc = new TextEncoder();
  const authInfo = new Uint8Array([...enc.encode("WebPush: info\0"), ...clientPublicKey, ...localPublicKeyRaw]);
  const ikm = await hkdf(sharedSecret, clientAuth, authInfo, 32);
  const cek = await hkdf(ikm, salt, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, enc.encode("Content-Encoding: nonce\0"), 12);
  const padded = new Uint8Array([...enc.encode(payload), 2]);
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const body = new Uint8Array([...salt, ...rs, localPublicKeyRaw.length, ...localPublicKeyRaw, ...encrypted]);
  return { body, headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream" } };
}

export async function customer_message(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { tenantId, orderId, customerName, preview } = await req.json();
    if (!tenantId) return new Response(JSON.stringify({ error: "tenantId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: tenant } = await supabase.from("tenants").select("slug, name, transactional_emails_enabled").eq("id", tenantId).single();
    const slug = tenant?.slug || "";

    // PUSH para o lojista
    const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("tenant_id", tenantId);
    let sent = 0, failed = 0;
    if (subs && subs.length > 0) {
      const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
      const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
      const payload = JSON.stringify({
        title: `💬 Mensagem de ${customerName || "cliente"}`,
        body: preview || "Nova mensagem sobre um pedido",
        data: { url: `/loja/${slug}/admin?tab=customer-chats&order=${orderId}`, orderId },
      });
      for (const sub of subs) {
        try {
          const vapidHeaders = await generateVapidAuthHeader(sub.endpoint, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, "mailto:admin@delivery.app");
          const encrypted = await encryptPayload(payload, sub.p256dh, sub.auth);
          const r = await fetch(sub.endpoint, { method: "POST", headers: { ...vapidHeaders, ...encrypted.headers, TTL: "86400", Urgency: "high" }, body: encrypted.body });
          if (r.status === 201 || r.status === 200) sent++;
          else if (r.status === 404 || r.status === 410) { await supabase.from("push_subscriptions").delete().eq("id", sub.id); failed++; }
          else failed++;
        } catch { failed++; }
      }
    }

    // E-MAIL para os admins do tenant (best-effort, opt-in via tenant flag)
    if (tenant?.transactional_emails_enabled !== false) {
      try {
        const { data: roles } = await supabase.from("user_roles").select("email").eq("tenant_id", tenantId).eq("role", "admin").eq("approved", true);
        const emails = (roles || []).map((r: any) => r.email).filter(Boolean);
        for (const email of emails) {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-transactional-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              templateName: "generic-notification",
              recipientEmail: email,
              idempotencyKey: `chat-${orderId}-${Date.now()}`,
              templateData: {
                subject: `💬 ${customerName || "Cliente"} mandou mensagem (pedido ${String(orderId).slice(0, 8)})`,
                heading: `Nova mensagem de ${customerName || "cliente"}`,
                body: preview || "Abra o painel para responder.",
                ctaUrl: `https://${slug ? slug + ".lovable.app" : "lovable.app"}/loja/${slug}/admin?tab=customer-chats&order=${orderId}`,
                ctaLabel: "Responder agora",
              },
            }),
          });
        }
      } catch (e) {
        console.error("email error", e);
      }
    }

    return new Response(JSON.stringify({ sent, failed }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("notify-customer-message error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  } catch (e) {
    console.error("[unified:customer-message] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
