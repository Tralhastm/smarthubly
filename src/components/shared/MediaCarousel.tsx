import { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';

export type MediaItem = { type: 'image' | 'video'; url: string };

type Props = {
  items: MediaItem[];
  className?: string;
  /** classes do contêiner de cada slide (altura/largura) */
  slideClassName?: string;
  /** classes da tag <img> */
  imgClassName?: string;
  /** classes da tag <video> */
  videoClassName?: string;
  autoPlayVideo?: boolean;
};

/**
 * Carrossel de mídias (fotos + vídeos) com swipe por toque, setas e dots.
 * Vídeos tocam automaticamente (muted/loop) quando entram no slide ativo.
 */
const MediaCarousel = ({
  items,
  className = '',
  slideClassName = 'h-full w-full',
  imgClassName = 'h-full w-full object-cover',
  videoClassName = 'h-full w-full object-cover',
  autoPlayVideo = true,
}: Props) => {
  const [index, setIndex] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const n = items.length;
  if (n === 0) return null;

  const go = (next: number) => setIndex(((next % n) + n) % n);

  const current = items[index];

  return (
    <div
      className={`relative select-none ${className}`}
      onTouchStart={(e) => { touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchEnd={(e) => {
        if (!touchStart.current) return;
        const dx = e.changedTouches[0].clientX - touchStart.current.x;
        const dy = e.changedTouches[0].clientY - touchStart.current.y;
        touchStart.current = null;
        if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1));
      }}
    >
      {current.type === 'video' ? (
        <video
          key={current.url}
          src={current.url}
          muted
          loop
          playsInline
          autoPlay={autoPlayVideo}
          className={videoClassName}
        />
      ) : (
        <img
          key={current.url}
          src={current.url}
          alt=""
          className={imgClassName}
          loading="lazy"
          decoding="async"
        />
      )}

      {n > 1 && (
        <>
          {/* Dots */}
          <div className="absolute bottom-1.5 inset-x-0 flex items-center justify-center gap-1 pointer-events-none">
            {items.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/60'}`}
                style={{ boxShadow: '0 1px 2px rgba(0,0,0,.35)' }}
              />
            ))}
          </div>

          {/* Setas (desktop) */}
          <button
            type="button"
            aria-label="Foto anterior"
            onClick={(e) => { e.stopPropagation(); go(index - 1); }}
            className="hidden sm:flex absolute left-1 top-1/2 -translate-y-1/2 items-center justify-center h-6 w-6 rounded-full bg-black/45 text-white hover:bg-black/65">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Próxima foto"
            onClick={(e) => { e.stopPropagation(); go(index + 1); }}
            className="hidden sm:flex absolute right-1 top-1/2 -translate-y-1/2 items-center justify-center h-6 w-6 rounded-full bg-black/45 text-white hover:bg-black/65">
            <ChevronRight className="h-4 w-4" />
          </button>

          {/* Badge de vídeo */}
          {current.type === 'video' && (
            <span className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1.5 text-white">
              <Play className="h-3.5 w-3.5" />
            </span>
          )}
        </>
      )}
    </div>
  );
};

export default MediaCarousel;
