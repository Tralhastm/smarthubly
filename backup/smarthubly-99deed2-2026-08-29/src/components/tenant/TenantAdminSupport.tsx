// Suporte 24h + chamados + biblioteca de treinamento in-app.
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { useSupportTickets, useCreateTicket, useTicketMessages, useSendTicketMessage, type SupportTicket } from '@/hooks/useReportsSupport';
import { LifeBuoy, Plus, Send, PlayCircle, BookOpen, MessageCircle } from 'lucide-react';
import { useSubTabs } from '@/lib/admin-subtabs';

const fmtDateTime = (s?: string | null) => s ? new Date(s).toLocaleString('pt-BR') : '—';

const TRAINING_VIDEOS = [
  { title: 'Como criar produtos e categorias', duration: '4:30', topic: 'Catálogo', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
  { title: 'Configurar cobrança transparente', duration: '6:12', topic: 'Financeiro', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
  { title: 'Abertura e fechamento de caixa', duration: '3:45', topic: 'PDV', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
  { title: 'KDS por setor (cozinha/bar)', duration: '5:20', topic: 'Cozinha', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
  { title: 'Emissão de NFC-e', duration: '7:10', topic: 'Fiscal', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
  { title: 'Inventário cíclico de estoque', duration: '5:55', topic: 'Estoque', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
  { title: 'Mesas e comandas com QR Code', duration: '4:48', topic: 'Salão', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
  { title: 'Conciliação de adquirente', duration: '6:30', topic: 'Financeiro', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
];

export default function TenantAdminSupport({ tenantId }: { tenantId: string }) {
  const subs = useSubTabs('support', [
    { id: 'support', label: 'Suporte', icon: <LifeBuoy className="h-4 w-4 mr-2" /> },
    { id: 'training', label: 'Treinamento', icon: <BookOpen className="h-4 w-4 mr-2" /> },
  ]);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Suporte & Treinamento</h2>
        <p className="text-sm text-muted-foreground">Atendimento 24h e biblioteca de vídeos in-app.</p>
      </div>
      <Tabs defaultValue={subs[0].id}>
        <TabsList className="flex w-full max-w-md flex-wrap justify-start h-auto gap-1">
          {subs.map(s => <TabsTrigger key={s.id} value={s.id} className="flex-shrink-0">{s.icon}{s.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="support" className="mt-4"><SupportTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="training" className="mt-4"><TrainingTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function SupportTab({ tenantId }: { tenantId: string }) {
  const { data: tickets = [], isLoading } = useSupportTickets(tenantId);
  const create = useCreateTicket(tenantId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ subject: '', description: '', priority: 'normal', category: 'other' });
  const [active, setActive] = useState<SupportTicket | null>(null);

  const submit = async () => {
    if (!form.subject || !form.description) return;
    try {
      await create.mutateAsync(form);
      setOpen(false);
      setForm({ subject: '', description: '', priority: 'normal', category: 'other' });
    } catch {}
  };

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-1 space-y-3">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Canais 24h</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-primary" /> Chat in-app (Sofia)</div>
            <div className="flex items-center gap-2"><LifeBuoy className="h-4 w-4 text-primary" /> Chamado prioritário (abaixo)</div>
            <div className="text-xs text-muted-foreground pt-1">Resposta média: até 2h em horário comercial, até 6h fora.</div>
          </CardContent>
        </Card>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="w-full"><Plus className="h-4 w-4 mr-2" />Abrir chamado</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo chamado de suporte</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Assunto</Label><Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>
              <div><Label>Descrição</Label><Textarea rows={4} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Categoria</Label>
                  <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bug">Erro/Bug</SelectItem>
                      <SelectItem value="feature">Sugestão</SelectItem>
                      <SelectItem value="billing">Cobrança</SelectItem>
                      <SelectItem value="training">Treinamento</SelectItem>
                      <SelectItem value="other">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Prioridade</Label>
                  <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Baixa</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">Alta</SelectItem>
                      <SelectItem value="urgent">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter><Button onClick={submit} disabled={create.isPending}>Enviar</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        <Card>
          <CardContent className="p-0">
            {isLoading ? <div className="p-4 text-center text-sm text-muted-foreground">Carregando…</div>
            : tickets.length === 0 ? <div className="p-4 text-center text-sm text-muted-foreground">Nenhum chamado.</div>
            : <div className="divide-y">
              {tickets.map(t => (
                <button key={t.id} onClick={() => setActive(t)}
                  className={`w-full text-left p-3 hover:bg-muted/50 transition ${active?.id === t.id ? 'bg-muted/50' : ''}`}>
                  <div className="flex justify-between items-start gap-2">
                    <div className="font-medium text-sm line-clamp-1">{t.subject}</div>
                    <PriorityBadge p={t.priority} />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <StatusBadge s={t.status} />
                    <span className="text-xs text-muted-foreground">{fmtDateTime(t.created_at)}</span>
                  </div>
                </button>
              ))}
            </div>}
          </CardContent>
        </Card>
      </div>

      <div className="md:col-span-2">
        {active ? <TicketThread ticket={active} /> : (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            Selecione um chamado para conversar com o suporte.
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}

function TicketThread({ ticket }: { ticket: SupportTicket }) {
  const { data: msgs = [] } = useTicketMessages(ticket.id);
  const send = useSendTicketMessage(ticket.id);
  const [text, setText] = useState('');

  const submit = async () => {
    if (!text.trim()) return;
    try { await send.mutateAsync({ content: text.trim() }); setText(''); } catch {}
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start gap-2">
          <div>
            <CardTitle className="text-base">{ticket.subject}</CardTitle>
            <CardDescription>Aberto em {fmtDateTime(ticket.created_at)}</CardDescription>
          </div>
          <div className="flex gap-1"><PriorityBadge p={ticket.priority} /><StatusBadge s={ticket.status} /></div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border p-3 bg-muted/30 text-sm whitespace-pre-wrap">{ticket.description}</div>

        <div className="space-y-2 max-h-80 overflow-y-auto">
          {msgs.length === 0 ? <div className="text-xs text-muted-foreground text-center py-4">Nenhuma mensagem ainda.</div>
          : msgs.map(m => (
            <div key={m.id} className={`flex ${m.sender_type === 'customer' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.sender_type === 'customer' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                <div className="text-[10px] opacity-70 mb-1">{m.sender_name || (m.sender_type === 'customer' ? 'Você' : 'Suporte')} · {fmtDateTime(m.created_at)}</div>
                {m.content}
              </div>
            </div>
          ))}
        </div>

        {ticket.status !== 'closed' && ticket.status !== 'resolved' && (
          <div className="flex gap-2">
            <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Digite sua mensagem…" />
            <Button onClick={submit} disabled={send.isPending || !text.trim()}><Send className="h-4 w-4" /></Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PriorityBadge({ p }: { p: string }) {
  const map: any = { low: 'outline', normal: 'secondary', high: 'default', urgent: 'destructive' };
  return <Badge variant={map[p] || 'secondary'} className="text-[10px]">{p}</Badge>;
}
function StatusBadge({ s }: { s: string }) {
  const map: any = { open: 'default', in_progress: 'secondary', waiting_customer: 'outline', resolved: 'outline', closed: 'outline' };
  const label: any = { open: 'Aberto', in_progress: 'Em andamento', waiting_customer: 'Aguardando você', resolved: 'Resolvido', closed: 'Fechado' };
  return <Badge variant={map[s] || 'secondary'} className="text-[10px]">{label[s] || s}</Badge>;
}

function TrainingTab() {
  const [active, setActive] = useState<typeof TRAINING_VIDEOS[number] | null>(null);
  const topics = Array.from(new Set(TRAINING_VIDEOS.map(v => v.topic)));
  const [filter, setFilter] = useState<string>('all');
  const list = filter === 'all' ? TRAINING_VIDEOS : TRAINING_VIDEOS.filter(v => v.topic === filter);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>Todos</Button>
        {topics.map(t => (
          <Button key={t} size="sm" variant={filter === t ? 'default' : 'outline'} onClick={() => setFilter(t)}>{t}</Button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map(v => (
          <button key={v.title} onClick={() => setActive(v)}
            className="text-left rounded-lg border bg-card hover:bg-muted/50 transition p-3 space-y-2">
            <div className="aspect-video bg-muted rounded flex items-center justify-center">
              <PlayCircle className="h-10 w-10 text-primary opacity-80" />
            </div>
            <div className="font-medium text-sm">{v.title}</div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <Badge variant="secondary" className="text-[10px]">{v.topic}</Badge>
              <span>{v.duration}</span>
            </div>
          </button>
        ))}
      </div>

      <Dialog open={!!active} onOpenChange={(v) => !v && setActive(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{active?.title}</DialogTitle></DialogHeader>
          {active && (
            <div className="aspect-video">
              <iframe src={active.url} className="w-full h-full rounded-lg" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
