CREATE INDEX IF NOT EXISTS idx_products_tenant_id ON public.products (tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant_created ON public.products (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_id ON public.orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);