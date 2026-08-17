import { useState, useEffect } from 'react';
import { MapPin, Loader2, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface CepAddressInputProps {
  value: string;
  onChange: (composedAddress: string) => void;
  onCalculated: (distanceKm: number, deliveryFee: number, composedAddress: string) => void;
  onError: (error: string) => void;
  tenantAddress: string;
  /** Override da taxa exibida (ex.: cotação Lalamove em tempo real). Quando definido, substitui o valor calculado pela tabela interna. */
  displayFeeOverride?: number | null;
  displayFeeLabel?: string;
  /** Override da distância exibida (ex.: distância do fornecedor mais distante quando há dropshipping). */
  displayDistanceOverride?: number | null;
}

const STORAGE_KEY = 'lastCepAddress';

interface ViaCepResponse {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

const formatCep = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

const CepAddressInput = ({ onChange, onCalculated, onError, tenantAddress, displayFeeOverride, displayFeeLabel, displayDistanceOverride }: CepAddressInputProps) => {
  const [cep, setCep] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [reference, setReference] = useState('');
  const [street, setStreet] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [uf, setUf] = useState('');
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState('');
  const [cepFound, setCepFound] = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);
  const [result, setResult] = useState<{ distance: number; fee: number } | null>(null);

  // Load last used
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const a = JSON.parse(saved);
        setCep(a.cep || '');
        setNumber(a.number || '');
        setComplement(a.complement || '');
        setReference(a.reference || '');
        setStreet(a.street || '');
        setNeighborhood(a.neighborhood || '');
        setCity(a.city || '');
        setUf(a.uf || '');
        if (a.street) setCepFound(true);
      }
    } catch { /* ignore */ }
  }, []);

  // Compose address whenever parts change. Note: onChange is intentionally
  // omitted from deps to avoid loops when parent passes inline arrows.
  useEffect(() => {
    const parts = [
      street && number ? `${street}, ${number}` : street,
      complement,
      neighborhood,
      city && uf ? `${city} - ${uf}` : city,
      cep ? `CEP ${cep}` : '',
      reference ? `Ref: ${reference}` : '',
    ].filter(Boolean);
    onChange(parts.join(' - '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [street, number, neighborhood, city, uf, cep, complement, reference]);

  // Reset result only when address parts that affect distance actually change.
  // IMPORTANTE: complement e reference NÃO entram aqui — assim o cliente pode
  // digitar a referência DEPOIS de calcular a taxa, sem perder o cálculo.
  // O onChange do useEffect acima já propaga a referência atualizada pro pai.
  useEffect(() => {
    setResult(null);
  }, [street, number, neighborhood, city, uf, cep]);

  const lookupCep = async (cepValue: string) => {
    const digits = cepValue.replace(/\D/g, '');
    if (digits.length !== 8) {
      setCepError('CEP deve ter 8 dígitos.');
      setCepFound(false);
      return;
    }
    setCepLoading(true);
    setCepError('');
    setCepFound(false);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data: ViaCepResponse = await res.json();
      if (data.erro) {
        setCepError('CEP não encontrado.');
        return;
      }
      setStreet(data.logradouro || '');
      setNeighborhood(data.bairro || '');
      setCity(data.localidade || '');
      setUf(data.uf || '');
      setCepFound(true);
    } catch {
      setCepError('Erro ao buscar CEP. Verifique sua conexão.');
    } finally {
      setCepLoading(false);
    }
  };

  const handleCepChange = (raw: string) => {
    const formatted = formatCep(raw);
    setCep(formatted);
    setCepError('');
    if (formatted.replace(/\D/g, '').length === 8) {
      lookupCep(formatted);
    } else {
      setCepFound(false);
      setStreet('');
      setNeighborhood('');
      setCity('');
      setUf('');
    }
  };

  const isValid = cepFound && number.trim().length >= 1 && street.trim().length >= 2;

  const handleCalculate = async () => {
    if (!isValid) {
      onError('Preencha o CEP válido e o número.');
      return;
    }
    const composed = [
      `${street}, ${number}`,
      complement,
      neighborhood,
      `${city} - ${uf}`,
      `CEP ${cep}`,
      reference ? `Ref: ${reference}` : '',
    ].filter(Boolean).join(' - ');
    setCalcLoading(true);
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
        onCalculated(data.distance_km, data.delivery_fee, composed);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ cep, number, complement, reference, street, neighborhood, city, uf }));
        } catch { /* ignore */ }
      }
    } catch {
      onError('Erro ao calcular distância.');
    } finally {
      setCalcLoading(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-border bg-secondary px-3 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50";
  const inputDisabledCls = inputCls + " opacity-70";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">CEP *</label>
          <div className="relative">
            <input
              value={cep}
              onChange={e => handleCepChange(e.target.value)}
              className={inputCls + ' pr-9'}
              placeholder="00000-000"
              inputMode="numeric"
              autoComplete="postal-code"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              {cepLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </div>
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Número *</label>
          <input
            value={number}
            onChange={e => setNumber(e.target.value)}
            className={inputCls}
            placeholder="123"
            inputMode="numeric"
          />
        </div>
      </div>

      {cepError && <p className="text-xs text-destructive">{cepError}</p>}

      {cepFound && (
        <>
          <div>
            <label className="text-xs text-muted-foreground">Rua</label>
            <input value={street} onChange={e => setStreet(e.target.value)} className={street ? inputDisabledCls : inputCls} placeholder="Rua" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Bairro</label>
              <input value={neighborhood} onChange={e => setNeighborhood(e.target.value)} className={inputDisabledCls} placeholder="Bairro" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Cidade / UF</label>
              <input value={`${city}${uf ? ' - ' + uf : ''}`} readOnly className={inputDisabledCls} />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Complemento</label>
            <input value={complement} onChange={e => setComplement(e.target.value)} className={inputCls} placeholder="Apto 201, bloco B..." />
          </div>
        </>
      )}

      {/* Ponto de referência — SEMPRE visível, fora do cepFound, pra garantir que o cliente nunca esqueça. */}
      <div className="rounded-lg border-2 border-amber-500/50 bg-amber-500/10 p-3">
        <label className="text-sm font-bold text-amber-400 flex items-center gap-1">
          📍 Ponto de referência <span className="text-[10px] font-normal text-amber-400/70">(super importante p/ o motoboy)</span>
        </label>
        <input
          value={reference}
          onChange={e => setReference(e.target.value)}
          className={inputCls + ' mt-1.5'}
          placeholder="Próximo ao posto, portão azul, casa amarela..."
        />
      </div>

      <button
        onClick={handleCalculate}
        disabled={calcLoading || !isValid}
        className="w-full px-4 py-2.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5"
      >
        {calcLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><MapPin className="h-4 w-4" /> Calcular taxa de entrega</>}
      </button>

      {result && (
        <div className="p-3 rounded-lg bg-secondary border border-border">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Distância:</span>
            <span className="text-foreground font-medium">
              {(typeof displayDistanceOverride === 'number' && displayDistanceOverride > 0
                ? displayDistanceOverride
                : result.distance
              ).toFixed(1)} km
            </span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-muted-foreground">{displayFeeLabel || 'Taxa de entrega:'}</span>
            <span className="text-primary font-bold">
              R${(typeof displayFeeOverride === 'number' ? displayFeeOverride : result.fee).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        💡 Digite o CEP que o endereço aparece automaticamente. Não sabe seu CEP? <a href="https://buscacepinter.correios.com.br/app/endereco/index.php" target="_blank" rel="noopener noreferrer" className="text-primary underline">Buscar nos Correios</a>
      </p>
    </div>
  );
};

export default CepAddressInput;
