-- O painel atual usa exclusivamente a importação atômica.
-- Os RPCs antigos permanecem revogados para impedir atualizações parciais.
GRANT EXECUTE ON FUNCTION public.import_supplier_catalog_atomic(text, text, jsonb) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_supplier_variant_offer_by_token(text, text, text, text, text, numeric, boolean, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_supplier_product_price_by_token(text, text, numeric, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_supplier_catalog_snapshot_by_token(text, text[], text[]) FROM anon, authenticated;
