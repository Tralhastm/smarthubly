// Converte File em payload pronto pro edge function scan-invoice.
// - .xml → texto bruto (parse nativo na função, 100% preciso)
// - imagem → data URL
// - PDF → renderiza página 1 em canvas (JPEG)

export type ScanPayload =
  | { xml: string; source_filename: string }
  | { image_base64: string; mime_type: string; source_filename: string };

export async function fileToScanPayload(file: File): Promise<ScanPayload> {
  const name = file.name || 'arquivo';

  if (file.type === 'text/xml' || file.type === 'application/xml' || name.toLowerCase().endsWith('.xml')) {
    const xml = await file.text();
    return { xml, source_filename: name };
  }

  if (file.type.startsWith('image/')) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    return { image_base64: dataUrl, mime_type: file.type, source_filename: name };
  }

  if (file.type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
    const pdfjs: any = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    return { image_base64: dataUrl, mime_type: 'application/pdf', source_filename: name };
  }

  throw new Error('Formato não suportado. Envie XML, PDF ou imagem.');
}
