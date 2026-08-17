import { useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface AddressInputProps {
  value: string;
  onChange: (address: string) => void;
  onCalculated: (distanceKm: number, deliveryFee: number) => void;
  onError: (error: string) => void;
  tenantAddress: string;
  placeholder?: string;
}

const AddressAutocomplete = ({ value, onChange, onCalculated, onError, tenantAddress, placeholder }: AddressInputProps) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ distance: number; fee: number } | null>(null);

  const handleCalculate = async () => {
    if (value.trim().length < 3) {
      onError('Digite um endereço válido.');
      return;
    }
    setLoading(true);
    setResult(null);
    onError('');
    try {
      const { data, error } = await supabase.functions.invoke('calculate-distance', {
        body: { address: value, origin: tenantAddress },
      });
      if (error) throw error;
      if (data.error) {
        onError(data.error);
      } else {
        setResult({ distance: data.distance_km, fee: data.delivery_fee });
        onCalculated(data.distance_km, data.delivery_fee);
      }
    } catch {
      onError('Erro ao calcular distância.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={value}
            onChange={e => { onChange(e.target.value); setResult(null); }}
            className="w-full rounded-lg border border-border bg-secondary pl-9 pr-3 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder={placeholder || 'Rua, número, bairro'}
          />
        </div>
        <button
          onClick={handleCalculate}
          disabled={loading || value.trim().length < 3}
          className="px-4 py-2.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Calcular'}
        </button>
      </div>

      {result && (
        <div className="p-3 rounded-lg bg-secondary border border-border">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Distância:</span>
            <span className="text-foreground font-medium">{result.distance} km</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-muted-foreground">Taxa de entrega:</span>
            <span className="text-primary font-bold">R${result.fee.toFixed(2)}</span>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Ex: Jovina Gomes 1022 Letícia
      </p>
    </div>
  );
};

export default AddressAutocomplete;
