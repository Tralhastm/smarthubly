import { useEffect, useState } from 'react';
import { useSubTabs } from '@/lib/admin-subtabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Mail, Send, Loader2, Save, AlertCircle, Sparkles } from 'lucide-react';
import { unifiedInvoke } from "@/lib/unifiedInvoke";

interface Props { tenantId: string }

type Tenant = {
  id: string;
  name: string;
  require_customer_email: boolean;
  transactional_emails_enabled: boolean;
  marketing_emails_enabled: boolean;
  brevo_sender_email: string | null;
  brevo_sender_name: string | null;
  abandoned_cart_email_enabled: boolean;
  auto_abandon_coupon: boolean;
};

type Campaign = {
  id: string;
  subject: string;
  body_html: string;
  preview_text: string | null;
  status: string;
  recipients_count: number;
  succeeded_count: number;
  failed_count: number;
  sent_at: string | null;
  created_at: string;
  error_message: string | null;
};

export default function TenantAdminEmails({ tenantId }: Props) {
  const { toast } = useToast();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tab, setTab] = useState<'config' | 'campaigns'>('config');
  const subs = useSubTabs('emails', [
    { id: 'config', label: 'Configurações' },
    { id: 'campaigns', label: 'Campanhas' },
  ]);
  useEffect(() => {
    if (!subs.some(s => s.id === tab)) setTab(subs[0].id as any);
  }, [subs, tab]);

  // form de nova campanha
  const [newSubject, setNewSubject] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newPreview, setNewPreview] = useState('');
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: t } = await supabase.from('tenants')
      .select('id,name,require_customer_email,transactional_emails_enabled,marketing_emails_enabled,brevo_sender_email,brevo_sender_name,abandoned_cart_email_enabled,auto_abandon_coupon')
      .eq('id', tenantId).single();
    setTenant(t as any);
    const { data: c } = await supabase.from('marketing_campaigns')
      .select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(50);
    setCampaigns((c || []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, [tenantId]);

  const save = async (patch: Partial<Tenant>) => {
    if (!tenant) return;
    setSaving(true);
    const { error } = await supabase.from('tenants').update(patch).eq('id', tenantId);
    setSaving(false);
    if (error) toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Salvo' }); setTenant({ ...tenant, ...patch } as any); }
  };

  const createAndSend = async () => {
    if (!newSubject.trim() || !newBody.trim()) {
      toast({ title: 'Preencha assunto e conteúdo', variant: 'destructive' }); return;
    }
    if (!tenant?.marketing_emails_enabled || !tenant?.brevo_sender_email) {
      toast({ title: 'Configure o remetente primeiro', description: 'Ative marketing e configure o e-mail remetente.', variant: 'destructive' }); return;
    }
    setSending(true);
    try {
      const { data: campaign, error } = await supabase.from('marketing_campaigns').insert({
        tenant_id: tenantId, subject: newSubject, body_html: newBody, preview_text: newPreview, status: 'draft',
      }).select().single();
      if (error) throw error;
      const { data: result, error: fnErr } = await unifiedInvoke("marketing-unified", "campaign", { campaignId: campaign.id });
      if (fnErr) throw fnErr;
      toast({ title: 'Campanha enviada', description: `${result.succeeded}/${result.recipients} entregues.` });
      setNewSubject(''); setNewBody(''); setNewPreview('');
      load();
    } catch (e: any) {
      toast({ title: 'Erro ao enviar', description: e.message, variant: 'destructive' });
    } finally { setSending(false); }
  };

  if (loading || !tenant) return <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const brevoOk = !!tenant.brevo_sender_email && tenant.marketing_emails_enabled;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Mail className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-xl font-bold">E-mails & Marketing</h2>
          <p className="text-sm text-muted-foreground">E-mails automáticos do pedido e campanhas para clientes.</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-border">
        {subs.map(s => (
          <button key={s.id} onClick={() => setTab(s.id as any)} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === s.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>{s.label}</button>
        ))}
      </div>

      {tab === 'config' && (
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-5 space-y-4">
            <h3 className="font-semibold">📥 Captura de e-mail no checkout</h3>
            <label className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Exigir e-mail no checkout</div>
                <div className="text-xs text-muted-foreground">Cliente precisa informar e-mail para finalizar pedido.</div>
              </div>
              <input type="checkbox" checked={tenant.require_customer_email} onChange={e => save({ require_customer_email: e.target.checked })} className="h-5 w-5" />
            </label>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 space-y-4">
            <h3 className="font-semibold">📧 E-mails automáticos do pedido</h3>
            <p className="text-xs text-muted-foreground">Pedido confirmado, saiu para entrega, pronto para retirada e entregue. Enviados automaticamente quando o cliente forneceu e-mail.</p>
            <label className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Ativar e-mails de status do pedido</div>
                <div className="text-xs text-muted-foreground">Usa o sistema de e-mails da plataforma. Não precisa configurar nada.</div>
              </div>
              <input type="checkbox" checked={tenant.transactional_emails_enabled} onChange={e => save({ transactional_emails_enabled: e.target.checked })} className="h-5 w-5" />
            </label>
            <div className="rounded-md bg-muted/50 border border-border p-3 text-xs text-muted-foreground">
              💡 Os e-mails incluem aviso pro cliente verificar a caixa de spam.
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">📣 Marketing por e-mail (Brevo)</h3>
            <p className="text-xs text-muted-foreground">Para campanhas em massa e cupom de carrinho abandonado. Brevo grátis até 300 e-mails/dia.</p>
            <label className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Ativar marketing por e-mail</div>
                <div className="text-xs text-muted-foreground">Habilita campanhas e e-mails de carrinho abandonado.</div>
              </div>
              <input type="checkbox" checked={tenant.marketing_emails_enabled} onChange={e => save({ marketing_emails_enabled: e.target.checked })} className="h-5 w-5" />
            </label>
            {tenant.marketing_emails_enabled && (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">E-mail remetente (precisa estar verificado no Brevo)</label>
                  <input type="email" defaultValue={tenant.brevo_sender_email || ''} onBlur={e => save({ brevo_sender_email: e.target.value || null })} placeholder="contato@sualoja.com" className="w-full mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Nome remetente</label>
                  <input type="text" defaultValue={tenant.brevo_sender_name || ''} onBlur={e => save({ brevo_sender_name: e.target.value || null })} placeholder={tenant.name} className="w-full mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </div>
                <label className="flex items-center justify-between gap-4 pt-2">
                  <div>
                    <div className="text-sm font-medium">Enviar cupom de carrinho abandonado por e-mail</div>
                    <div className="text-xs text-muted-foreground">Requer "Cupom de carrinho abandonado" ativo em Automações.</div>
                  </div>
                  <input type="checkbox" checked={tenant.abandoned_cart_email_enabled} onChange={e => save({ abandoned_cart_email_enabled: e.target.checked })} className="h-5 w-5" />
                </label>
                {tenant.abandoned_cart_email_enabled && !tenant.auto_abandon_coupon && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400 flex gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />Ative também "Cupom de carrinho abandonado" em Automações.
                  </div>
                )}
              </>
            )}
            {!brevoOk && (
              <div className="rounded-md bg-muted/50 border border-border p-3 text-xs text-muted-foreground">
                💡 O Brevo já está conectado pela plataforma. Você só precisa ativar acima e configurar um e-mail remetente verificado na sua conta Brevo.
              </div>
            )}
          </section>

          {saving && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Salvando…</div>}
        </div>
      )}

      {tab === 'campaigns' && (
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4" />Nova campanha</h3>
            {!brevoOk && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                Configure o marketing nas <button onClick={() => setTab('config')} className="underline">Configurações</button> antes de enviar campanhas.
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Assunto</label>
              <input value={newSubject} onChange={e => setNewSubject(e.target.value)} placeholder="🎉 Promo da semana!" className="w-full mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Pré-visualização (opcional)</label>
              <input value={newPreview} onChange={e => setNewPreview(e.target.value)} placeholder="Aproveite até domingo!" className="w-full mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Conteúdo (HTML — use {'{{nome}}'} e {'{{loja}}'})</label>
              <textarea value={newBody} onChange={e => setNewBody(e.target.value)} rows={8} placeholder="<h1>Olá {{nome}}!</h1><p>Confira nossas novidades em {{loja}}...</p>" className="w-full mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono" />
            </div>
            <button disabled={sending || !brevoOk} onClick={createAndSend} className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar agora para todos clientes
            </button>
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <h3 className="font-semibold mb-4">Histórico</h3>
            {campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma campanha ainda.</p>
            ) : (
              <div className="space-y-2">
                {campaigns.map(c => (
                  <div key={c.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{c.subject}</div>
                        <div className="text-xs text-muted-foreground">{new Date(c.sent_at || c.created_at).toLocaleString('pt-BR')}</div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${c.status === 'sent' ? 'bg-green-500/20 text-green-700 dark:text-green-400' : c.status === 'failed' ? 'bg-red-500/20 text-red-700 dark:text-red-400' : c.status === 'partial' ? 'bg-amber-500/20 text-amber-700' : 'bg-muted text-muted-foreground'}`}>{c.status}</span>
                    </div>
                    {c.recipients_count > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">{c.succeeded_count}/{c.recipients_count} entregues{c.failed_count > 0 && `, ${c.failed_count} falhas`}</div>
                    )}
                    {c.error_message && <div className="text-xs text-destructive mt-1">{c.error_message}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
