/**
 * Modo Simulação — abre uma janela do navegador mostrando o cupom
 * exatamente como sairia da impressora térmica.
 * Útil pra testar o fluxo sem precisar de hardware.
 */

const STORAGE_KEY = 'lovable.printer.simulationMode';

export const isSimulationMode = (): boolean => {
  return localStorage.getItem(STORAGE_KEY) === '1';
};

export const setSimulationMode = (on: boolean): void => {
  if (on) localStorage.setItem(STORAGE_KEY, '1');
  else localStorage.removeItem(STORAGE_KEY);
};

/**
 * Converte bytes ESC/POS de volta em texto legível,
 * ignorando comandos de controle e mantendo só o conteúdo imprimível.
 */
function bytesToReadableText(data: Uint8Array): string {
  const result: string[] = [];
  let i = 0;
  while (i < data.length) {
    const b = data[i];
    // ESC (0x1B) — pula comando + parâmetros
    if (b === 0x1b) {
      const cmd = data[i + 1];
      if (cmd === 0x40) i += 2;          // init
      else if (cmd === 0x74) i += 3;     // codepage
      else if (cmd === 0x61) i += 3;     // align
      else if (cmd === 0x45) i += 3;     // bold
      else if (cmd === 0x42) i += 4;     // beep
      else i += 2;
      continue;
    }
    // GS (0x1D)
    if (b === 0x1d) {
      const cmd = data[i + 1];
      if (cmd === 0x21) i += 3;          // size
      else if (cmd === 0x56) i += 4;     // cut
      else i += 2;
      continue;
    }
    // LF — nova linha
    if (b === 0x0a) { result.push('\n'); i++; continue; }
    // ASCII imprimível
    if (b >= 0x20 && b <= 0x7e) {
      result.push(String.fromCharCode(b));
    }
    i++;
  }
  return result.join('');
}

/**
 * Abre uma janela popup mostrando o cupom formatado.
 * Permite o usuário ver, copiar, ou imprimir via impressora normal.
 */
export function simulatePrint(data: Uint8Array, paperWidth: '58mm' | '80mm' = '80mm'): void {
  const text = bytesToReadableText(data);
  const widthCh = paperWidth === '58mm' ? 32 : 48;
  const widthPx = paperWidth === '58mm' ? 280 : 380;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Simulação de cupom — ${paperWidth}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    background: #1a1a1a;
    font-family: 'Segoe UI', system-ui, sans-serif;
    color: #fff;
    min-height: 100vh;
  }
  .header {
    max-width: ${widthPx + 80}px; margin: 0 auto 16px;
    text-align: center;
  }
  .header h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
  .header p { margin: 0; font-size: 12px; color: #aaa; }
  .receipt-wrapper {
    max-width: ${widthPx + 80}px; margin: 0 auto;
    background: #fff;
    border-radius: 6px;
    padding: 24px 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  .receipt {
    width: ${widthPx}px;
    margin: 0 auto;
    font-family: 'Courier New', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.4;
    color: #000;
    white-space: pre;
    word-wrap: break-word;
  }
  .actions {
    max-width: ${widthPx + 80}px; margin: 16px auto 0;
    display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
  }
  button {
    background: #3B82F6; color: #fff; border: 0;
    padding: 10px 16px; border-radius: 6px;
    font-size: 13px; font-weight: 500; cursor: pointer;
    font-family: inherit;
  }
  button:hover { opacity: 0.9; }
  button.secondary { background: #374151; }
  .badge {
    display: inline-block;
    background: #10b981; color: #fff;
    padding: 4px 10px; border-radius: 999px;
    font-size: 11px; font-weight: 500;
    margin-left: 8px;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .header, .actions { display: none; }
    .receipt-wrapper { box-shadow: none; padding: 0; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1>🖨️ Simulação de cupom <span class="badge">${paperWidth} · ${widthCh} cols</span></h1>
    <p>Esta é uma prévia de como o cupom sairia na impressora térmica real.</p>
  </div>
  <div class="receipt-wrapper">
    <div class="receipt">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </div>
  <div class="actions">
    <button onclick="window.print()">🖨️ Imprimir nesta janela</button>
    <button class="secondary" onclick="navigator.clipboard.writeText(${JSON.stringify(text)}).then(() => alert('Copiado!'))">📋 Copiar texto</button>
    <button class="secondary" onclick="window.close()">Fechar</button>
  </div>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=520,height=720,scrollbars=yes');
  if (!win) {
    throw new Error('Popup bloqueado pelo navegador. Permita popups deste site para usar o modo simulação.');
  }
  win.document.write(html);
  win.document.close();
}
