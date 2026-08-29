import { useState, useEffect } from 'react';
import { Loader2, Search } from 'lucide-react';

interface CepAddressFormProps {
  /** Endereço inicial (texto livre). Se preenchido, ignorado — começa vazio para o usuário digitar o CEP. */
  initialAddress?: string;
  /** Callback chamado sempre que o endereço composto muda. */
  onChange: (composedAddress: string) => void;
  /** Mostra ponto de referência? Padrão false (uso administrativo, não checkout). */
  showReference?: boolean;
  /** Mostra complemento? Padrão true. */
  showComplement?: boolean;
}

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

/**
 * Formulário de endereço com lookup automático por CEP (ViaCEP).
 * Reutilizado no checkout do cliente e no painel do fornecedor.
 */
const CepAddressForm = ({ initialAddress, onChange, showReference = false, showComplement = true }: CepAddressFormProps) => {
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
  const [showInitial, setShowInitial] = useState(!!initialAddress);

  // Compose address whenever parts change.
  useEffect(() => {
    if (showInitial) return;
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
  }, [street, number, neighborhood, city, uf, cep, complement, reference, showInitial]);

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
    setShowInitial(false);
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

  const inputCls = "w-full rounded-lg border border-border bg-secondary px-3 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50";
  const inputDisabledCls = inputCls + " opacity-70";

  return (
    <div className="space-y-2">
      {showInitial && initialAddress && (
        <div className="rounded-lg border border-border bg-secondary p-3 text-xs text-foreground">
          <p className="text-muted-foreground mb-1">Endereço atual:</p>
          <p className="text-foreground">{initialAddress}</p>
          <p className="text-xs text-muted-foreground mt-2">Digite um CEP abaixo para alterar.</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">CEP</label>
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
          <label className="text-xs text-muted-foreground">Número</label>
          <input
            value={number}
            onChange={e => { setShowInitial(false); setNumber(e.target.value); }}
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

          {showComplement && (
            <div>
              <label className="text-xs text-muted-foreground">Complemento</label>
              <input value={complement} onChange={e => setComplement(e.target.value)} className={inputCls} placeholder="Apto 201, bloco B..." />
            </div>
          )}

          {showReference && (
            <div>
              <label className="text-xs text-muted-foreground">Ponto de referência</label>
              <input value={reference} onChange={e => setReference(e.target.value)} className={inputCls} placeholder="Próximo ao posto, portão azul..." />
            </div>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        💡 Digite o CEP que o endereço aparece automaticamente. Não sabe seu CEP? <a href="https://buscacepinter.correios.com.br/app/endereco/index.php" target="_blank" rel="noopener noreferrer" className="text-primary underline">Buscar nos Correios</a>
      </p>
    </div>
  );
};

export default CepAddressForm;
