import { describe, expect, it } from 'vitest';
import { getSofiaOperationalGuidance } from '../../supabase/functions/_shared/sofia_operational_guide';

describe('guia operacional da Sofia', () => {
  it('entrega caminho financeiro correto e separa lucro de saldo bancário', () => {
    const guide = getSofiaOperationalGuidance('Como lanço uma despesa e vejo o DRE?');

    expect(guide).toContain('Financeiro → Empresarial');
    expect(guide).toContain('Financeiro → Financeiro Avançado → DRE Comparativo');
    expect(guide).toContain('não significa que o dinheiro já saiu da conta');
    expect(guide).not.toContain('Financeiro → Nova Despesa');
    expect(guide).not.toContain('Relatórios → DRE');
  });

  it('usa instruções específicas para cozinha e mesas', () => {
    const guide = getSofiaOperationalGuidance('Como abro o KDS e configuro as mesas?');

    expect(guide).toContain('clique em Cozinha no cabeçalho');
    expect(guide).toContain('Operação → Mesas (Garçom)');
    expect(guide).toContain('Iniciar preparo');
  });

  it('mostra manual abrangente para pedidos de treinamento geral', () => {
    const beginnerGuide = getSofiaOperationalGuidance('Sou iniciante; me ensine tudo sobre o sistema inteiro.');
    const naturalRequest = getSofiaOperationalGuidance('Me ensina a usar a plataforma do zero.');

    for (const guide of [beginnerGuide, naturalRequest]) {
      expect(guide).toContain('## Roteiro de primeiro dia');
      expect(guide).toContain('## Financeiro geral');
      expect(guide).toContain('## Marketing');
      expect(guide).toContain('## Configurações e acessos');
      expect(guide).toContain('## Fornecedor');
      expect(guide).toContain('## Motoboy');
      expect(guide).toContain('não invente um botão equivalente');
    }
  });

  it('não sugere enviar WhatsApp ou campanha diretamente pelo chat', () => {
    const guide = getSofiaOperationalGuidance('Como faço um post e envio WhatsApp para clientes?');

    expect(guide).toContain('não prometa que a mensagem será enviada automaticamente');
    expect(guide).toContain('Enviar agora para todos clientes');
    expect(guide).toContain('A Sofia não envia a campanha pelo chat');
  });

  it('retorna uma orientação segura para pergunta sem tópico reconhecido', () => {
    const guide = getSofiaOperationalGuidance('Pode me ajudar?');

    expect(guide).toContain('pergunte se é lojista, fornecedor, motoboy ou cliente');
    expect(guide).toContain('peça uma captura de tela');
  });
});
