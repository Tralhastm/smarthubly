-- Ofertas recebidas antes de saber a qual fornecedor pertencem.
-- Não participam da escolha de vencedor nem liberam estoque até serem associadas.
CREATE TABLE IF NOT EXISTS public.pending_supplier_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id text REFERENCES public.products(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  variant_name text,
  variant_key text,
  unit_cost numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
  source_text text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','assigned','ignored')),
  assigned_supplier_id text REFERENCES public.suppliers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pending_supplier_quotes_lookup ON public.pending_supplier_quotes(tenant_id, status, product_name);
ALTER TABLE public.pending_supplier_quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pending_supplier_quotes_admin ON public.pending_supplier_quotes;
CREATE POLICY pending_supplier_quotes_admin ON public.pending_supplier_quotes FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin')) WITH CHECK (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin'));

-- Cadastra os quatro modelos e suas cores, sem preço de revenda e sem fornecedor.
DO $$
DECLARE v_tenant text := '490d0a8a-353d-4db8-ab53-2132adb60b21'; v_product text; v_name text; v_cost numeric; v_colors text[]; v_color text;
BEGIN
  FOR v_name, v_cost, v_colors IN SELECT * FROM (VALUES
    ('iPhone 18 Pro Max 256GB',11999::numeric,ARRAY['Azul','Preto','Prata']),
    ('iPhone 18 Pro Max 512GB',13700::numeric,ARRAY['Azul','Prata','Preto']),
    ('iPhone 18 Pro Max 512GB',13900::numeric,ARRAY['Bordô']),
    ('iPhone 18 Pro 256GB',10900::numeric,ARRAY['Preto'])
  ) AS x(name,cost,colors) LOOP
    SELECT id INTO v_product FROM public.products WHERE tenant_id=v_tenant AND lower(name)=lower(v_name) LIMIT 1;
    IF v_product IS NULL THEN
      INSERT INTO public.products(tenant_id,name,category,price,original_price,in_stock,store_visible,manual_blocked)
      VALUES(v_tenant,v_name,'Smartphones',0,NULL,false,true,false) RETURNING id INTO v_product;
    END IF;
    FOREACH v_color IN ARRAY v_colors LOOP
      IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE product_id=v_product AND public.catalog_variant_match_key(name)=public.catalog_variant_match_key(v_color)) THEN
        INSERT INTO public.product_variants(product_id,tenant_id,name,price_delta,in_stock,sort_order,cost_price,suggested_price,needs_price_review,price_source,supplier_id)
        VALUES(v_product,v_tenant,v_color,0,'false',COALESCE((SELECT max(sort_order)+1 FROM public.product_variants WHERE product_id=v_product),0),NULL,NULL,true,NULL,NULL);
      END IF;
      INSERT INTO public.pending_supplier_quotes(tenant_id,product_id,product_name,variant_name,variant_key,unit_cost,source_text)
      SELECT v_tenant,v_product,v_name,v_color,public.catalog_variant_match_key(v_color),v_cost,v_name||' - '||v_color||' - R$ '||v_cost
      WHERE NOT EXISTS (SELECT 1 FROM public.pending_supplier_quotes q WHERE q.tenant_id=v_tenant AND q.product_id=v_product AND q.variant_key=public.catalog_variant_match_key(v_color) AND q.unit_cost=v_cost AND q.status='pending');
    END LOOP;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON public.pending_supplier_quotes TO authenticated;
