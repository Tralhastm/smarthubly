-- Keep the legacy orders.supplier_id aligned with explicit routing metadata.
-- For split orders there is no single supplier, so the legacy field is cleared.
CREATE OR REPLACE FUNCTION public.sync_order_supplier_from_fragments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  supplier_count integer;
  routed_supplier text;
BEGIN
  SELECT count(*) INTO supplier_count
  FROM jsonb_object_keys(COALESCE(NEW.metadata->'fragmentation_map', '{}'::jsonb));

  IF supplier_count = 1 THEN
    SELECT key INTO routed_supplier
    FROM jsonb_object_keys(COALESCE(NEW.metadata->'fragmentation_map', '{}'::jsonb)) AS key
    LIMIT 1;
    NEW.supplier_id := routed_supplier;
  ELSIF supplier_count > 1 THEN
    NEW.supplier_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_supplier_from_fragments ON public.orders;
CREATE TRIGGER trg_sync_order_supplier_from_fragments
BEFORE INSERT OR UPDATE OF metadata ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_supplier_from_fragments();
