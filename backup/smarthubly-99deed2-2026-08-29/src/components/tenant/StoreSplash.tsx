import { useState, useEffect } from 'react';
import { Store } from 'lucide-react';

const StoreSplash = ({ logoUrl, name, bgColor, onDone }: {
  logoUrl?: string | null;
  name: string;
  bgColor?: string;
  onDone: () => void;
}) => {
  const [fade, setFade] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setFade(true), 1500);
    const t2 = setTimeout(onDone, 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-700 ${fade ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      style={{ backgroundColor: bgColor || 'hsl(var(--background))' }}
    >
      <div className="flex flex-col items-center gap-5 animate-scale-in px-6">
        {logoUrl ? (
          <div className="w-28 h-28 rounded-full overflow-hidden ring-4 ring-white/20 shadow-2xl bg-white/5 flex items-center justify-center">
            <img
              src={logoUrl}
              alt={name}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="w-24 h-24 rounded-full gradient-primary flex items-center justify-center shadow-2xl">
            <Store className="h-12 w-12 text-primary-foreground" />
          </div>
        )}
        <h1 className="font-heading text-xl text-white drop-shadow-lg text-center">{name}</h1>
      </div>
    </div>
  );
};

export default StoreSplash;
