import { useState, useEffect } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface StructuredAddressInputProps {
  value: string;
  onChange: (composedAddress: string) => void;
  onCalculated: (distanceKm: number, deliveryFee: number) => void;
  onError: (error: string) => void;
  tenantAddress: string;
}

const STORAGE_KEY = 'lastStructuredAddress';

const StructuredAddressInput = ({ onChange, onCalculated, onError, tenantAddress }: StructuredAddressInputProps) => {
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [complement, setComplement] = useState('');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ distance: number; fee: number } | null>(null);

  // Load last used address
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const a = JSON.parse(saved);
        setStreet(a.street || '');
        setNumber(a.number || '');
        setNeighborhood(a.neighborhood || '');
        setCity(a.city || '');
        setComplement(a.complement || '');
        setReference(a.reference || '');
      }
    } catch { /* ignore */ }
  }, []);

  // Compose and propagate
  useEffect(() => {
    const parts = [
      street && number ? `${street}, ${number}` : street,
      complement,
      neighborhood,
      city,
      reference ? `Ref: ${reference}` : '',
    ].filter(Boolean);
    onChange(parts.join(' - '));
    setResult(null);
  }, [street, number, neighborhood, city, complement, reference, onChange]);

  const isValid = street.trim().length >= 2 && number.trim().length >= 1 && neighborhood.trim().length >= 2 && city.trim().length >= 2;

  const handleCalculate = async () => {
    if (!isValid) {
      onError('Preencha pelo menos Rua, Número, Bairro e Cidade.');
      return;
    }
    const composed = [`${street}, ${number}`, neighborhood, city].filter(Boolean).join(' - ');
    setLoading(true);
    setResult(null);
    onError('');
    try {
      const { data, error } = await supabase.functions.invoke('calculate-distance', {
        body: { address: composed, origin: tenantAddress },
      });
      if (error) throw error;
      if (data.error) {
        onError(data.error);
      } else {
        setResult({ distance: data.distance_km, fee: data.delivery_fee });
        onCalculated(data.distance_km, data.delivery_fee);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ street, number, neighborhood, city, complement, reference }));
        } catch { /* ignore */ }
      }
    } catch {
      onError('Erro ao calcular distância.');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-border bg-secondary px-3 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">Rua / Avenida *</label>
          <input value={street} onChange={e => setStreet(e.target.value)} className={inputCls} placeholder="Ex: Rua das Flores" autoComplete="address-line1" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Número *</label>
          <input value={number} onChange={e => setNumber(e.target.value)} className={inputCls} placeholder="123" autoComplete="address-line2" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Bairro *</label>
          <input value={neighborhood} onChange={e => setNeighborhood(e.target.value)} className={inputCls} placeholder="Centro" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Cidade *</label>
          <input value={city} onChange={e => setCity(e.target.value)} className={inputCls} placeholder="Belo Horizonte" autoComplete="address-level2" />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground">Complemento</label>
        <input value={complement} onChange={e => setComplement(e.target.value)} className={inputCls} placeholder="Apto 201, bloco B, casa dos fundos..." />
      </div>

      <div>
        <label className="text-xs text-muted-foreground">Ponto de referência / Observações</label>
        <input value={reference} onChange={e => setReference(e.target.value)} className={inputCls} placeholder="Próximo ao posto, portão azul, deixar com vizinho..." />
      </div>

      <button
        onClick={handleCalculate}
        disabled={loading || !isValid}
        className="w-full px-4 py-2.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><MapPin className="h-4 w-4" /> Calcular taxa de entrega</>}
      </button>

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
    </div>
  );
};

export default StructuredAddressInput;
