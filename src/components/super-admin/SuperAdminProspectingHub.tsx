// Wrapper de Prospecção: sub-abas Mapa (rua a rua) e Site (vendedor IA pra WhatsApp).
import { useState } from 'react';
import { MapPin, Bot } from 'lucide-react';
import SuperAdminProspecting from './SuperAdminProspecting';
import SuperAdminSiteSeller from './SuperAdminSiteSeller';

type SubTab = 'map' | 'site';

const SuperAdminProspectingHub = () => {
  const [sub, setSub] = useState<SubTab>('map');
  const subs: { id: SubTab; label: string; icon: JSX.Element }[] = [
    { id: 'map', label: 'Mapa / Rua', icon: <MapPin className="h-4 w-4" /> },
    { id: 'site', label: 'Site (Vendedor IA)', icon: <Bot className="h-4 w-4" /> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        {subs.map(s => (
          <button key={s.id} onClick={() => setSub(s.id)}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              sub === s.id ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}>
            {s.icon} {s.label}
          </button>
        ))}
      </div>
      <div className="animate-fade-in" key={sub}>
        {sub === 'map' && <SuperAdminProspecting />}
        {sub === 'site' && <SuperAdminSiteSeller />}
      </div>
    </div>
  );
};

export default SuperAdminProspectingHub;
