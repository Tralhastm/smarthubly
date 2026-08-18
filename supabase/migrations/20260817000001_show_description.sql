-- Adiciona o toggle "exibir descrição na vitrine" às lojas.
-- default true: comportamento atual preservado (descrição visível).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS show_description boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN tenants.show_description IS 'Se a descrição da loja deve aparecer no topo da vitrine pública (hero).';
