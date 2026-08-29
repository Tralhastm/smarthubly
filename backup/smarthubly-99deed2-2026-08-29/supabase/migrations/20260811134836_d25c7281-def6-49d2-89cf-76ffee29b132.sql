UPDATE public.tenants SET storefront_config = storefront_config || jsonb_build_object(
  'hero_kicker','',
  'hero_title','Qualidade que você confia,',
  'hero_highlight','sabor que sua família merece!',
  'hero_subtitle', E'Trabalhamos com os melhores produtos lácteos\npara levar mais sabor, saúde e confiança até você.',
  'products_title','Catálogo de Produtos',
  'products_subtitle','Confira nossa linha completa de laticínios selecionados para você.',
  'products_cta','Ver todos os produtos',
  'about_title','Sobre a LJ Distribuidora',
  'partner_title','Atendimento Comercial',
  'order_title','Faça seu Pedido',
  'order_text','Monte seu carrinho e finalize direto no WhatsApp com nosso time.',
  'topbar_cta','Peça pelo WhatsApp',
  'contact_city','Belo Horizonte - MG',
  'badges', jsonb_build_array(
    jsonb_build_object('icon','shield','title','Qualidade Garantida','desc','Produtos selecionados com rigor e segurança'),
    jsonb_build_object('icon','factory','title','Produção Controlada','desc','Processos padronizados e monitorados'),
    jsonb_build_object('icon','leaf','title','Sabor que Aproxima','desc','Produtos que unem tradição e qualidade'),
    jsonb_build_object('icon','truck','title','Entrega Rápida','desc','Atendimento ágil e entregas eficientes')
  )
) WHERE slug = 'lj-distribuidora-de-laticinio';