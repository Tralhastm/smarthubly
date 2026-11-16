import { ImagePlus } from 'lucide-react';

const DropOverlay = ({ show, text }: { show: boolean; text?: string }) => {
  if (!show) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/15 p-2"
    >
      <span className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-lg">
        <ImagePlus className="h-3.5 w-3.5 text-primary" />
        {text || 'Solte a imagem aqui'}
      </span>
    </div>
  );
};

export default DropOverlay;
