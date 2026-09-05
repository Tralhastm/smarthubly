// Controle (pelo Super Admin) de quais SUB-ABAS de cada aba do painel do lojista
// aparecem, e como se chamam. A config vive no mesmo JSON `tenants.admin_tabs_config`,
// usando a chave composta `"<aba>.<subaba>"`.
import { createContext, useContext } from 'react';

export type TabsConfigMap = Record<string, { hidden?: boolean; label?: string }>;

// Registro mestre das sub-abas conhecidas (usado pelo editor do Super Admin
// e pelos componentes que renderizam as sub-abas).
export const ADMIN_SUBTABS: Record<string, { id: string; label: string }[]> = {
  financial: [
    { id: 'overview', label: '🏥 Saúde' },
    { id: 'clara', label: '🤖 Clara' },
    { id: 'cashflow', label: '📊 Fluxo' },
    { id: 'entries', label: '💸 Lançar' },
    { id: 'card', label: '💳 Cartão' },
    { id: 'debts', label: '💰 A Pagar / Receber' },
    { id: 'suppliers', label: '🏭 Fornec.' },
    { id: 'calculator', label: '🧮 Calculadora' },
    { id: 'fee_config', label: '⚙️ Taxa' },
  ],
  'finance-deep': [
    { id: 'acquirer', label: 'Adquirente' },
    { id: 'apr', label: 'Contas' },
    { id: 'cashflow', label: 'Fluxo Projetado' },
    { id: 'dre', label: 'DRE Comparativo' },
  ],
  reports: [
    { id: 'hours', label: 'Horários' },
    { id: 'dow', label: 'Dia' },
    { id: 'mix', label: 'Mix' },
    { id: 'waiters', label: 'Garçons' },
  ],
  stock: [
    { id: 'movimentar', label: 'Movimentar' },
    { id: 'inventario', label: 'Inventário' },
    { id: 'baixa', label: 'Em baixa' },
    { id: 'historico', label: 'Histórico' },
    { id: 'perdas', label: 'Perdas' },
  ],
  ficha: [
    { id: 'ingredients', label: 'Ingredientes' },
    { id: 'recipes', label: 'Receitas (CMV por produto)' },
    { id: 'dre', label: 'DRE' },
  ],
  fiscal: [
    { id: 'queue', label: 'Fila Offline' },
    { id: 'cancel', label: 'Cancelamentos' },
    { id: 'invalidate', label: 'Inutilização' },
    { id: 'sat', label: 'SAT (SP)' },
  ],
  support: [
    { id: 'support', label: 'Suporte' },
    { id: 'training', label: 'Treinamento' },
  ],
  emails: [
    { id: 'config', label: 'Configurações' },
    { id: 'campaigns', label: 'Campanhas' },
  ],
};

export const subTabKey = (tabId: string, subId: string) => `${tabId}.${subId}`;

// Contexto: o TenantAdmin injeta a config do tenant; fora dele (PDV, garçom...)
// tudo fica visível por padrão.
const AdminTabsConfigContext = createContext<TabsConfigMap>({});

export const AdminTabsConfigProvider = AdminTabsConfigContext.Provider;

export const useAdminTabsConfig = () => useContext(AdminTabsConfigContext);

/**
 * Filtra e renomeia as sub-abas de uma aba.
 * Mantém pelo menos uma sub-aba visível (se tudo for escondido, devolve a lista original).
 */
export function useSubTabs<T extends { id: string; label: string }>(tabId: string, defs: T[]): T[] {
  const cfg = useAdminTabsConfig();
  const filtered = defs
    .filter(d => !cfg[subTabKey(tabId, d.id)]?.hidden)
    .map(d => {
      const custom = cfg[subTabKey(tabId, d.id)]?.label;
      return custom ? ({ ...d, label: custom } as T) : d;
    });
  return filtered;
}
