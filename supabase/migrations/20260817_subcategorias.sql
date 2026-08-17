-- Subcategorias ilimitadas (n níveis)
-- ============================================================
-- Padrão replicado de garcom_devices (o app filtra tenant_id nas queries,
-- e as políticas garantem que admins/proprietários do tenant vejam os dados).
-- IDs em tenants/user_roles/products SÃO TEXT neste banco.
-- 1) Tabela de nós da árvore de categorias
create table if not exists public.product_categories (
  id          text primary key default gen_random_uuid()::text,
  tenant_id   text not null,
  name        text not null,
  parent_id   text references public.product_categories(id) on delete cascade null,
  sort_order  integer not null default 0,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_product_categories_tenant on public.product_categories (tenant_id);
create index if not exists idx_product_categories_parent on public.product_categories (parent_id);

-- 2) Caminho de IDs da subcategoria no produto (ex: [raiz, nível2, folha]).
--    `category` continua sendo o nome da raiz (compatibilidade com o código antigo).
alter table public.products
  add column if not exists subcategory_ids text[] default null;

-- 3) RLS — mesmo padrão de garcom_devices
alter table public.product_categories enable row level security;

drop policy if exists "categories_select_own_tenant" on public.product_categories;
drop policy if exists "categories_insert_own_tenant" on public.product_categories;
drop policy if exists "categories_update_own_tenant" on public.product_categories;
drop policy if exists "categories_delete_own_tenant" on public.product_categories;
drop policy if exists "categories_deny_anon" on public.product_categories;

create policy "categories_select_own_tenant" on public.product_categories
  for select using (
    exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and ur.tenant_id = product_categories.tenant_id
        and ur.role = 'admin'
    )
    or exists (
      select 1 from platform_roles pr
      where pr.user_id = auth.uid()
        and pr.role = 'super_admin'
    )
  );

create policy "categories_write_own_tenant" on public.product_categories
  for all using (
    exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and ur.tenant_id = product_categories.tenant_id
        and ur.role = 'admin'
    )
    or exists (
      select 1 from platform_roles pr
      where pr.user_id = auth.uid()
        and pr.role = 'super_admin'
    )
  );

-- Nega acesso a qualquer um que não corresponda às políticas acima (RLS padrão).
-- Nota: no modelo do garcom_devices a política permissiva já restringe, e aqui
-- usamos uma política separada DENY para bloquear anon e usuários sem vínculo.
create policy "categories_allow_admin_or_owner" on public.product_categories
  as permissive
  for all
  to authenticated
  using (
    exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.tenant_id = product_categories.tenant_id and ur.role = 'admin')
    or exists (select 1 from platform_roles pr where pr.user_id = auth.uid() and pr.role = 'super_admin')
  );

-- 4) Funções auxiliares (removem nó do caminho de produtos ao excluir categoria)
create or replace function public.remove_product_category(p_category_id text)
returns void language plpgsql security definer as $$
begin
  update public.products
     set subcategory_ids = (
       select coalesce(array_agg(x), array[]::text[])
       from unnest(coalesce(subcategory_ids, array[]::text[])) as t(x)
       where x <> p_category_id
     )
  where p_category_id = any(coalesce(subcategory_ids, array[]::text[]));
end; $$;

create or replace function public.remove_product_categories(p_category_ids text[])
returns void language plpgsql security definer as $$
begin
  update public.products
     set subcategory_ids = (
       select coalesce(array_agg(x), array[]::text[])
       from unnest(coalesce(subcategory_ids, array[]::text[])) as t(x)
       where not (x = any(p_category_ids))
     )
  where coalesce(subcategory_ids, array[]::text[]) && p_category_ids;
end; $$;

-- Gatilho: ao excluir um nó de categoria, limpa o caminho nos produtos
drop trigger if exists trg_category_removed on public.product_categories;
create or replace function public.on_product_category_removed()
returns trigger language plpgsql security definer as $$
declare
  all_ids text[];
begin
  -- coleta o nó excluído e TODOS os descendentes (a FK on delete cascade já
  -- exclui os filhos, mas precisamos limpar os produtos antes do cascade)
  with recursive nodes as (
    select id from public.product_categories where id = old.id
    union all
    select c.id from public.product_categories c join nodes n on c.parent_id = n.id
  ) select array_agg(id) into all_ids from nodes;
  if all_ids is not null then
    perform public.remove_product_categories(all_ids);
  end if;
  return old;
end; $$;

create trigger trg_category_removed
  before delete on public.product_categories
  for each row execute function public.on_product_category_removed();
