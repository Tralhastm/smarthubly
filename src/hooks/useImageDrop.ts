import { useRef, useState } from 'react';

export type DropPayload = { files: File[]; url: string | null };

type UseImageDropOptions = {
  /** Recebe as imagens arrastadas (files) ou, quando não há arquivo, um link direto de mídia. */
  onDropPayload: (payload: DropPayload) => void;
  /** Filtra o que é aceito. Padrão: qualquer arquivo de imagem. */
  accept?: (file: File) => boolean;
  /** Quando false, apenas a primeira imagem do arrasto é aproveitada. */
  multiple?: boolean;
  /** Desativa a captura do arrasto (ex.: limite de mídias atingido). */
  enabled?: boolean;
  /** Chamado quando o arrasto não contém nada aceito. */
  onReject?: () => void;
};

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif|avif|tiff?|ico|jfif)$/i;
const MEDIA_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|jfif|tiff?|ico|mp4|webm|mov|m4v)(\?|#|$)/i;

export const isImageFile = (file: File) =>
  file.type.startsWith('image/') || IMAGE_EXT.test(file.name || '');

const HANDLED = '__imageDropHandled';

const dragTypes = (e: React.DragEvent) => Array.from(e.dataTransfer?.types || []);
const hasFiles = (e: React.DragEvent) => dragTypes(e).includes('Files');
const hasLink = (e: React.DragEvent) =>
  dragTypes(e).includes('text/uri-list') || dragTypes(e).includes('text/plain');

// Zona mais interna resolve o soltar primeiro; o marcador evita que a externa repita a ação.
const alreadyHandled = (e: React.DragEvent) => {
  const native = e.nativeEvent as unknown as Record<string, boolean>;
  if (native && native[HANDLED]) return true;
  if (native) native[HANDLED] = true;
  return false;
};

const readMediaUrl = (e: React.DragEvent): string | null => {
  const dt = e.dataTransfer;
  if (!dt) return null;
  const raw = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim();
  if (!raw) return null;
  const first = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'))[0] || '';
  if (!/^https?:\/\//i.test(first)) return null;
  return MEDIA_EXT.test(first) ? first : null;
};

const collectFiles = (e: React.DragEvent): File[] => {
  const dt = e.dataTransfer;
  if (!dt) return [];
  const out: File[] = [];
  if (dt.files?.length) out.push(...Array.from(dt.files));
  else if (dt.items?.length) {
    Array.from(dt.items).forEach((item) => {
      if (item.kind !== 'file') return;
      const f = item.getAsFile();
      if (f) out.push(f);
    });
  }
  return out.filter(Boolean);
};

/**
 * Captura arquivos arrastados sobre o elemento (imagens, e no campo de galeria também vídeos).
 * Aceita também o link de mídia arrastado de outra aba, quando o navegador não entrega o arquivo.
 * Os eventos continuam subindo para as zonas externas, mantendo a contagem de entrada/saída correta.
 */
export function useImageDrop({
  onDropPayload,
  accept = isImageFile,
  multiple = false,
  enabled = true,
  onReject,
}: UseImageDropOptions) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const payloadRef = useRef(onDropPayload);
  payloadRef.current = onDropPayload;
  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  const rejectRef = useRef(onReject);
  rejectRef.current = onReject;

  return {
    dragging,
    dropProps: {
      onDragEnter: (e: React.DragEvent) => {
        if (!enabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!enabled) return;
        if (!hasFiles(e) && !hasLink(e)) return;
        e.preventDefault();
        try {
          e.dataTransfer.dropEffect = 'copy';
        } catch { /* alguns navegadores não expõem dropEffect */ }
        if (hasFiles(e)) setDragging(true);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!enabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop: (e: React.DragEvent) => {
        if (!enabled) return;
        if (!hasFiles(e) && !hasLink(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (alreadyHandled(e)) return;
        const files = collectFiles(e).filter((f) => acceptRef.current(f));
        if (files.length) {
          payloadRef.current({
            files: multiple ? files : files.slice(0, 1),
            url: null,
            total: files.length,
          });
          return;
        }
        const url = readMediaUrl(e);
        if (url) {
          payloadRef.current({ files: [], url, total: 0 });
          return;
        }
        rejectRef.current?.();
      },
    },
  };
}
export type DropPayload = {
  /** Arquivos aceitos que devem ser usados (já limitados quando multiple=false). */
  files: File[];
  /** Link de mídia, quando o arrasto trouxe só a URL. */
  url: string | null;
  /** Total de imagens recebidas no arrasto, para avisar quando sobrar alguma. */
  total: number;
};
