import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { CheckCircle2, RefreshCw, Users, Clock, BellRing, Moon, Sun, X, QrCode, Banknote, CreditCard, Smartphone, Wallet, Plus, BellOff } from 'lucide-react';
import { startLoudAlert, stopAlert, unlockAudio, playShortBeep, subscribeAlert } from '@/lib/order-alert-sound';
import QrScannerDialog from '@/components/shared/QrScannerDialog';
import WaiterComandaEditor from '@/components/tenant/WaiterComandaEditor';
import { getDeviceId, generateShareCode } from '@/lib/waiter-device';

const PAYMENT_METHODS = [
  { id: 'pix', label: 'Pix', icon: Smartphone },
  { id: 'dinheiro', label: 'Dinheiro', icon: Banknote },
  { id: 'credito', label: 'Cartão Crédito', icon: CreditCard },
  { id: 'debito', label: 'Cartão Débito', icon: CreditCard },
  { id: 'vale', label: 'Vale Refeição', icon: Wallet },
  { id: 'outro', label: 'Outro', icon: Wallet },
];

export default function WaiterPanel() {
  const { slug, token } = useParams<{ slug: string; token: string }>();
  const [tenant, setTenant] = useState<any>(null);
  const [waiter, setWaiter] = useState<any>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [tables, setTables] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [resolvedByTable, setResolvedByTable] = useState<{ label: string; items: any[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('waiter-dark') === '1';
  });
  const [scannerOpen, setScannerOpen] = useState(false);
  const [payOrder, setPayOrder] = useState<any>(null);
  const [payMethod, setPayMethod] = useState<string>('pix');
  const [paying, setPaying] = useState(false);
  const [editingSession, setEditingSession] = useState<any>(null);
  const [alerting, setAlerting] = useState(false);
  const knownReqIds = useRef<Set<string>>(new Set());
  const lastOrderStatus = useRef<Map<string, string>>(new Map());
  const knownMyAssignedSessions = useRef<Set<string>>(new Set());
  const sessionsRef = useRef<any[]>([]);
  const deviceId = getDeviceId();

  useEffect(() => { const u = subscribeAlert(setAlerting); return () => { u(); }; }, []);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  // Dark mode
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('waiter-dark', dark ? '1' : '0');
  }, [dark]);

  const load = async (tenantId: string) => {
    const [t, s, o, r, res] = await Promise.all([
      // A coluna active é texto ('t'/'f') — neq('f') garante compatibilidade
      // com qualquer tipo de coluna. Fallback: se vier vazio, tenta sem filtro
      // e filtra em memória, para o painel nunca ficar com Mesas (0).
      (supabase as any).from('restaurant_tables').select('*').eq('tenant_id', tenantId).neq('active', 'f').order('label'),
      (supabase as any).from('table_sessions').select('*').eq('tenant_id', tenantId).in('status', ['open', 'sent']).order('opened_at'),
      supabase.from('orders').select('*, order_items(*)').eq('tenant_id', tenantId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false }).limit(50),
      (supabase as any).from('service_requests').select('*').eq('tenant_id', tenantId).order('created_at'),
      // Histórico: chamados já resolvidos das últimas 24h — nada se perde,
      // fica registrado na mesa que chamou
      (supabase as any).from('service_requests').select('*').eq('tenant_id', tenantId).eq('status', 'resolved').gte('resolved_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()).order('resolved_at', { ascending: false }).limit(50),
    ]);
    let tList = t.data || [];
    // Fallback robusto: sem filtro active (coluna pode ser texto ou boolean)
    if (tList.length === 0 && !t.error) {
      const { data: tAll } = await (supabase as any).from('restaurant_tables').select('*').eq('tenant_id', tenantId).order('label');
      tList = (tAll || []).filter((x: any) => x.active !== 'f' && x.active !== false);
    }
    if (t.error) console.error('[waiter] restaurant_tables error:', t.error.message);
    setTables(tList);
    const sessList = s.data || [];
    setSessions(sessList);
    // Pedidos de mesa: o filtro .not('is',null) falha no PostgREST (op 'is'
    // não suportado) — busca todos e filtra em memória.
    const oAll = (o.data as any) || [];
    // PostgREST exclui NULLs em .neq(true) — A cobrar feito em memória
    // para não perder pedidos com payment_received indefinido
    const unpaid = (pr: any) => pr !== true && pr !== 't' && pr !== 'true';
    const tableOrders = oAll.filter((x: any) => !!x.table_session_id && unpaid(x.payment_received));
    setOrders(tableOrders);
    // Defesa: chamados legados sem status (NULL) são tratados como abertos
    const reqs = ((r.data || []) as any[]).filter((rq: any) => rq.status === 'open' || !rq.status);
    setRequests(reqs);
    reqs.forEach((rq: any) => knownReqIds.current.add(rq.id));
    // Histórico por mesa: chamado + hora + quem chamou
    const resolvedList = (res.data || []) as any[];
    const byTable: Record<string, { label: string; items: any[] }> = {};
    resolvedList.forEach((rq: any) => {
      const key = rq.table_label || '—';
      const g = (byTable[key] ||= { label: key, items: [] });
      g.items.push(rq);
    });
    setResolvedByTable(Object.values(byTable));
    sessList.forEach((ss: any) => { if (ss.assigned_waiter_id) knownMyAssignedSessions.current.add(ss.id); });
  };

  // Recheck automático quando o painel estiver desativado (app de garçom na maquininha):
  // valida a cada 15s para detectar reativação ou nova URL gerada pelo admin.
  const recheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const init = async () => {
      if (!slug || !token) return;
      const { data: tn } = await (supabase as any).rpc('get_tenant_public_by_slug', { _slug: slug });
      const tenantRow = Array.isArray(tn) ? tn[0] : tn;
      if (!tenantRow) { setAuthorized(false); setLoading(false); return; }
      // Token must match a real waiter row (no more wildcard tenant token fallback)
      const { data: wList } = await (supabase as any).rpc('get_waiter_by_token', { _tenant_id: tenantRow.id, _token: token });
      const w = Array.isArray(wList) ? wList[0] : wList;
      const ok = !!w;
      setAuthorized(ok);
      if (ok) {
        // Guarda o token validado para o app detectar regeneração de URL pelo admin
        if (typeof window !== 'undefined' && w?.access_token) {
          localStorage.setItem('garcom-last-token', w.access_token);
        }
        setTenant(tenantRow); setWaiter(w || null); await load(tenantRow.id);
        // Painel ativo: para o recheck (não precisa mais sondar)
        if (recheckRef.current) { clearInterval(recheckRef.current); recheckRef.current = null; }
      } else {
        // Painel desativado ou token inválido: mantém sondagem a cada 15s
        if (!recheckRef.current) {
          recheckRef.current = setInterval(() => { init(); }, 15000);
        }
      }
      setLoading(false);
    };
    init();
    return () => { if (recheckRef.current) { clearInterval(recheckRef.current); recheckRef.current = null; } };
  }, [slug, token]);

  // Se o token validado difere do token da URL atual, o admin regenerou o link:
  // recarrega automaticamente com a nova URL.
  useEffect(() => {
    if (authorized === true && typeof window !== 'undefined') {
      const last = localStorage.getItem('garcom-last-token');
      if (last && last !== token) {
        const newPath = window.location.pathname.replace(/\/garcom\/[A-Za-z0-9_.-]+$/, `/garcom/${last}`);
        window.location.replace(newPath);
      }
    }
  }, [authorized, token]);

  // Presença online — heartbeat a cada 30s
  useEffect(() => {
    if (!waiter?.id) return;
    const beat = () => (supabase as any).from('waiters').update({ online: true, last_online_at: new Date().toISOString() }).eq('id', waiter.id);
    beat();
    const t = setInterval(beat, 30000);
    const offline = () => (supabase as any).from('waiters').update({ online: false }).eq('id', waiter.id);
    window.addEventListener('beforeunload', offline);
    return () => { clearInterval(t); offline(); window.removeEventListener('beforeunload', offline); };
  }, [waiter?.id]);

  // Realtime + alerta sonoro
  useEffect(() => {
    if (!tenant?.id) return;
    const ch = (supabase as any).channel(`waiter-${tenant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_sessions', filter: `tenant_id=eq.${tenant.id}` }, (p: any) => {
        const s = p.new;
        if (s && waiter?.id && s.assigned_waiter_id === waiter.id && !knownMyAssignedSessions.current.has(s.id)) {
          knownMyAssignedSessions.current.add(s.id);
          startLoudAlert();
          toast.success(`🔔 Nova mesa designada: ${s.table_label}`, { duration: 10000 });
        }
        load(tenant.id);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenant.id}` }, (p: any) => {
        const o = p.new;
        // Só interessa pedidos de mesa
        if (!o?.table_session_id) { load(tenant.id); return; }
        const prev = lastOrderStatus.current.get(o.id);
        lastOrderStatus.current.set(o.id, o.status);
        if (prev && prev !== o.status) {
          // Alarme alto quando comida fica pronta ou sai pra entrega
          if (['ready', 'ready-for-pickup', 'out-for-delivery'].includes(o.status)) {
            startLoudAlert();
            toast.success(`🔔 ${o.table_label}: ${o.status === 'out-for-delivery' ? 'saindo pra entrega' : 'pedido PRONTO!'}`, { duration: 10000 });
          } else if (o.status === 'preparing') {
            playShortBeep();
          }
        }
        load(tenant.id);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenant.id}` }, (p: any) => {
        if (p.new?.id) lastOrderStatus.current.set(p.new.id, p.new.status);
        load(tenant.id);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'service_requests', filter: `tenant_id=eq.${tenant.id}` }, (p: any) => {
        const newReq = p.new;
        if (knownReqIds.current.has(newReq.id)) return;
        knownReqIds.current.add(newReq.id);
        // Só beep se for pro meu garçom (ou mesa sem dono e eu não tenho waiter)
        const sess = sessionsRef.current.find((s: any) => s.id === newReq.session_id);
        const targetWaiter = newReq.waiter_id || sess?.assigned_waiter_id || null;
        const isForMe = !waiter
          ? !targetWaiter // central só ouve mesas sem dono
          : targetWaiter === waiter.id || (!targetWaiter); // meu, ou sem dono
        if (isForMe) {
          startLoudAlert();
          toast.warning(`🔔 ${newReq.table_label}: ${newReq.message}`, { duration: 8000 });
        }
        load(tenant.id);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'service_requests', filter: `tenant_id=eq.${tenant.id}` }, () => load(tenant.id))
      .subscribe((status: string) => {
        // Gap-fill: ao (re)conectar, recarrega tudo que pode ter mudado
        if (status === 'SUBSCRIBED') load(tenant.id);
      });
    // Fallback de polling a cada 20s: garante atualização mesmo se o
    // WebSocket do realtime ficar bloqueado (proxy/maquininha Stone).
    const poll = setInterval(() => { if (tenant?.id) load(tenant.id); }, 20000);
    return () => { clearInterval(poll); (supabase as any).removeChannel(ch); stopAlert(); };
  }, [tenant?.id]);

  const handleUnlock = () => { unlockAudio(); playShortBeep(); };

  const isMyOrder = (order: any) => {
    if (!waiter) return true;
    const sess = sessions.find(s => s.id === order.table_session_id);
    return !sess?.assigned_waiter_id || sess.assigned_waiter_id === waiter.id;
  };

  const openPayDialog = (order: any) => {
    if (!isMyOrder(order)) {
      toast.error('Esta mesa é de outro garçom. Só ele ou a central pode receber o pagamento.');
      return;
    }
    setPayOrder(order);
    setPayMethod('pix');
  };

  const confirmPay = async () => {
    if (!payOrder) return;
    setPaying(true);
    try {
      const { error } = await supabase.from('orders').update({
        payment_received: true, status: 'delivered', payment_method: payMethod,
      } as any).eq('id', payOrder.id);
      if (error) throw error;
      if (payOrder.table_session_id) {
        await (supabase as any).from('table_sessions').update({
          status: 'paid', paid_at: new Date().toISOString(),
        }).eq('id', payOrder.table_session_id);
      }
      toast.success(`${payOrder.table_label} paga via ${PAYMENT_METHODS.find(p => p.id === payMethod)?.label}!`);
      setPayOrder(null);
    } catch (e: any) { toast.error(e.message); }
    finally { setPaying(false); }
  };

  const releaseTable = async (sessionId: string) => {
    if (!confirm('Liberar mesa? A comanda atual será cancelada.')) return;
    await (supabase as any).from('table_sessions').update({ status: 'cancelled' }).eq('id', sessionId);
  };

  const openComanda = async (table: any) => {
    // Cria sessão nova com share_code + owner_device_id
    const code = generateShareCode();
    const { data: created, error } = await (supabase as any).from('table_sessions').insert({
      tenant_id: tenant.id,
      table_id: table.id,
      table_label: table.label,
      assigned_waiter_id: waiter?.id || null,
      assigned_waiter_name: waiter?.name || null,
      share_code: code,
      owner_device_id: deviceId,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    // Marca como já conhecida ANTES do realtime chegar — evita disparar alarme
    // sonoro quando o próprio garçom abre a comanda manualmente.
    if (created?.id) knownMyAssignedSessions.current.add(created.id);
    stopAlert();
    setEditingSession(created);
    toast.success(`Comanda aberta — código ${code}`);
  };

  const editSession = (s: any) => {
    // Permite editar mesmo se foi aberta em outro dispositivo (garçom às vezes troca de celular).
    setEditingSession(s);
  };

  const resolveRequest = async (id: string) => {
    stopAlert();
    await (supabase as any).from('service_requests').update({
      status: 'resolved', resolved_at: new Date().toISOString(),
    }).eq('id', id);
  };

  const handleScan = (text: string) => {
    setScannerOpen(false);
    try {
      // Aceita URL completa ou apenas o código da mesa
      let tableCode = text.trim();
      let scanSlug = slug;
      try {
        const url = new URL(text);
        const m = url.pathname.match(/\/loja\/([^/]+)\/mesa\/([^/?#]+)/);
        if (m) { scanSlug = m[1]; tableCode = m[2]; }
      } catch { /* não é URL, segue como código puro */ }
      const target = `/loja/${scanSlug}/mesa/${tableCode}?w=${token}`;
      window.open(target, '_blank');
      toast.success('Mesa aberta vinculada a você!');
    } catch (e: any) {
      toast.error('QR inválido');
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3 p-4 text-foreground">
      <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      <div className="font-semibold">Carregando painel do garçom...</div>
    </div>
  );
  if (authorized === false) return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3 p-6 text-center text-foreground">
      <BellOff className="h-10 w-10 text-muted-foreground" />
      <div className="text-xl font-bold">Painel indisponível</div>
      <div className="text-sm text-muted-foreground max-w-xs">
        Este painel foi desativado pelo administrador ou o link expirou.
        Aguarde a ativação — esta tela verifica automaticamente a cada poucos segundos.
      </div>
      <Button
        variant="outline"
        className="mt-2"
        onClick={async () => {
          setLoading(true);
          const { data: tn } = await (supabase as any).rpc('get_tenant_public_by_slug', { _slug: slug });
          const tenantRow = Array.isArray(tn) ? tn[0] : tn;
          if (tenantRow) {
            const { data: wList } = await (supabase as any).rpc('get_waiter_by_token', { _tenant_id: tenantRow.id, _token: token });
            const w = Array.isArray(wList) ? wList[0] : wList;
            if (w) {
              // Token regenerado pelo admin — segue a nova URL automaticamente
              if (w.access_token && w.access_token !== token) {
                window.location.replace(`/loja/${slug}/garcom/${w.access_token}`);
                return;
              }
              setAuthorized(true);
            }
          }
          setLoading(false);
        }}
      >
        <RefreshCw className="h-4 w-4 mr-1" /> Tentar novamente
      </Button>
    </div>
  );

  const sessionByTable = new Map(sessions.map(s => [s.table_id, s]));
  const orderBySession = new Map(orders.map(o => [o.table_session_id, o]));
  // filtra mesas/comandas/pedidos do garçom (se tem waiter associado)
  const myFilter = (s: any) => !waiter || s.assigned_waiter_id === waiter.id || !s.assigned_waiter_id;
  const myRequests = requests.filter((r: any) => {
    const sess = sessions.find(s => s.id === r.session_id);
    const target = r.waiter_id || sess?.assigned_waiter_id || null;
    if (!waiter) return !target; // central só vê chamados sem dono
    return !target || target === waiter.id;
  });

  return (
    <div className="min-h-screen bg-background text-foreground" onClick={handleUnlock}>
      <header className="sticky top-0 bg-card border-b p-3 flex items-center justify-between gap-2 z-10">
        <div className="min-w-0">
          <div className="font-bold truncate">{tenant?.name}</div>
          <div className="text-xs text-muted-foreground">
            {waiter ? <>Painel de <strong>{waiter.name}</strong></> : 'Painel do Garçom'}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {alerting && (
            <Button size="sm" variant="destructive" onClick={() => stopAlert()} className="gap-1 animate-pulse">
              <BellOff className="h-4 w-4" /> Silenciar
            </Button>
          )}
          <Button size="sm" onClick={() => setScannerOpen(true)} className="gap-1">
            <QrCode className="h-4 w-4" /> Escanear
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setDark(!dark)} title="Alternar tema">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button size="icon" variant="outline" onClick={() => load(tenant.id)}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </header>
      <QrScannerDialog open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />

      <div className="p-3 space-y-4">
        {/* Chamados (só os meus) */}
        {myRequests.length > 0 && (
          <section>
            <h2 className="font-bold mb-2 flex items-center gap-2 text-primary">
              <BellRing className="h-4 w-4 animate-pulse" /> Chamados ({myRequests.length})
              <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => stopAlert()}>Silenciar</Button>
            </h2>
            <div className="space-y-2">
              {myRequests.map(r => (
                <Card key={r.id} className="p-3 border-primary/40 bg-primary/5">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <Badge className="mb-1">{r.table_label}</Badge>
                      <div className="text-sm font-medium break-words">{r.message}</div>
                      {r.customer_name && <div className="text-xs text-muted-foreground">— {r.customer_name}</div>}
                      <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    <Button size="sm" onClick={() => resolveRequest(r.id)}><CheckCircle2 className="h-4 w-4 mr-1" /> OK</Button>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Chamados atendidos — registrados por mesa (últimas 24h) */}
        {resolvedByTable.length > 0 && (
          <section>
            <h2 className="font-bold mb-2 flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" /> Atendidos ({resolvedByTable.reduce((n, g) => n + g.items.length, 0)})
            </h2>
            <div className="space-y-2">
              {resolvedByTable.map(g => (
                <Card key={g.label} className="p-3">
                  <div className="font-medium text-sm mb-1">{g.label} <span className="text-xs text-muted-foreground">({g.items.length})</span></div>
                  {g.items.slice(0, 5).map(r => (
                    <div key={r.id} className="text-xs text-muted-foreground flex gap-2">
                      <span className="shrink-0">{r.message}</span>
                      {r.customer_name && <span className="shrink-0">— {r.customer_name}</span>}
                      <span className="ml-auto">{new Date(r.resolved_at || r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  ))}
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Comandas a cobrar */}
        <section>
          <h2 className="font-bold mb-2 flex items-center gap-2"><Clock className="h-4 w-4" /> A cobrar ({orders.filter(myFilter as any).length})</h2>
          {orders.length === 0 ? (
            <Card className="p-4 text-center text-muted-foreground text-sm">Nenhuma comanda aguardando pagamento.</Card>
          ) : (
            <div className="space-y-2">
              {orders.filter(o => !waiter || sessions.find(s => s.id === o.table_session_id && (s.assigned_waiter_id === waiter.id || !s.assigned_waiter_id))).map(o => (
                <Card key={o.id} className="p-3">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <Badge className="mb-1">{o.table_label}</Badge>
                      <div className="font-medium">{o.customer_name || 'Sem nome'}</div>
                      <div className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-primary">R$ {Number(o.total).toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mb-2 max-h-20 overflow-auto">
                    {(o.order_items || []).map((it: any) => (
                      <div key={it.id}>{it.quantity}x {it.product_name}</div>
                    ))}
                  </div>
                  <Button className="w-full" onClick={() => openPayDialog(o)}>
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Marcar como PAGO
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Mesas */}
        <section>
          <h2 className="font-bold mb-2 flex items-center gap-2"><Users className="h-4 w-4" /> Mesas ({tables.length})</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {tables.map(t => {
              const s = sessionByTable.get(t.id);
              const occupied = !!s;
              const mine = !waiter || !s || s.assigned_waiter_id === waiter.id || !s.assigned_waiter_id;
              return (
                <Card key={t.id} className={`p-3 ${occupied ? 'border-primary' : ''} ${!mine ? 'opacity-50' : ''}`}>
                  <div className="font-bold">{t.label}</div>
                  {!occupied ? (
                    <>
                      <div className="text-xs text-muted-foreground mt-1">Livre</div>
                      <Button size="sm" className="w-full mt-2 h-7 text-xs" onClick={() => openComanda(t)}>
                        <Plus className="h-3 w-3 mr-1" /> Abrir comanda
                      </Button>
                    </>
                  ) : (
                    <>
                      <Badge variant={s.status === 'sent' ? 'default' : 'secondary'} className="mt-1 text-xs">
                        {s.status === 'sent' ? 'Aguardando pagto' : 'Comanda aberta'}
                      </Badge>
                      {s.share_code && <div className="text-[10px] font-mono text-muted-foreground mt-0.5">cód: {s.share_code}</div>}
                      <div className="text-sm mt-1">{s.customer_name || '—'}</div>
                      {s.assigned_waiter_name && <div className="text-xs text-muted-foreground">👤 {s.assigned_waiter_name}</div>}
                      <div className="text-sm font-bold text-primary">R$ {Number(s.total || 0).toFixed(2)}</div>
                      {mine && (
                        <Button size="sm" variant="outline" className="w-full mt-2 h-7 text-xs" onClick={() => editSession(s)}>
                          {s.status === 'sent' ? 'Editar (enviada)' : 'Editar'}
                        </Button>
                      )}
                      {mine && (
                        <Button size="sm" variant="ghost" className="w-full mt-1 h-7 text-xs" onClick={() => releaseTable(s.id)}>
                          <X className="h-3 w-3 mr-1" /> Liberar
                        </Button>
                      )}
                    </>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      </div>

      <Dialog open={!!payOrder} onOpenChange={(o) => !o && setPayOrder(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Receber pagamento</DialogTitle>
          </DialogHeader>
          {payOrder && (
            <div className="space-y-3">
              <div className="text-center">
                <Badge className="mb-1">{payOrder.table_label}</Badge>
                <div className="text-3xl font-bold text-primary">R$ {Number(payOrder.total).toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">{payOrder.customer_name || 'Sem nome'}</div>
              </div>
              <div>
                <div className="text-sm font-medium mb-2">Como o cliente pagou?</div>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHODS.map(pm => {
                    const Icon = pm.icon;
                    const active = payMethod === pm.id;
                    return (
                      <Button key={pm.id} type="button" variant={active ? 'default' : 'outline'}
                        onClick={() => setPayMethod(pm.id)} className="justify-start gap-2 h-auto py-3">
                        <Icon className="h-4 w-4" /> <span className="text-sm">{pm.label}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPayOrder(null)} disabled={paying}>Cancelar</Button>
            <Button onClick={confirmPay} disabled={paying}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> {paying ? 'Salvando...' : 'Confirmar pagamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WaiterComandaEditor
        open={!!editingSession}
        onClose={() => setEditingSession(null)}
        session={editingSession}
        tenantId={tenant?.id}
      />
    </div>
  );
}
