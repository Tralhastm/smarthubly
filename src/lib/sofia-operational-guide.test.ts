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

  it('orienta visitante iniciante pelo fluxo público real, sem fingir que já tem acesso ao painel', () => {
    const guide = getSofiaOperationalGuidance(
      'Sou iniciante e ainda não tenho uma loja. Me explica o caminho mais simples para começar, passo a passo?',
      'visitor',
    );

    expect(guide).toContain('Quero criar minha loja');
    expect(guide).toContain('WhatsApp oficial (+55 11 91287-0761)');
    expect(guide).toContain('não diga “crie sua conta no site”');
    expect(guide).toContain('5% por venda ou plano fixo de R$ 60/mês');
    expect(guide).toContain('nunca invente exemplos');
    expect(guide).toContain('Não precisa preparar fotos, catálogo, lista de preços nem configurar pagamentos antes de ter acesso');
    expect(guide).toContain('Não transforme ideias como fotos, catálogo, preços ou pagamentos em pré-requisitos');
    expect(guide).not.toContain('Configurações → Aparência');
    expect(guide).not.toContain('Asaas');
  });

  it('não sugere enviar WhatsApp ou campanha diretamente pelo chat', () => {
    const guide = getSofiaOperationalGuidance('Como faço um post e envio WhatsApp para clientes?');

    expect(guide).toContain('não prometa que a mensagem será enviada automaticamente');
    expect(guide).toContain('Enviar agora para todos clientes');
    expect(guide).toContain('A Sofia não envia a campanha pelo chat');
  });

  it('inclui regras de dados atuais, resolução com evidência e feedback supervisionado', () => {
    const productGuide = getSofiaOperationalGuidance('Como vejo o preço atual do produto com variantes?');
    const troubleshootingGuide = getSofiaOperationalGuidance('Deu erro e não consigo concluir o pedido; como resolver?');
    const learningGuide = getSofiaOperationalGuidance('Como a Sofia aprende com meu feedback?');

    expect(productGuide).toContain('catálogo atual');
    expect(productGuide).toContain('preço-base + ajuste');
    expect(troubleshootingGuide).toContain('Resolver problemas com evidência');
    expect(learningGuide).toContain('não treinamento automático');
  });

  it('orienta a importação em massa do painel do fornecedor e não inventa aplicação pelo chat', () => {
    const guide = getSofiaOperationalGuidance('Mas e para atualizar em massa, tipo só envio a lista e o sistema atualiza?');

    expect(guide).toContain('painel separado do fornecedor');
    expect(guide).toContain('Catálogo → Importar / Exportar');
    expect(guide).toContain('clicar em Atualizar preços');
    expect(guide).toContain('A tela aceita a lista original');
    expect(guide).toContain('Não afirme que toda lista precisa ser reformatada para um único padrão');
    expect(guide).toContain('aparecem em Não encontrados e são ignorados');
    expect(guide).toContain('nenhum produto novo é criado');
    expect(guide).toContain('não altera o preço de revenda da loja');
    expect(guide).toContain('snapshot completo das ofertas deste fornecedor');
    expect(guide).toContain('Não recomende colar a lista no chat da Sofia');
  });

  it('retorna uma orientação segura para pergunta sem tópico reconhecido', () => {
    const guide = getSofiaOperationalGuidance('Pode me ajudar?');

    expect(guide).toContain('pergunte se é lojista, fornecedor, motoboy ou cliente');
    expect(guide).toContain('peça uma captura de tela');
  });
});
