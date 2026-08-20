import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import logoOficial from '@/assets/logo-smarthubly-navy.png';
import { Sparkles, Copy, Loader2, Wand2, Camera, MessageSquare, FileText, Film, Layers, Hash, Download, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

type Format = 'post_dia' | 'story' | 'bio' | 'reels_script' | 'carousel' | 'whatsapp' | 'hashtags';

const FORMATS: { id: Format; label: string; icon: JSX.Element; desc: string }[] = [
  { id: 'post_dia', label: 'Post do dia', icon: <Camera className="h-4 w-4" />, desc: 'Legenda + CTA + hashtags' },
  { id: 'story', label: 'Story', icon: <FileText className="h-4 w-4" />, desc: '3 telas curtas' },
  { id: 'bio', label: 'Bio Instagram', icon: <Sparkles className="h-4 w-4" />, desc: '3 opções de bio' },
  { id: 'reels_script', label: 'Roteiro Reels', icon: <Film className="h-4 w-4" />, desc: 'Roteiro 15-25s' },
  { id: 'carousel', label: 'Carrossel', icon: <Layers className="h-4 w-4" />, desc: '5 slides' },
  { id: 'whatsapp', label: 'Disparo WhatsApp', icon: <MessageSquare className="h-4 w-4" />, desc: 'Mensagem pronta' },
  { id: 'hashtags', label: 'Hashtags', icon: <Hash className="h-4 w-4" />, desc: '20 hashtags relevantes' },
];

const TONES = ['Descontraído', 'Vendedor direto', 'Premium / sofisticado', 'Promocional gritante', 'Conta uma história'];

type ImageStyle = 'auto' | 'realistic' | 'cartoon' | '3d' | 'minimal' | 'vintage' | 'anime';
const IMAGE_STYLES: { id: ImageStyle; label: string; desc: string }[] = [
  { id: 'auto', label: '🎯 Automático', desc: 'IA escolhe' },
  { id: 'realistic', label: '📸 Realista', desc: 'Foto profissional' },
  { id: 'cartoon', label: '🎨 Cartoon', desc: 'Ilustração flat' },
  { id: '3d', label: '🧊 3D', desc: 'Render Pixar' },
  { id: 'minimal', label: '⚪ Minimal', desc: 'Clean editorial' },
  { id: 'vintage', label: '📻 Vintage', desc: 'Retrô anos 80' },
  { id: 'anime', label: '🌸 Anime', desc: 'Estilo Ghibli' },
];

interface Props {
  scope: 'tenant' | 'platform';
  tenantId?: string;
  title?: string;
  defaultAudience?: string;
  allowImage?: boolean; // habilita geração de imagem
}

const MarketingPostGenerator = ({ scope, tenantId, title, defaultAudience, allowImage = false }: Props) => {
  const [format, setFormat] = useState<Format>('post_dia');
  const [tone, setTone] = useState(TONES[0]);
  const [extra, setExtra] = useState('');
  const [audience, setAudience] = useState(defaultAudience || '');
  const [generateImage, setGenerateImage] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageStyle, setImageStyle] = useState<ImageStyle>('auto');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<{ title1: string; title2: string; subtitle: string; mode: string; style?: ImageStyle } | null>(null);
  const [finalArt, setFinalArt] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ tenantName?: string; totalOrders?: number; topSold?: string[] } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const generate = async () => {
    setLoading(true); setOutput(''); setImage(null); setOverlay(null); setFinalArt(null); setMeta(null);
    try {
      // Fetch direto: o invoke do supabase-js v2 às vezes fica preso em respostas grandes (>700KB);
      // chamando fetch() direto com o mesmo token evitamos o loop infinito.
      const payload = { scope, tenantId, format, tone, extraContext: extra, audience, generateImage: allowImage && generateImage, imagePrompt, imageStyle };
      const invokeP = (async () => {
        // Token: getSession pode ficar pendente; lê direto do localStorage do projeto novo
        const EF_URL = '${import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketing-unified/post';
        let ak: string | undefined;
        const s = await Promise.race([
          supabase.auth.getSession(),
          new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
        ]);
        ak = (s as any)?.data?.session?.access_token;
        if (!ak) {
          const raw = localStorage.getItem('sb-qbcplbcdxoyqpmcehnvu-auth-token');
          try { ak = JSON.parse(raw || '{}')?.access_token; } catch { /* ignore */ }
        }
        const r = await fetch(EF_URL, {
          method: 'POST',
          headers: {
            Authorization: ak ? `Bearer ${ak}` : '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          throw new Error(`Erro do servidor (${r.status}): ${t || 'sem detalhes'}`);
        }
        const data = await r.json();
        return { data, error: null };
      })();
      // Proteção contra loop infinito: se a resposta não chegar em 150s, aborta e avisa
      const timeoutP = new Promise<{ data: null; error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: { message: 'A geração demorou demais e foi cancelada. Tente novamente em instantes (a IA ainda está processando).' } }), 150_000)
      );
      const { data, error } = await Promise.race([invokeP, timeoutP]);
      if (error) throw error;
      if (!data?.content) throw new Error(data?.error || 'Sem retorno');
      setOutput(sanitizeOutput(data.content));
      setMeta(data.context_used);
      setOverlay(data.overlay || null);
      setFinalArt(null);
      // Garante formato válido: a cascata retorna URL pública do storage (https://...?ai=1)
      // ou base64 puro (ex: /9j/...); nunca prefixar base64 em URL http(s) senão a <img> quebra
      if (data?.image) {
        setImage(
          data.image.startsWith('data:')
            ? data.image
            : /^https?:\/\//.test(data.image)
              ? data.image
              : `data:image/jpeg;base64,${data.image}`
        );
      } else {
        setImage(null);
        setOverlay(null);
        setFinalArt(null);
      }
      if (allowImage && generateImage && !data.image) {
        toast.warning('Texto pronto, mas não consegui gerar a imagem (créditos ou modelo indisponível)');
      }
      if (allowImage && generateImage && data.image) {
        toast.success('Arte pronta! Confira a imagem abaixo.');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao gerar');
    } finally { setLoading(false); }
  };

  // Limpeza do texto cru da IA: remove markdown de bold (**) e cabeçalhos (###, ---)
  // que às vezes escapam das instruções, além de linhas de rótulo do tipo "**Hashtags:**"
  const sanitizeOutput = (text: string) => {
    if (!text) return text;
    return text
      // separadores e cabeçalhos markdown crus
      .replace(/^\s*-{3,}\s*$/gm, '')
      .replace(/^\s*#{2,}\s+/gm, '')
      // "**Rótulo:** Valor" → "Rótulo — Valor"
      .replace(/^(\s*)\*\*([^*]{1,60})\*\*\s*:?\s*/gm, (_m, pad, label) => `${pad}${label.trim().charAt(0).toUpperCase() + label.trim().slice(1)} — `)
      // bold isolado restante (palavra entre **)**
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      // asterisco solto em linha própria
      .replace(/^\s*\*\s*$/gm, '')
      // até 2 quebras de linha seguidas
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const copy = () => { if (output) { navigator.clipboard.writeText(output); toast.success('Texto copiado!'); } };

  // ===== Paletas e tipografia por modo visual (respeita a escolha do usuário)
  // Os estilos "premium" (auto/realistic/editorial) usam o padrão dos posts novos do perfil:
  // serif Playfair Display, badge coral, formas curvas, rodapé wordmark serif.
  const STYLE_THEMES: Record<ImageStyle, {
    panel: [string, string]; // gradiente do painel de texto
    title: string; accent: string; sub: string; badge: string;
    serif: boolean;
    curves: boolean;
    panelW: number;
  }> = {
    auto: { panel: ['rgba(10,28,46,0.94)', 'rgba(10,28,46,0)'], title: '#F5EDE0', accent: '#D4AF37', sub: '#B9C7DB', badge: '#D9614A', serif: true, curves: true, panelW: 0.62 },
    realistic: { panel: ['rgba(10,28,46,0.94)', 'rgba(10,28,46,0)'], title: '#F5EDE0', accent: '#D4AF37', sub: '#B9C7DB', badge: '#D9614A', serif: true, curves: true, panelW: 0.62 },
    cartoon: { panel: ['rgba(29,78,216,0.95)', 'rgba(251,191,36,0.55)'], title: '#FFFFFF', accent: '#FDE047', sub: '#DBEAFE', badge: '#F97316', serif: false, curves: true, panelW: 0.60 },
    '3d': { panel: ['rgba(76,29,149,0.95)', 'rgba(244,114,182,0.6)'], title: '#FFFFFF', accent: '#FBCFE8', sub: '#EDE9FE', badge: '#22D3EE', serif: false, curves: true, panelW: 0.60 },
    minimal: { panel: ['rgba(250,248,245,0.96)', 'rgba(250,248,245,0)'], title: '#171717', accent: '#171717', sub: '#525252', badge: '#E5E2DC', serif: true, curves: false, panelW: 0.52 },
    vintage: { panel: ['rgba(107,68,35,0.93)', 'rgba(234,223,197,0.25)'], title: '#EADFC5', accent: '#F3C969', sub: '#C9B896', badge: '#B23A48', serif: true, curves: true, panelW: 0.62 },
    anime: { panel: ['rgba(14,116,144,0.93)', 'rgba(248,113,113,0.55)'], title: '#FFFFFF', accent: '#FECDD3', sub: '#CFFAFE', badge: '#34D399', serif: false, curves: true, panelW: 0.60 },
  };

  // ===== Compositor de arte — padrão orgânico oficial dos posts @smarthubly (post "Sua marca merece").
  // Foto em tela cheia (cover sem distorção), grande arco navy à esquerda contendo o bloco
  // de texto (título serif alinhado à esquerda: 1ª linha creme, última dourada; traço coral;
  // subtítulo branco; badge coral arredondado "SmartHubly"), filete dourado seguindo a curva
  // do arco. Rodapé navy com curva dourada + logo oficial (mantido como o usuário pediu).
  // Tipografia 100% perfeita: texto renderizado pelo Canvas, não pela IA.
  const composeArt = async (imgSrc: string, ov: { title1: string; title2: string; subtitle: string; style?: ImageStyle }) => {
    const SIZE = 1080;
    const NAVY = '#071729';   // navy oficial (amostrado do post de referência)
    const GOLD = '#C09A4F';   // dourado oficial
    const CREAM = '#F2EDE3';  // creme oficial
    const CORAL = '#C45548';  // coral oficial do traço/badge
    const NAVY_TX = '#0B2240';
    const LOGO_URL = logoOficial; // logo oficial importada
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    canvasRef.current = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const loadImg = (src: string): Promise<HTMLImageElement> => new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
    try {
      const bg = await loadImg(imgSrc);
      const logo = await loadImg(LOGO_URL);

      // ===== Foto em tela cheia — cover uniforme (SEM distorção: escala proporcional)
      const scale = Math.max(SIZE / bg.width, SIZE / bg.height);
      const dw = bg.width * scale, dh = bg.height * scale;
      ctx.drawImage(bg, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);

      const serif = "'Playfair Display', Georgia, serif";
      const sans = "'Montserrat', 'Inter', 'Segoe UI', Arial, sans-serif";
      const bold = (px: number) => `800 ${px}px ${serif}`;
      const reg = (px: number) => `600 ${px}px ${sans}`;
      const drawLines = (text: string, sizePx: number, maxW: number, x0: number, y0: number, lineH: number): number => {
        ctx.font = sizePx;
        const words = text.split(' ');
        let line = ''; let y = y0; let count = 0;
        for (const w of words) {
          const test = line ? `${line} ${w}` : w;
          if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, x0, y); y += lineH; line = w; count++;
            if (count >= 4) { ctx.fillText(line, x0, y); return y + lineH; }
          } else { line = test; }
        }
        if (line) { ctx.fillText(line, x0, y); y += lineH; count++; }
        return y;
      };

      // ===== Compositor orgânico oficial (curva Bézier validada):
      // curva suave do topo (x=35%) à lateral direita (y=45%); a foto ocupa a
      // região à direita da curva (full-bleed até as bordas); navy à esquerda com
      // o bloco de texto; filete dourado na curva; rodapé navy com logo oficial.
      const topX = SIZE * 0.35;   // curva cruza o topo em x=35%
      const sideY = SIZE * 0.45;  // curva termina na lateral direita em y=45%
      const yBase = SIZE * 0.93;  // base do rodapé navy
      const curveTo = (c: CanvasPath) => {
        c.moveTo(topX, 0);
        c.bezierCurveTo(
          topX + SIZE * 0.28, SIZE * 0.02,
          SIZE - SIZE * 0.02, sideY - SIZE * 0.28,
          SIZE, sideY
        );
      };
      // base navy
      ctx.fillStyle = NAVY;
      ctx.fillRect(0, 0, SIZE, SIZE);
      // região da foto: curva do topo à lateral, fecha pela lateral direita até
      // o rodapé e retorna ao início da curva — sem cruzar o navy da esquerda
      ctx.save();
      ctx.beginPath();
      curveTo(ctx);
      ctx.lineTo(SIZE, yBase);
      ctx.lineTo(topX, yBase);
      ctx.lineTo(topX, 0);
      ctx.closePath();
      ctx.clip();
      const sc = Math.max(SIZE / bg.width, SIZE / bg.height);
      const fW = bg.width * sc, fH = bg.height * sc;
      ctx.drawImage(bg, (SIZE - fW) / 2, (SIZE - fH) / 2, fW, fH);
      ctx.restore();
      // filete dourado seguindo a curva
      ctx.beginPath();
      curveTo(ctx);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 5;
      ctx.stroke();

      // ===== Bloco de texto alinhado à esquerda SOBRE o navy (como no post oficial)
      const mx = SIZE * 0.06;
      const maxW = SIZE * 0.34;
      let ty = SIZE * 0.07;
      const t1 = (ov.title1 || '').trim().slice(0, 46);
      const t2 = (ov.title2 || '').trim().slice(0, 46);
      // Título: linhas 1+ em creme, última em dourado
      ctx.fillStyle = CREAM;
      ctx.font = bold(SIZE * 0.068);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      let y = ty;
      y = drawLines(t1, bold(SIZE * 0.068), maxW, mx, y, SIZE * 0.080);
      if (t2) {
        y += SIZE * 0.020;
        ctx.fillStyle = GOLD;
        y = drawLines(t2, bold(SIZE * 0.068), maxW, mx, y, SIZE * 0.080);
      }
      // traço coral sob o título
      y += SIZE * 0.030;
      ctx.fillStyle = CORAL;
      const trW = SIZE * 0.135;
      ctx.beginPath();
      ctx.moveTo(mx, y); ctx.lineTo(mx + trW, y); ctx.lineTo(mx + trW, y + 8); ctx.lineTo(mx, y + 8); ctx.closePath(); ctx.fill();
      // subtítulo branco/creme, sans-serif (máx 3 linhas)
      y += SIZE * 0.050;
      ctx.fillStyle = 'rgba(242,237,227,0.95)';
      ctx.font = reg(SIZE * 0.030);
      drawLines((ov.subtitle || '').slice(0, 100), reg(SIZE * 0.030), maxW, mx, y, SIZE * 0.046);

      // ===== Rodapé navy com curva dourada + logo oficial
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, yBase - SIZE * 0.045);
      ctx.quadraticCurveTo(SIZE * 0.5, yBase + SIZE * 0.050, SIZE, yBase - SIZE * 0.045);
      ctx.lineTo(SIZE, SIZE); ctx.lineTo(0, SIZE);
      ctx.closePath();
      ctx.fillStyle = NAVY;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, yBase - SIZE * 0.045);
      ctx.quadraticCurveTo(SIZE * 0.5, yBase + SIZE * 0.050, SIZE, yBase - SIZE * 0.045);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 5;
      ctx.stroke();
      ctx.restore();
      const logoH = SIZE * 0.125;
      const logoW = logo.width * (logoH / logo.height);
      ctx.drawImage(logo, (SIZE - logoW) / 2, SIZE * 0.855, logoW, logoH);

      return canvas.toDataURL('image/jpeg', 0.92);
    } catch (err) {
      console.error('[composeArt] falha ao compor a arte:', err);
      return null;
    }
  };

  useEffect(() => {
    if (!image || !overlay || overlay.mode !== 'editorial_overlay') { setFinalArt(null); return; }
    let alive = true;
    void composeArt(image, { title1: overlay.title1, title2: overlay.title2, subtitle: overlay.subtitle, style: overlay.style })
      .then((art) => { if (alive) setFinalArt(art); });
    return () => { alive = false; };
  }, [image, overlay]);

  const download = () => {
    const src = finalArt || image;
    if (!src) return;
    try {
      if (src.startsWith('data:')) {
        // data URL direta: baixa imediatamente (funciona em desktop e mobile)
        const a = document.createElement('a');
        a.href = src;
        a.download = `post-${format}-${Date.now()}.jpg`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      } else {
        // URL remota: baixa via blob
        void fetch(src)
          .then((r) => r.blob())
          .then((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `post-${format}-${Date.now()}.png`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
          })
          .catch(() => {
            const a = document.createElement('a');
            a.href = src;
            a.download = `post-${format}-${Date.now()}.png`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
          });
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div>
          <h2 className="font-heading text-base text-foreground flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" /> {title || 'Gerador de posts com IA'}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {scope === 'tenant'
              ? 'A IA analisa seu catálogo, mais vendidos e nicho pra criar o post.'
              : 'Gere posts pra divulgar a plataforma. A IA usa o briefing + sua estratégia.'}
          </p>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Formato</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {FORMATS.map(f => (
              <button key={f.id} onClick={() => setFormat(f.id)}
                className={`flex flex-col items-start gap-1 rounded-md border p-2 text-left transition ${
                  format === f.id ? 'border-primary bg-primary/10' : 'border-border bg-secondary/30 hover:border-primary/40'
                }`}>
                <span className="flex items-center gap-1 text-xs font-medium text-foreground">{f.icon}{f.label}</span>
                <span className="text-[10px] text-muted-foreground">{f.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Tom de voz</label>
            <select value={tone} onChange={e => setTone(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              {TONES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {scope === 'platform' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Público alvo</label>
              <Input value={audience} onChange={e => setAudience(e.target.value)} placeholder="Ex: donos de hambúrguerias em SP" />
            </div>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Briefing extra (opcional)</label>
          <Textarea value={extra} onChange={e => setExtra(e.target.value)} rows={3}
            placeholder={scope === 'tenant'
              ? 'Ex: hoje é quinta de chopp, quero divulgar combo de 2 hambúrguer + batata...'
              : 'Ex: foco na oferta dos 500 fundadores R$60 fixo, sem taxa de pedido...'} />
        </div>

        {allowImage && (
          <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
              <input type="checkbox" checked={generateImage} onChange={e => setGenerateImage(e.target.checked)} className="h-4 w-4" />
              <ImageIcon className="h-4 w-4 text-primary" />
              Gerar imagem do post (1:1, pronta pra baixar)
            </label>
            {generateImage && (
              <>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Estilo visual</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {IMAGE_STYLES.map(s => (
                      <button key={s.id} type="button" onClick={() => setImageStyle(s.id)}
                        className={`rounded-md border px-2 py-1.5 text-left transition ${
                          imageStyle === s.id ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-primary/40'
                        }`}>
                        <div className="text-[11px] font-medium text-foreground leading-tight">{s.label}</div>
                        <div className="text-[9px] text-muted-foreground">{s.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <Textarea value={imagePrompt} onChange={e => setImagePrompt(e.target.value)} rows={2}
                  placeholder="Briefing extra da imagem (opcional). Ex: foco no hambúrguer com queijo derretido, fundo escuro, luz quente" />
              </>
            )}
            <p className="text-[10px] text-muted-foreground">A IA lê seu post e cria uma arte 1:1 no padrão oficial do feed: título serif centralizado, faixa da foto com o tema do post e logo SmartHubly no rodapé. O estilo visual escolhido afeta a imagem gerada (foto, cartoon, 3D etc.).</p>
          </div>
        )}

        <Button onClick={generate} disabled={loading} className="w-full">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {loading ? 'Gerando...' : 'Gerar com IA'}
        </Button>
      </div>

      {output && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-heading text-sm text-foreground">Resultado</h3>
            <Button size="sm" variant="outline" onClick={copy}><Copy className="h-3 w-3 mr-1" />Copiar texto</Button>
          </div>
          <pre className="whitespace-pre-wrap text-sm text-foreground font-sans leading-relaxed">{output}</pre>
          {(finalArt || image) && (
            <div className="space-y-2 border-t border-border pt-3">
              <img src={finalArt || image!} alt="Post gerado" className="w-full max-w-md rounded-md border border-border" />
              <p className="text-[10px] text-muted-foreground">
                {finalArt ? `Arte final no padrão do feed oficial (foto IA + título de marca SmartHubly${imageStyle !== 'auto' ? ` · estilo: ${IMAGE_STYLES.find(s => s.id === imageStyle)?.label}` : ''})` : 'Imagem gerada pela IA'}
              </p>
              <Button size="sm" onClick={download} className="w-full sm:w-auto">
                <Download className="h-3 w-3 mr-1" /> Baixar imagem
              </Button>
            </div>
          )}
          {meta && (
            <p className="text-[10px] text-muted-foreground border-t border-border pt-2">
              {meta.tenantName ? `Loja: ${meta.tenantName} · ` : ''}IA usou: {meta.totalOrders ?? 0} pedidos últimos 30d{meta.topSold?.length ? ` · top: ${meta.topSold.slice(0, 3).join(', ')}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default MarketingPostGenerator;
