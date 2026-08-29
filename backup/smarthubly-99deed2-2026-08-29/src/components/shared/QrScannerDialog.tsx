import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onClose: () => void;
  onScan: (text: string) => void;
}

export default function QrScannerDialog({ open, onClose, onScan }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = 'qr-reader-' + Math.random().toString(36).slice(2, 8);
  const idRef = useRef(containerId);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(null);
    let active = true;
    let cancelled = false;
    // Aguarda o container existir no DOM
    const start = async () => {
      // espera pequeno tick pro Dialog montar o container
      await new Promise(r => setTimeout(r, 100));
      if (cancelled) return;
      const el = document.getElementById(idRef.current);
      if (!el) {
        setError('Não consegui inicializar a câmera (container não encontrado).');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Seu navegador não suporta acesso à câmera. Use Chrome ou Brave em HTTPS.');
        return;
      }
      try {
        const scanner = new Html5Qrcode(idRef.current);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decoded) => {
            if (!active) return;
            active = false;
            onScan(decoded);
            scanner.stop().then(() => scanner.clear()).catch(() => {});
          },
          () => { /* ignore frame errors */ }
        );
      } catch (e: any) {
        console.error('QR scanner error', e);
        const msg = e?.message || String(e);
        if (/permission|denied|NotAllowed/i.test(msg)) {
          setError('Permissão de câmera negada. Toque no cadeado da URL → Permissões → Câmera → Permitir, e tente novamente.');
        } else if (/NotFound|no camera/i.test(msg)) {
          setError('Nenhuma câmera encontrada neste dispositivo.');
        } else {
          setError(`Erro ao iniciar câmera: ${msg}`);
        }
      }
    };
    start();
    return () => {
      cancelled = true;
      active = false;
      const s = scannerRef.current;
      if (s) {
        s.stop().then(() => s.clear()).catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [open, onScan]);

  const submitManual = () => {
    const v = manual.trim();
    if (!v) return;
    onScan(v);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Escanear QR da Mesa</DialogTitle>
        </DialogHeader>
        <div id={idRef.current} className="w-full rounded overflow-hidden bg-black min-h-[280px]" />
        {error ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive text-center">{error}</p>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground text-center">Ou cole/digite o código da mesa abaixo:</p>
              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-2 rounded border bg-background text-sm"
                  placeholder="código da mesa"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitManual()}
                />
                <Button onClick={submitManual} size="sm">Abrir</Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center">
            Aponte para o QR code da mesa. A comanda abrirá automaticamente já vinculada a você.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
