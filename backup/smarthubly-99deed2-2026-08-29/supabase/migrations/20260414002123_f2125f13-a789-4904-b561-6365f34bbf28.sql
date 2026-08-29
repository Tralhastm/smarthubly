
-- Tabela de fornecedores
CREATE TABLE public.suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  responsible_for_delivery BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read suppliers" ON public.suppliers FOR SELECT USING (true);
CREATE POLICY "Admins can insert suppliers" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Admins can update suppliers" ON public.suppliers FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Admins can delete suppliers" ON public.suppliers FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela de motoboys
CREATE TABLE public.drivers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read drivers" ON public.drivers FOR SELECT USING (true);
CREATE POLICY "Admins can insert drivers" ON public.drivers FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Admins can update drivers" ON public.drivers FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Admins can delete drivers" ON public.drivers FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER update_drivers_updated_at BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Adicionar supplier_id nos products
ALTER TABLE public.products ADD COLUMN supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

-- Adicionar supplier_id nos orders  
ALTER TABLE public.orders ADD COLUMN supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

-- Adicionar driver_id nos orders
ALTER TABLE public.orders ADD COLUMN driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL;

-- Adicionar delivery_status_note nos orders (para motoboy escrever nota como "vou atrasar")
ALTER TABLE public.orders ADD COLUMN delivery_status_note TEXT DEFAULT '';

-- Adicionar niche nos tenants
ALTER TABLE public.tenants ADD COLUMN niche TEXT DEFAULT '';

-- Permitir anon atualizar orders (para fornecedor/motoboy via token)
CREATE POLICY "Anon can update orders" ON public.orders FOR UPDATE TO anon USING (true);

-- Permitir anon atualizar products (para fornecedor controlar estoque via token)
CREATE POLICY "Anon can update products" ON public.products FOR UPDATE TO anon USING (true);
