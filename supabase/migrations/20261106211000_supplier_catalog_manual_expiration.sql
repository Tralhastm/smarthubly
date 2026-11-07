-- Catálogos de fornecedor não vencem por tempo. O arquivo vigente só é
-- encerrado quando outra importação conclui ou quando o fornecedor encerra
-- manualmente a lista pelo painel.
ALTER TABLE public.supplier_catalog_archives
  ALTER COLUMN expires_at SET DEFAULT 'infinity'::timestamptz;

COMMENT ON COLUMN public.supplier_catalog_archives.expires_at IS
  'Sem prazo automático: infinity indica lista vigente; substituição concluída ou encerramento manual grava o instante de término.';

-- Migrar somente o snapshot atual ainda vigente para o novo estado sem prazo.
-- Arquivos já vencidos não são tocados (incluindo a lista antiga da Mobiletec).
WITH current_snapshot AS (
  SELECT DISTINCT ON (tenant_id, supplier_id)
    tenant_id,
    supplier_id,
    archive_id
  FROM public.supplier_catalog_snapshots
  WHERE status = 'completed'
    AND archive_id IS NOT NULL
  ORDER BY tenant_id, supplier_id,
    completed_at DESC NULLS LAST,
    created_at DESC
)
UPDATE public.supplier_catalog_archives AS a
SET expires_at = 'infinity'::timestamptz
FROM current_snapshot AS cs
WHERE a.id = cs.archive_id
  AND a.tenant_id = cs.tenant_id
  AND a.expires_at > now();

-- A importação atômica marca snapshots anteriores como superseded antes de
-- completar o novo. Só nessa conclusão bem-sucedida os arquivos antigos são
-- expirados; falhas revertem a transação inteira e preservam a lista anterior.
CREATE OR REPLACE FUNCTION public.expire_replaced_supplier_catalog_archives()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.supplier_catalog_archives AS a
    SET expires_at = now()
    FROM public.supplier_catalog_snapshots AS previous_snapshot
    WHERE previous_snapshot.tenant_id = NEW.tenant_id
      AND previous_snapshot.supplier_id = NEW.supplier_id
      AND previous_snapshot.id <> NEW.id
      AND previous_snapshot.status = 'superseded'
      AND previous_snapshot.archive_id = a.id
      AND a.tenant_id = NEW.tenant_id
      AND a.expires_at > now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_replaced_supplier_catalog_archives() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_expire_replaced_supplier_catalog_archives
  ON public.supplier_catalog_snapshots;
CREATE TRIGGER trg_expire_replaced_supplier_catalog_archives
AFTER UPDATE OF status ON public.supplier_catalog_snapshots
FOR EACH ROW
WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.expire_replaced_supplier_catalog_archives();

-- Encerramento manual autenticado pelo token já usado no painel do fornecedor.
-- A função invalida as ofertas daquele snapshot e recalcula os produtos no
-- tenant, permitindo que uma oferta vigente de outro fornecedor assuma o lugar.
CREATE OR REPLACE FUNCTION public.expire_supplier_catalog_by_token(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.suppliers%ROWTYPE;
  v_snapshot_id uuid;
  v_archive_id uuid;
  v_archive_expiry timestamptz;
  v_reconciliation jsonb;
BEGIN
  SELECT * INTO s
  FROM public.suppliers
  WHERE access_token = _token
    AND length(COALESCE(_token, '')) >= 16;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_supplier_token';
  END IF;

  -- Escolher primeiro o último snapshot concluído. Nunca procurar um snapshot
  -- antigo para reativar ou encerrar um catálogo que já foi substituído.
  SELECT cs.id, cs.archive_id, a.expires_at
  INTO v_snapshot_id, v_archive_id, v_archive_expiry
  FROM public.supplier_catalog_snapshots AS cs
  JOIN public.supplier_catalog_archives AS a
    ON a.id = cs.archive_id
   AND a.tenant_id = cs.tenant_id
  WHERE cs.tenant_id = s.tenant_id
    AND cs.supplier_id = s.id
    AND cs.status = 'completed'
  ORDER BY cs.completed_at DESC NULLS LAST, cs.created_at DESC
  LIMIT 1;

  IF NOT FOUND OR v_archive_expiry <= now() THEN
    RETURN jsonb_build_object('status', 'no_active_catalog');
  END IF;

  UPDATE public.supplier_catalog_archives
  SET expires_at = now()
  WHERE id = v_archive_id
    AND tenant_id = s.tenant_id
    AND expires_at > now();

  UPDATE public.supplier_variant_offers
  SET available = false,
      updated_at = now()
  WHERE tenant_id = s.tenant_id
    AND supplier_id = s.id
    AND snapshot_id = v_snapshot_id;

  UPDATE public.supplier_product_prices
  SET available = false,
      updated_at = now()
  WHERE supplier_id = s.id
    AND snapshot_id = v_snapshot_id;

  UPDATE public.supplier_catalog_snapshots
  SET status = 'superseded'
  WHERE id = v_snapshot_id
    AND tenant_id = s.tenant_id
    AND supplier_id = s.id
    AND status = 'completed';

  v_reconciliation := public.rebuild_supplier_catalog_state(s.tenant_id);

  RETURN jsonb_build_object(
    'status', 'expired',
    'snapshot_id', v_snapshot_id,
    'reconciliation', v_reconciliation
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_supplier_catalog_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_supplier_catalog_by_token(text)
  TO anon, authenticated, service_role;
