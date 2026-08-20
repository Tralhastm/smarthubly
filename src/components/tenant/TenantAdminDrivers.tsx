import { useState, useMemo } from 'react';
import { useDrivers, useAddDriver, useDeleteDriver } from '@/hooks/useDrivers';
import { useOrders } from '@/hooks/useOrders';
import { useTenantDriverLocations } from '@/hooks/useDriverLocation';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Copy, Truck, ExternalLink, Phone, MapPin, RefreshCw, Radar, Maximize2 } from 'lucide-react';
import { toast } from 'sonner';
import DriverMap, { type MapMarker } from '@/components/shared/DriverMap';
import DriverLiveMapModal from '@/components/tenant/DriverLiveMapModal';
import { unifiedInvoke } from "@/lib/unifiedInvoke";

const TenantAdminDrivers = ({ tenantId, slug }: { tenantId: string; slug: string }) => {
  const { data: drivers = [], isLoading } = useDrivers(tenantId);
  const { data: orders = [] } = useOrders(tenantId);
  const addDriver = useAddDriver();
  const deleteDriver = useDeleteDriver(tenantId);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [focusedDriver, setFocusedDriver] = useState<{ id: string; name: string; phone?: string } | null>(null);


  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    await addDriver.mutateAsync({ tenant_id: tenantId, name, phone });
    setName(''); setPhone('');
    toast.success('Motoboy cadastrado!');
  };

  const handleDelete = (id: string) => {
    if (!confirm('Remover motoboy?')) return;
    deleteDriver.mutate(id);
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/loja/${slug}/motoboy/${token}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copiado!');
  };

  // Pedidos com Lalamove ativa (em entrega, não entregues ainda)
  const lalamoveOrders = orders.filter((o: any) =>
    o.lalamove_order_id && o.status === 'out-for-delivery'
  );
  const lalamoveDelivered = orders.filter((o: any) =>
    o.lalamove_order_id && o.status === 'delivered'
  ).slice(0, 5);

  // Atualizar status Lalamove de uma corrida específica (consulta API)
  const refreshLalamove = async (orderId: string) => {
    setRefreshingId(orderId);
    try {
      const { data, error } = await unifiedInvoke("delivery-unified", "lalamove-status", { orderId });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message || 'Erro');
      toast.success(`Status: ${(data as any).status || 'atualizado'}`);
    } catch (e: any) {
      toast.error(`Falha: ${e.message}`);
    } finally {
      setRefreshingId(null);
    }
  };

  // Mapa em tempo real — todos motoboys com localização recente (<10min)
  const liveLocations = useTenantDriverLocations(tenantId);
  const driverNameById = useMemo(() => Object.fromEntries(drivers.map(d => [d.id, d.name])), [drivers]);
  const driverPhoneById = useMemo(() => Object.fromEntries(drivers.map(d => [d.id, d.phone])), [drivers]);
  // Janela de "fresh" alinhada ao cron de cleanup (3min). Acima disso o motoboy é considerado offline.
  const fresh = liveLocations.filter(l => Date.now() - new Date(l.updated_at).getTime() < 3 * 60_000);
  const mapMarkers: MapMarker[] = fresh.map(l => ({
    type: 'driver' as const,
    lat: Number(l.lat),
    lng: Number(l.lng),
    label: driverNameById[l.driver_id] || 'Motoboy',
  }));

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      {focusedDriver && (
        <DriverLiveMapModal
          driverId={focusedDriver.id}
          driverName={focusedDriver.name}
          driverPhone={focusedDriver.phone}
          tenantId={tenantId}
          onClose={() => setFocusedDriver(null)}
        />
      )}

      {fresh.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h3 className="font-heading text-foreground flex items-center gap-2">
            <Radar className="h-4 w-4 text-blue-400 animate-pulse" />
            Motoboys ao vivo
            <span className="text-xs font-normal text-muted-foreground">({fresh.length} compartilhando GPS)</span>
          </h3>
          <DriverMap markers={mapMarkers} height="280px" />
          {/* Lista resumida — clique abre mapa em tela cheia com a rota da entrega ativa */}
          <div className="space-y-1.5">
            {fresh.map(l => {
              const ageMs = Date.now() - new Date(l.updated_at).getTime();
              const ageMin = Math.floor(ageMs / 60_000);
              const ageLabel = ageMin < 1 ? 'agora' : ageMin === 1 ? '1 min atrás' : `${ageMin} min atrás`;
              const isFresh = ageMs < 90_000;
              const dName = driverNameById[l.driver_id] || 'Motoboy';
              const dPhone = driverPhoneById[l.driver_id];
              return (
                <button
                  key={l.driver_id}
                  type="button"
                  onClick={() => setFocusedDriver({ id: l.driver_id, name: dName, phone: dPhone })}
                  className="w-full flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs hover:bg-secondary/70 hover:border-primary/40 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${isFresh ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
                    <span className="font-medium text-foreground truncate">🏍️ {dName}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-muted-foreground">{ageLabel}</span>
                    <Maximize2 className="h-3.5 w-3.5 text-primary" />
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground text-center">
            👆 Toque em um motoboy pra abrir o mapa em tela cheia com a rota da entrega
          </p>
        </div>
      )}



      <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-heading text-foreground">Novo Motoboy</h3>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" />
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Telefone" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" />
        <button type="submit" disabled={addDriver.isPending} className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
          <Plus className="h-4 w-4" /> Cadastrar
        </button>
      </form>

      <div>
        <h3 className="font-heading text-foreground mb-2">Meus Motoboys</h3>
        {drivers.length === 0 && <p className="text-center text-muted-foreground py-4 text-sm">Nenhum motoboy cadastrado.</p>}

        {drivers.map(d => {
          const isOn = !!(d as any).is_online;
          const lastAt = (d as any).last_online_at;
          // Janela alinhada ao cron de cleanup (15min). Se passou disso sem heartbeat, considera offline mesmo que a flag is_online ainda não tenha sido revertida.
          const fresh = lastAt ? (Date.now() - new Date(lastAt).getTime() < 15 * 60_000) : false;
          const online = isOn && fresh;
          return (
            <div key={d.id} className="rounded-lg border border-border bg-card p-4 flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${online ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40'}`} title={online ? 'Online' : 'Offline'} />
                <div>
                  <span className="font-medium text-foreground">{d.name}</span>
                  {d.phone && <span className="text-xs text-muted-foreground ml-2">📞 {d.phone}</span>}
                  <p className={`text-[10px] mt-0.5 ${online ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {online ? '🟢 Disponível agora' : lastAt ? `⚫ Offline · visto ${new Date(lastAt).toLocaleString('pt-BR')}` : '⚫ Nunca conectou'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => copyLink(d.access_token)} className="flex items-center gap-1 text-xs text-primary hover:underline">
                  <Copy className="h-3 w-3" /> Link do Painel
                </button>
                <button onClick={() => handleDelete(d.id)} className="text-destructive hover:text-destructive/80">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Seção Lalamove */}
      <div>
        <h3 className="font-heading text-foreground mb-2 flex items-center gap-2">
          <Truck className="h-4 w-4 text-orange-400" />
          Corridas Lalamove
          {lalamoveOrders.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-orange-500/20 text-orange-400 text-xs font-bold px-2 py-0.5">
              {lalamoveOrders.length} ativa(s)
            </span>
          )}
        </h3>

        {lalamoveOrders.length === 0 && lalamoveDelivered.length === 0 && (
          <p className="text-center text-muted-foreground py-4 text-sm">Nenhuma corrida Lalamove ainda.</p>
        )}

        {lalamoveOrders.map((o: any) => (
          <div key={o.id} className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4 space-y-2 mb-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground text-sm">#{o.id.slice(0, 6)} · {o.customer_name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 font-medium">
                {o.lalamove_status || 'Em andamento'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {o.customer_address}
            </p>
            {o.lalamove_driver_name && (
              <div className="text-xs text-muted-foreground space-y-0.5 rounded-md bg-card p-2 border border-border">
                <p className="text-foreground font-medium">🏍️ {o.lalamove_driver_name}</p>
                {o.lalamove_driver_phone && (
                  <p className="flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {o.lalamove_driver_phone}
                    {o.lalamove_driver_plate && <span className="ml-2">· Placa {o.lalamove_driver_plate}</span>}
                  </p>
                )}
              </div>
            )}
            {o.lalamove_price && (
              <p className="text-xs text-muted-foreground">💰 Custo Lalamove: R${Number(o.lalamove_price).toFixed(2)}</p>
            )}
            <div className="flex gap-2 pt-1">
              {o.lalamove_share_link && (
                <a href={o.lalamove_share_link} target="_blank" rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-orange-500/20 text-orange-400 px-3 py-2 text-xs font-medium hover:bg-orange-500/30">
                  <ExternalLink className="h-3 w-3" /> Acompanhar no mapa
                </a>
              )}
              <button onClick={() => refreshLalamove(o.id)} disabled={refreshingId === o.id}
                className="flex items-center justify-center gap-1 rounded-lg bg-secondary text-foreground px-3 py-2 text-xs font-medium hover:bg-secondary/80 disabled:opacity-50">
                <RefreshCw className={`h-3 w-3 ${refreshingId === o.id ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>
          </div>
        ))}

        {lalamoveDelivered.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground mb-2">Últimas entregues por Lalamove:</p>
            {lalamoveDelivered.map((o: any) => (
              <div key={o.id} className="rounded-lg border border-border bg-card p-2 text-xs mb-1 flex items-center justify-between">
                <span className="text-foreground">#{o.id.slice(0, 6)} · {o.customer_name}</span>
                <span className="text-green-400">✓ Entregue {o.lalamove_price ? `· R$${Number(o.lalamove_price).toFixed(2)}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TenantAdminDrivers;
