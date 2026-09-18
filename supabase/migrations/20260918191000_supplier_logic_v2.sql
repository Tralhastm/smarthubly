-- V2: uma fotografia concluída por fornecedor é a única fonte operacional.
CREATE TABLE IF NOT EXISTS public.supplier_catalog_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  supplier_id text NOT NULL,
  archive_id uuid NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','superseded','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL
);
ALTER TABLE public.supplier_variant_offers ADD COLUMN IF NOT EXISTS snapshot_id uuid NULL;
CREATE INDEX IF NOT EXISTS supplier_snapshot_current_idx ON public.supplier_catalog_snapshots(supplier_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS supplier_variant_snapshot_idx ON public.supplier_variant_offers(supplier_id,snapshot_id,available);

CREATE OR REPLACE FUNCTION public.begin_supplier_catalog_snapshot_by_token(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.suppliers%ROWTYPE; a uuid; snap uuid;
BEGIN
  SELECT * INTO s FROM public.suppliers WHERE access_token=_token AND length(COALESCE(_token,''))>=16;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_supplier_token'; END IF;
  SELECT id INTO a FROM public.supplier_catalog_archives
   WHERE tenant_id=s.tenant_id AND lower(trim(supplier_name))=lower(trim(s.name))
   ORDER BY created_at DESC LIMIT 1;
  INSERT INTO public.supplier_catalog_snapshots(tenant_id,supplier_id,archive_id,status)
  VALUES(s.tenant_id,s.id,a,'processing') RETURNING id INTO snap;
  RETURN jsonb_build_object('snapshot_id',snap,'archive_id',a,'supplier_id',s.id);
END; $$;
GRANT EXECUTE ON FUNCTION public.begin_supplier_catalog_snapshot_by_token(text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.upsert_supplier_variant_offer_by_token(
  _token text,_product_id text,_product_variant_id text,_variant_name text,_variant_key text,
  _unit_cost numeric,_available boolean,_source text DEFAULT 'supplier_panel')
RETURNS public.supplier_variant_offers LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.suppliers%ROWTYPE; snap uuid; row public.supplier_variant_offers;
BEGIN
 SELECT * INTO s FROM public.suppliers WHERE access_token=_token AND length(COALESCE(_token,''))>=16;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_supplier_token'; END IF;
 SELECT id INTO snap FROM public.supplier_catalog_snapshots WHERE supplier_id=s.id AND status='processing' ORDER BY created_at DESC LIMIT 1;
 IF snap IS NULL THEN RAISE EXCEPTION 'supplier_snapshot_not_started'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=_product_id AND tenant_id=s.tenant_id) THEN RAISE EXCEPTION 'invalid_supplier_product'; END IF;
 INSERT INTO public.supplier_variant_offers(tenant_id,product_id,product_variant_id,supplier_id,variant_name,variant_key,unit_cost,available,source,last_seen_at,snapshot_id,source_archive_id)
 SELECT s.tenant_id,_product_id,_product_variant_id,s.id,_variant_name,_variant_key,COALESCE(_unit_cost,0),COALESCE(_available,false),COALESCE(_source,'supplier_panel'),now(),snap,ss.archive_id
 FROM public.supplier_catalog_snapshots ss WHERE ss.id=snap
 ON CONFLICT(supplier_id,product_id,variant_key) DO UPDATE SET product_variant_id=EXCLUDED.product_variant_id,variant_name=EXCLUDED.variant_name,unit_cost=EXCLUDED.unit_cost,available=EXCLUDED.available,source=EXCLUDED.source,last_seen_at=now(),snapshot_id=EXCLUDED.snapshot_id,source_archive_id=EXCLUDED.source_archive_id,updated_at=now()
 RETURNING * INTO row;
 RETURN row;
END; $$;
GRANT EXECUTE ON FUNCTION public.upsert_supplier_variant_offer_by_token(text,text,text,text,text,numeric,boolean,text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.upsert_supplier_product_price_by_token(_token text,_product_name text,_unit_price numeric,_source_archive_id uuid DEFAULT NULL)
RETURNS public.supplier_product_prices LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.suppliers%ROWTYPE; a uuid; row public.supplier_product_prices;
BEGIN
 SELECT * INTO s FROM public.suppliers WHERE access_token=_token AND length(COALESCE(_token,''))>=16;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_supplier_token'; END IF;
 SELECT COALESCE(_source_archive_id,ss.archive_id) INTO a FROM public.supplier_catalog_snapshots ss WHERE ss.supplier_id=s.id AND ss.status='processing' ORDER BY ss.created_at DESC LIMIT 1;
 INSERT INTO public.supplier_product_prices(supplier_id,product_name,unit_price,price_types,available,source_archive_id)
 VALUES(s.id,lower(trim(_product_name)),_unit_price,'["cost"]'::jsonb,true,a)
 ON CONFLICT(supplier_id,product_name) DO UPDATE SET unit_price=EXCLUDED.unit_price,available=true,source_archive_id=EXCLUDED.source_archive_id,updated_at=now()
 RETURNING * INTO row;
 RETURN row;
END; $$;
GRANT EXECUTE ON FUNCTION public.upsert_supplier_product_price_by_token(text,text,numeric,uuid) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.sync_supplier_catalog_snapshot_by_token(_token text,_product_ids text[],_product_names text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.suppliers%ROWTYPE; snap uuid; old uuid; a uuid;
BEGIN
 SELECT * INTO s FROM public.suppliers WHERE access_token=_token AND length(COALESCE(_token,''))>=16;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_supplier_token'; END IF;
 SELECT id,archive_id INTO snap,a FROM public.supplier_catalog_snapshots WHERE supplier_id=s.id AND status='processing' ORDER BY created_at DESC LIMIT 1;
 IF snap IS NULL THEN RAISE EXCEPTION 'supplier_snapshot_not_started'; END IF;
 UPDATE public.supplier_catalog_snapshots SET status='superseded' WHERE supplier_id=s.id AND status='completed';
 UPDATE public.supplier_catalog_snapshots SET status='completed',completed_at=now() WHERE id=snap;
 UPDATE public.supplier_variant_offers SET available=false,last_seen_at=now(),updated_at=now() WHERE supplier_id=s.id AND snapshot_id IS DISTINCT FROM snap;
 UPDATE public.supplier_product_prices SET available=false,updated_at=now() WHERE supplier_id=s.id AND source_archive_id IS DISTINCT FROM a;
 PERFORM public.rebuild_supplier_catalog_state(s.tenant_id);
 RETURN jsonb_build_object('snapshot_id',snap,'archive_id',a,'status','completed');
END; $$;
GRANT EXECUTE ON FUNCTION public.sync_supplier_catalog_snapshot_by_token(text,text[],text[]) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.rebuild_supplier_catalog_state(_tenant_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pv_count int:=0; p_count int:=0;
BEGIN
 -- Para cada variação, somente ofertas disponíveis da fotografia concluída mais recente.
 WITH current_snap AS (
   SELECT DISTINCT ON (supplier_id) supplier_id,id FROM public.supplier_catalog_snapshots
   WHERE tenant_id=_tenant_id AND status='completed' ORDER BY supplier_id,completed_at DESC NULLS LAST,created_at DESC
 ), winner AS (
   SELECT DISTINCT ON (o.product_variant_id) o.product_variant_id,o.supplier_id,o.unit_cost
   FROM public.supplier_variant_offers o JOIN current_snap cs ON cs.supplier_id=o.supplier_id AND cs.id=o.snapshot_id
   WHERE o.tenant_id=_tenant_id AND o.available=true AND o.product_variant_id IS NOT NULL
   ORDER BY o.product_variant_id,o.unit_cost ASC,md5(o.supplier_id||':'||o.product_variant_id)
 ), target AS (
   SELECT pv.id,w.supplier_id,w.unit_cost FROM public.product_variants pv LEFT JOIN winner w ON w.product_variant_id=pv.id WHERE pv.tenant_id=_tenant_id
 )
 UPDATE public.product_variants pv SET supplier_id=t.supplier_id,cost_price=CASE WHEN t.supplier_id IS NULL THEN pv.cost_price ELSE t.unit_cost END,price_source=CASE WHEN t.supplier_id IS NULL THEN pv.price_source ELSE 'supplier_offer' END,in_stock=CASE WHEN t.supplier_id IS NULL THEN 'false' ELSE 'true' END,updated_at=now() FROM target t WHERE pv.id=t.id;
 GET DIAGNOSTICS pv_count=ROW_COUNT;
 UPDATE public.products p SET supplier_id=NULL,in_stock=EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id AND pv.in_stock='true'),updated_at=now() WHERE p.tenant_id=_tenant_id AND EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id);
 WITH current_snap AS (
   SELECT DISTINCT ON (supplier_id) supplier_id,archive_id FROM public.supplier_catalog_snapshots WHERE tenant_id=_tenant_id AND status='completed' ORDER BY supplier_id,completed_at DESC NULLS LAST,created_at DESC
 ), winner AS (
   SELECT DISTINCT ON (p.id) p.id AS product_id,spp.supplier_id,spp.unit_price FROM public.products p JOIN public.supplier_product_prices spp ON spp.available=true AND public.catalog_product_match_key(spp.product_name)=public.catalog_product_match_key(p.name) JOIN current_snap cs ON cs.supplier_id=spp.supplier_id AND cs.archive_id=spp.source_archive_id WHERE p.tenant_id=_tenant_id AND NOT EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id) ORDER BY p.id,spp.unit_price ASC,md5(spp.supplier_id||':'||p.id)
 ) UPDATE public.products p SET supplier_id=w.supplier_id,original_price=w.unit_price,in_stock=true,updated_at=now() FROM winner w WHERE p.id=w.product_id;
 GET DIAGNOSTICS p_count=ROW_COUNT;
 UPDATE public.products p SET supplier_id=NULL,in_stock=false,updated_at=now() WHERE p.tenant_id=_tenant_id AND NOT EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id) AND NOT EXISTS(SELECT 1 FROM public.supplier_product_prices spp JOIN public.supplier_catalog_snapshots cs ON cs.supplier_id=spp.supplier_id AND cs.archive_id=spp.source_archive_id AND cs.status='completed' WHERE spp.available=true AND public.catalog_product_match_key(spp.product_name)=public.catalog_product_match_key(p.name));
 RETURN jsonb_build_object('products',p_count,'variants',pv_count);
END; $$;
GRANT EXECUTE ON FUNCTION public.rebuild_supplier_catalog_state(text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.reconcile_supplier_catalog(p_supplier_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE t text; BEGIN SELECT tenant_id INTO t FROM public.suppliers WHERE id=p_supplier_id; IF t IS NULL THEN RAISE EXCEPTION 'supplier_not_found'; END IF; RETURN public.rebuild_supplier_catalog_state(t); END; $$;
GRANT EXECUTE ON FUNCTION public.reconcile_supplier_catalog(text) TO authenticated,service_role;

-- Checkout: escolhe o menor custo vigente por linha e cria fragmentos automaticamente.
CREATE OR REPLACE FUNCTION public.place_order(_order jsonb,_items jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE id text; payload jsonb; cols text; it jsonb; p text; v text; sid text; sc numeric; frag jsonb:='{}'::jsonb; key text; arr jsonb; item2 jsonb; hasv boolean;
BEGIN
 FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_items,'[]'::jsonb)) LOOP
  p=trim(COALESCE(it->>'product_name',it->'product'->>'name','')); v=trim(COALESCE(it->>'variant_name',it->'variantName',it->'variant',''));
  IF p='' THEN RAISE EXCEPTION 'item_produto_obrigatorio'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.product_variants pv JOIN public.products x ON x.id=pv.product_id WHERE x.tenant_id=_order->>'tenant_id' AND public.catalog_product_match_key(x.name)=public.catalog_product_match_key(p)) INTO hasv;
  IF hasv AND v<>'' THEN SELECT o.supplier_id,o.unit_cost INTO sid,sc FROM public.supplier_variant_offers o JOIN public.supplier_catalog_snapshots cs ON cs.id=o.snapshot_id AND cs.status='completed' WHERE o.tenant_id=_order->>'tenant_id' AND o.available=true AND o.product_variant_id=(SELECT pv.id FROM public.product_variants pv JOIN public.products x ON x.id=pv.product_id WHERE x.tenant_id=_order->>'tenant_id' AND public.catalog_product_match_key(x.name)=public.catalog_product_match_key(p) AND lower(trim(pv.name))=lower(v) LIMIT 1) ORDER BY o.unit_cost,md5(o.supplier_id||':'||o.product_variant_id) LIMIT 1;
  ELSE SELECT spp.supplier_id,spp.unit_price INTO sid,sc FROM public.supplier_product_prices spp JOIN public.supplier_catalog_snapshots cs ON cs.supplier_id=spp.supplier_id AND cs.archive_id=spp.source_archive_id AND cs.status='completed' WHERE spp.available=true AND public.catalog_product_match_key(spp.product_name)=public.catalog_product_match_key(p) ORDER BY spp.unit_price,md5(spp.supplier_id||':'||p) LIMIT 1; END IF;
  IF sid IS NULL THEN RAISE EXCEPTION 'fornecedor_sem_estoque_atual: % / %',p,v; END IF;
  item2=it||jsonb_build_object('supplier_id',sid,'supplier_cost',sc); arr=COALESCE(frag->sid,'[]'::jsonb)||jsonb_build_array(item2); frag=jsonb_set(frag,ARRAY[sid],arr,true);
 END LOOP;
 payload=(_order - 'id' - 'created_at' - 'updated_at')||jsonb_build_object('metadata',COALESCE(_order->'metadata','{}'::jsonb)||jsonb_build_object('fragmentation_map',frag));
 SELECT string_agg(format('%I',k),',') INTO cols FROM jsonb_object_keys(payload) k WHERE EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='orders' AND c.column_name=k);
 EXECUTE format('INSERT INTO public.orders(%s) SELECT %s FROM jsonb_populate_record(null::public.orders,$1) RETURNING id',cols,cols) USING payload INTO id;
 FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_items,'[]'::jsonb)) LOOP
  payload=(it - 'id' - 'created_at')||jsonb_build_object('order_id',id); SELECT string_agg(format('%I',k),',') INTO cols FROM jsonb_object_keys(payload) k WHERE EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='order_items' AND c.column_name=k); EXECUTE format('INSERT INTO public.order_items(%s) SELECT %s FROM jsonb_populate_record(null::public.order_items,$1)',cols,cols) USING payload;
 END LOOP;
 FOR key IN SELECT jsonb_object_keys(frag) LOOP arr=frag->key; INSERT INTO public.order_fragments(order_id,tenant_id,supplier_id,items,total,status) VALUES(id,_order->>'tenant_id',key,arr,(SELECT SUM(COALESCE((x->>'supplier_cost')::numeric,0)*COALESCE((x->>'quantity')::numeric,0)) FROM jsonb_array_elements(arr) x),COALESCE(_order->>'status','pending'));
  UPDATE public.order_items oi SET supplier_id=key WHERE oi.order_id=id AND EXISTS(SELECT 1 FROM jsonb_array_elements(arr) x WHERE COALESCE(x->>'product_name',x->'product'->>'name')=oi.product_name AND COALESCE(x->>'variant_name',x->>'variantName',x->>'variant','')=COALESCE(oi.variant_name,'')); END LOOP;
 RETURN id;
END; $$;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb,jsonb) TO anon,authenticated;

DO $$ DECLARE s record; BEGIN FOR s IN SELECT id,tenant_id FROM public.suppliers LOOP PERFORM public.rebuild_supplier_catalog_state(s.tenant_id); END LOOP; END $$;
-- Correction applied directly in the database below; this migration file remains the source record.
