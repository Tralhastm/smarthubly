create table if not exists public.email_provider_credentials (
  provider text primary key,
  api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_provider_credentials enable row level security;

revoke all on table public.email_provider_credentials from anon, authenticated;
grant select on table public.email_provider_credentials to service_role;
