import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Printer, Bluetooth, Volume2, FileText, RotateCcw, TestTube2, Server, Copy, Check, Eye } from 'lucide-react';
import { pairPrinter, isBluetoothSupported, isPrinterPaired, forgetPrinter } from '@/lib/printer-bluetooth';
import { isSimulationMode, setSimulationMode } from '@/lib/printer-simulator';
import { printTestReceipt } from '@/lib/order-print';
import type { Tables } from '@/integrations/supabase/types';

interface Props {
  tenantId: string;
}

type TenantRow = Tables<'tenants'>;

const TenantAdminPrinter = ({ tenantId }: Props) => {
  const [tenant, setTenant] = useState<TenantRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paired, setPaired] = useState(isPrinterPaired());
  const [simulation, setSimulation] = useState(isSimulationMode());
  const [tokenCopied, setTokenCopied] = useState(false);

  // Form state
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<'auto' | 'manual' | 'both'>('manual');
  const [paper, setPaper] = useState<'58mm' | '80mm'>('80mm');
  const [kitchen, setKitchen] = useState(true);
  const [header, setHeader] = useState('');
  const [footer, setFooter] = useState('Obrigado pela preferência!');
  const [soundOn, setSoundOn] = useState(true);
  const [soundLoud, setSoundLoud] = useState(true);

  useEffect(() => {
    supabase.from('tenants').select('*').eq('id', tenantId).single().then(({ data }) => {
      if (data) {
        setTenant(data as TenantRow);
        const t = data as any;
        setEnabled(t.printer_enabled ?? false);
        setMode(t.printer_mode || 'manual');
        setPaper(t.printer_paper_width || '80mm');
        setKitchen(t.printer_kitchen_copy ?? true);
        setHeader(t.printer_header_text || '');
        setFooter(t.printer_footer_text || 'Obrigado pela preferência!');
        setSoundOn(t.sound_alert_enabled ?? true);
        setSoundLoud(t.sound_alert_loud ?? true);
      }
      setLoading(false);
    });
  }, [tenantId]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('tenants').update({
      printer_enabled: enabled,
      printer_mode: mode,
      printer_paper_width: paper,
      printer_kitchen_copy: kitchen,
      printer_header_text: header,
      printer_footer_text: footer,
      sound_alert_enabled: soundOn,
      sound_alert_loud: soundLoud,
    } as any).eq('id', tenantId);
    setSaving(false);
    if (error) toast.error('Erro ao salvar');
    else toast.success('Configurações salvas!');
  };

  const handlePair = async () => {
    try {
      const result = await pairPrinter();
      setPaired(true);
      toast.success(`Pareado: ${result.name}`);
    } catch (e: any) {
      toast.error(e.message || 'Falha ao parear');
    }
  };

  const handleForget = () => {
    forgetPrinter();
    setPaired(false);
    toast.success('Impressora removida. Pareie outra quando quiser.');
  };

  const handleTest = async () => {
    if (!tenant) return;
    try {
      await printTestReceipt(tenant);
      if (simulation) {
        toast.success('✅ Cupom de teste gerado! Veja a janela aberta com a prévia.');
      } else {
        toast.success('✅ Cupom enviado pra impressora! Confira se saiu.');
      }
    } catch (e: any) {
      const msg = e?.message || 'Falha desconhecida';
      toast.error(`❌ Erro ao imprimir: ${msg}`, { duration: 6000 });
    }
  };

  const toggleSimulation = (on: boolean) => {
    setSimulation(on);
    setSimulationMode(on);
    if (on) {
      toast.success('🧪 Modo simulação ativado — os cupons abrirão em uma janela do navegador.');
    } else {
      toast.success('Modo simulação desativado — vai imprimir na impressora real.');
    }
  };

  const copyToken = () => {
    if (!tenant) return;
    navigator.clipboard.writeText((tenant as any).printer_agent_token);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  if (loading) return <div className="h-32 flex items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  if (!tenant) return null;

  const btSupported = isBluetoothSupported();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-heading text-lg text-foreground flex items-center gap-2">
          <Printer className="h-5 w-5 text-primary" /> Impressora térmica
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Configure sua impressora térmica de 58mm ou 80mm para imprimir cupons de pedidos automaticamente.
        </p>
      </div>

      {/* Liga/Desliga */}
      <div className="rounded-lg border border-border bg-card p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
            className="mt-1 w-4 h-4 accent-primary" />
          <div>
            <p className="text-sm text-foreground font-medium">Ativar impressão de cupons</p>
            <p className="text-xs text-muted-foreground mt-0.5">Quando desligado, nada é impresso e o botão de imprimir não aparece nos pedidos.</p>
          </div>
        </label>
      </div>

      {enabled && (
        <>
          {/* Modo */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="font-heading text-sm text-foreground">Quando imprimir</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { id: 'auto' as const, label: '⚡ Automático', desc: 'Imprime sozinho assim que entra um pedido' },
                { id: 'manual' as const, label: '👆 Manual', desc: 'Só imprime quando clico em "Imprimir"' },
                { id: 'both' as const, label: '🔀 Auto + botão', desc: 'Automático + botão pra reimprimir' },
              ].map(opt => (
                <button key={opt.id} onClick={() => setMode(opt.id)}
                  className={`text-left rounded-lg border p-3 transition-all ${
                    mode === opt.id ? 'border-primary bg-primary/10' : 'border-border bg-secondary hover:border-primary/50'
                  }`}>
                  <p className="text-sm font-medium text-foreground">{opt.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Papel */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="font-heading text-sm text-foreground">Tamanho do papel</h3>
            <div className="grid grid-cols-2 gap-2">
              {(['58mm', '80mm'] as const).map(p => (
                <button key={p} onClick={() => setPaper(p)}
                  className={`rounded-lg border p-3 transition-all ${
                    paper === p ? 'border-primary bg-primary/10' : 'border-border bg-secondary hover:border-primary/50'
                  }`}>
                  <p className="text-sm font-medium text-foreground">{p}</p>
                  <p className="text-xs text-muted-foreground">{p === '58mm' ? '32 caracteres por linha' : '48 caracteres por linha'}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Cozinha */}
          <div className="rounded-lg border border-border bg-card p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={kitchen} onChange={e => setKitchen(e.target.checked)}
                className="mt-1 w-4 h-4 accent-primary" />
              <div>
                <p className="text-sm text-foreground font-medium flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Imprimir via da cozinha
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Imprime 2 cupons: o completo (caixa/entrega) + um simplificado só com itens, em fonte grande, pra cozinha.</p>
              </div>
            </label>
          </div>

          {/* Cabeçalho/Rodapé */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="font-heading text-sm text-foreground">Personalizar cupom</h3>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Cabeçalho (aparece embaixo do nome da loja)</label>
              <input value={header} onChange={e => setHeader(e.target.value)} maxLength={60}
                placeholder="Ex: Rua das Flores, 123 — (11) 9999-9999"
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Rodapé</label>
              <input value={footer} onChange={e => setFooter(e.target.value)} maxLength={60}
                placeholder="Deixe em branco — o sistema escolhe pelo nicho"
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
              <p className="text-[10px] text-muted-foreground mt-1">Em branco: usa frase do nicho (ex: "Bom apetite!" para comida, "Até logo!" para serviço).</p>
            </div>
          </div>

          {/* Som */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-primary" /> Alerta sonoro
            </h3>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={soundOn} onChange={e => setSoundOn(e.target.checked)}
                className="mt-1 w-4 h-4 accent-primary" />
              <div>
                <p className="text-sm text-foreground font-medium">Tocar som quando entrar pedido novo</p>
                <p className="text-xs text-muted-foreground mt-0.5">Toca no painel de pedidos do admin enquanto a aba estiver aberta.</p>
              </div>
            </label>
            {soundOn && (
              <div className="grid grid-cols-2 gap-2 pl-7">
                <button onClick={() => setSoundLoud(true)}
                  className={`rounded-lg border p-2.5 text-left transition-all ${soundLoud ? 'border-primary bg-primary/10' : 'border-border bg-secondary'}`}>
                  <p className="text-xs font-medium text-foreground">🔊 Alto (estilo iFood)</p>
                  <p className="text-[10px] text-muted-foreground">Repete até clicar em "Visto"</p>
                </button>
                <button onClick={() => setSoundLoud(false)}
                  className={`rounded-lg border p-2.5 text-left transition-all ${!soundLoud ? 'border-primary bg-primary/10' : 'border-border bg-secondary'}`}>
                  <p className="text-xs font-medium text-foreground">🔉 Discreto</p>
                  <p className="text-[10px] text-muted-foreground">Um bip curto</p>
                </button>
              </div>
            )}
          </div>

          {/* Modo Simulação */}
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3">
            <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" /> Modo simulação
              {simulation && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">ATIVO</span>}
            </h3>
            <p className="text-xs text-muted-foreground">
              Não tem impressora térmica ainda? Ative o modo simulação — em vez de mandar pra impressora real,
              o cupom abre numa janela do navegador exatamente como sairia. Ótimo pra testar todo o fluxo
              (som de alerta, layout, via da cozinha) sem precisar do hardware.
            </p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={simulation} onChange={e => toggleSimulation(e.target.checked)}
                className="mt-1 w-4 h-4 accent-primary" />
              <div>
                <p className="text-sm text-foreground font-medium">Ativar simulação no navegador</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ⚠️ Permita popups deste site se o navegador bloquear a janela.
                </p>
              </div>
            </label>
            {simulation && (
              <button onClick={handleTest}
                className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90">
                <TestTube2 className="h-4 w-4" /> Gerar cupom de teste agora
              </button>
            )}
          </div>

          {/* Bluetooth */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
              <Bluetooth className="h-4 w-4 text-blue-400" /> Conectar via Bluetooth
            </h3>
            <p className="text-xs text-muted-foreground">
              Funciona em <strong className="text-foreground">Chrome no Android</strong> e Chrome/Edge no PC.
              Não funciona em iPhone (limitação da Apple). Para iPhone, use o agente PC.
            </p>

            {!btSupported ? (
              <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-400">
                ⚠️ Este navegador não suporta Web Bluetooth. Use Chrome no Android ou no PC, ou instale o agente PC abaixo.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {!paired ? (
                  <button onClick={handlePair}
                    className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90">
                    <Bluetooth className="h-4 w-4" /> Parear impressora
                  </button>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 rounded-lg bg-green-500/20 text-green-400 px-3 py-2 text-xs font-medium">
                      <Check className="h-3.5 w-3.5" /> Impressora pareada
                    </span>
                    <button onClick={handleTest}
                      className="flex items-center gap-2 rounded-lg bg-secondary text-foreground px-3 py-2 text-sm hover:bg-secondary/80">
                      <TestTube2 className="h-4 w-4" /> Imprimir teste
                    </button>
                    <button onClick={handleForget}
                      className="flex items-center gap-2 rounded-lg bg-secondary text-muted-foreground px-3 py-2 text-sm hover:text-destructive">
                      <RotateCcw className="h-4 w-4" /> Esquecer
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Agente PC */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
              <Server className="h-4 w-4 text-purple-400" /> Agente PC (USB ou Rede)
            </h3>
            <p className="text-xs text-muted-foreground">
              Para impressoras USB ou de rede, instale nosso mini-programa no PC do balcão.
              Ele fica escutando novos pedidos e imprime automaticamente.
              Funciona com <strong className="text-foreground">qualquer impressora ESC/POS</strong> (Epson, Bematech, Elgin, Knup, etc).
            </p>

            <div className="rounded-md bg-secondary p-3 space-y-2">
              <p className="text-xs text-muted-foreground">Token único da sua loja (cole no agente):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-background px-2 py-1.5 text-xs font-mono text-foreground">
                  {(tenant as any).printer_agent_token}
                </code>
                <button onClick={copyToken}
                  className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90">
                  {tokenCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <details className="rounded-md bg-secondary p-3">
              <summary className="text-xs text-foreground cursor-pointer font-medium">📥 Como instalar o agente PC</summary>
              <ol className="mt-3 space-y-2 text-xs text-muted-foreground list-decimal pl-4">
                <li>Baixe o agente: <a href="/print-agent.zip" download className="text-primary underline">print-agent.zip</a></li>
                <li>Extraia em qualquer pasta (ex: Documentos)</li>
                <li>Abra o arquivo <code className="bg-background px-1 rounded">config.json</code> e cole o token acima</li>
                <li>Instale o Node.js (versão 18 ou superior) — <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="text-primary underline">nodejs.org</a></li>
                <li>Abra o terminal/cmd na pasta e rode: <code className="bg-background px-1 rounded">npm install</code></li>
                <li>Em seguida: <code className="bg-background px-1 rounded">node agent.js</code></li>
                <li>Pronto! O agente vai imprimir todo pedido novo automaticamente.</li>
              </ol>
              <p className="mt-2 text-[10px] text-muted-foreground">💡 Dica: para iniciar com o Windows, crie um atalho na pasta Inicializar.</p>
            </details>
          </div>
        </>
      )}

      {/* Save */}
      <div className="sticky bottom-4 z-10">
        <button onClick={save} disabled={saving}
          className="w-full rounded-xl gradient-primary text-primary-foreground py-3 font-medium hover:opacity-90 disabled:opacity-50">
          {saving ? 'Salvando...' : 'Salvar configurações'}
        </button>
      </div>
    </div>
  );
};

export default TenantAdminPrinter;
