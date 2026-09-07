import { useEffect, useState } from 'react';
import { Save, UserRound, MapPin, Phone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type SupplierProfile = {
  id: string;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  responsible_for_delivery?: boolean | string | null;
};

type Props = { supplier: SupplierProfile; onSaved?: (changes: Partial<SupplierProfile>) => void };

const inputClass = 'w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none';

const SupplierProfileSettings = ({ supplier, onSaved }: Props) => {
  const [name, setName] = useState(supplier.name || '');
  const [address, setAddress] = useState(supplier.address || '');
  const [phone, setPhone] = useState(supplier.phone || '');
  const [responsible, setResponsible] = useState(supplier.responsible_for_delivery === true || supplier.responsible_for_delivery === 'true');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(supplier.name || '');
    setAddress(supplier.address || '');
    setPhone(supplier.phone || '');
    setResponsible(supplier.responsible_for_delivery === true || supplier.responsible_for_delivery === 'true');
  }, [supplier]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error('Informe o nome do fornecedor.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('suppliers').update({
      name: name.trim(),
      address: address.trim(),
      phone: phone.trim(),
      responsible_for_delivery: responsible,
    } as any).eq('id', supplier.id);
    setSaving(false);
    if (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
      return;
    }
    onSaved?.({ name: name.trim(), address: address.trim(), phone: phone.trim(), responsible_for_delivery: responsible });
    toast.success('Dados do fornecedor atualizados.');
  };

  return (
    <form onSubmit={save} className="mx-auto max-w-2xl space-y-5 rounded-xl border border-border bg-card p-4 sm:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground"><UserRound className="h-5 w-5 text-primary" /> Dados do fornecedor</h2>
        <p className="mt-1 text-sm text-muted-foreground">Atualize o nome, endereço de origem e contato exibidos para a loja.</p>
      </div>
      <label className="block space-y-1.5">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground"><UserRound className="h-4 w-4 text-muted-foreground" /> Nome</span>
        <input value={name} onChange={e => setName(e.target.value)} className={inputClass} placeholder="Nome do fornecedor" />
      </label>
      <label className="block space-y-1.5">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground"><MapPin className="h-4 w-4 text-muted-foreground" /> Endereço de origem</span>
        <textarea value={address} onChange={e => setAddress(e.target.value)} className={`${inputClass} min-h-24 resize-y`} placeholder="Rua, número, bairro, cidade, CEP" />
        <span className="text-xs text-muted-foreground">Usado como origem para cálculo de distância e frete.</span>
      </label>
      <label className="block space-y-1.5">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground"><Phone className="h-4 w-4 text-muted-foreground" /> Telefone / WhatsApp</span>
        <input value={phone} onChange={e => setPhone(e.target.value)} className={inputClass} placeholder="(31) 99999-9999" inputMode="tel" />
      </label>
      <label className="flex items-start gap-3 rounded-lg border border-border bg-secondary/40 p-3 text-sm text-foreground">
        <input type="checkbox" checked={responsible} onChange={e => setResponsible(e.target.checked)} className="mt-0.5 rounded border-border" />
        <span><strong>Responsável pela entrega</strong><br /><span className="text-xs text-muted-foreground">O endereço deste fornecedor pode ser usado como base das entregas.</span></span>
      </label>
      <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg gradient-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
        <Save className="h-4 w-4" /> {saving ? 'Salvando...' : 'Salvar dados'}
      </button>
    </form>
  );
};

export default SupplierProfileSettings;

// Keep this module self-contained and compatible with the generated Supabase types.
const _supplierProfileSettingsVersion = '1';
void _supplierProfileSettingsVersion;
