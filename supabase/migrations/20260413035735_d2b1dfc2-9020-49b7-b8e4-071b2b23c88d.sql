
-- MULTI-TENANT DELIVERY PLATFORM SCHEMA

-- Platform roles enum
CREATE TYPE public.platform_role AS ENUM ('super_admin');
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- TENANTS
CREATE TABLE public.tenants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  description TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  delivery_mode INTEGER NOT NULL DEFAULT 1 CHECK (delivery_mode IN (1, 2)),
  platform_fee NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read active tenants" ON public.tenants FOR SELECT USING (true);

-- PLATFORM ROLES (super admins)
CREATE TABLE public.platform_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role platform_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_platform_role(_user_id UUID, _role platform_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.platform_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE POLICY "Super admins can view platform roles" ON public.platform_roles FOR SELECT TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Super admins can insert tenants" ON public.tenants FOR INSERT TO authenticated WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Super admins can update tenants" ON public.tenants FOR UPDATE TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Super admins can delete tenants" ON public.tenants FOR DELETE TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'));

-- USER ROLES (tenant admins)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT false,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role, _tenant_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role AND tenant_id = _tenant_id AND approved = true) $$;

CREATE POLICY "Authenticated can view user roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can request role" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can update roles" ON public.user_roles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can delete roles" ON public.user_roles FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));

CREATE OR REPLACE FUNCTION public.request_admin_role(_user_id UUID, _tenant_id UUID, _email TEXT DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ INSERT INTO public.user_roles (user_id, tenant_id, role, approved, email) VALUES (_user_id, _tenant_id, 'admin', false, _email) ON CONFLICT (user_id, tenant_id, role) DO NOTHING; $$;

-- PRODUCTS
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  image TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Geral',
  description TEXT NOT NULL DEFAULT '',
  in_stock BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can browse products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Admins can insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can update products" ON public.products FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can delete products" ON public.products FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));

-- ORDERS
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  total NUMERIC(10,2) NOT NULL,
  platform_fee NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('delivery', 'pickup')),
  delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'preparing', 'out-for-delivery', 'delivered')),
  distance NUMERIC(5,1),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can place orders" ON public.orders FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anon can read orders" ON public.orders FOR SELECT TO anon USING (true);
CREATE POLICY "Admins can view orders" ON public.orders FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can update orders" ON public.orders FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can delete orders" ON public.orders FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));

-- ORDER ITEMS
CREATE TABLE public.order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  product_price NUMERIC(10,2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert order items" ON public.order_items FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anon can read order items" ON public.order_items FOR SELECT TO anon USING (true);
CREATE POLICY "Admins can view order items" ON public.order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can delete order items" ON public.order_items FOR DELETE TO authenticated USING (true);

-- LOYALTY RECORDS
CREATE TABLE public.loyalty_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, address)
);
ALTER TABLE public.loyalty_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read loyalty" ON public.loyalty_records FOR SELECT USING (true);
CREATE POLICY "Anyone can insert loyalty" ON public.loyalty_records FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update loyalty" ON public.loyalty_records FOR UPDATE USING (true);

-- FINANCIAL ENTRIES
CREATE TABLE public.financial_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount NUMERIC(10,2) NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('fixed', 'variable', 'investment', 'unexpected')),
  date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view financial entries" ON public.financial_entries FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can insert financial entries" ON public.financial_entries FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can update financial entries" ON public.financial_entries FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can delete financial entries" ON public.financial_entries FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));

-- DEBTS
CREATE TABLE public.debts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  due_date TEXT,
  paid BOOLEAN NOT NULL DEFAULT false,
  type TEXT NOT NULL CHECK (type IN ('owe', 'owed')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view debts" ON public.debts FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can insert debts" ON public.debts FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can update debts" ON public.debts FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can delete debts" ON public.debts FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));

-- TRIGGERS
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_debts_updated_at BEFORE UPDATE ON public.debts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_loyalty_updated_at BEFORE UPDATE ON public.loyalty_records FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- INDEXES
CREATE INDEX idx_products_tenant ON public.products(tenant_id);
CREATE INDEX idx_orders_tenant ON public.orders(tenant_id);
CREATE INDEX idx_orders_phone ON public.orders(customer_phone);
CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_loyalty_tenant ON public.loyalty_records(tenant_id);
CREATE INDEX idx_financial_tenant ON public.financial_entries(tenant_id);
CREATE INDEX idx_debts_tenant ON public.debts(tenant_id);
CREATE INDEX idx_user_roles_tenant ON public.user_roles(tenant_id);
CREATE INDEX idx_tenants_slug ON public.tenants(slug);
