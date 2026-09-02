-- IPTV Manager — portal hospedado no Supabase
-- Rode este script uma vez no SQL Editor do seu projeto Supabase
-- (Dashboard -> SQL Editor -> New query -> cole -> Run).
--
-- Depois defina no host do portal:
--   SUPABASE_URL=https://<ref>.supabase.co
--   SUPABASE_SECRET_KEY=sb_secret_...        (API Keys -> Secret keys)
--   PORTAL_ADMIN_TOKEN=<uma senha longa aleatória>

create table if not exists public.iptv_users (
  id          uuid primary key,
  host        text not null,
  username    text not null,
  password    text not null,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (host, username)
);

create table if not exists public.devices (
  mac             text primary key,
  name            text not null default '',
  model           text not null default '',
  platform        text not null default '',
  first_seen_at   bigint not null,
  last_seen_at    bigint not null default 0,
  status          text not null default 'pending'
                    check (status in ('pending', 'active', 'disabled')),
  bound_server_id uuid references public.iptv_users(id) on delete set null,
  -- validade do acesso (epoch ms). NULL = sem validade (vitalício).
  expires_at      bigint
);
-- para bancos criados antes da coluna de validade:
alter table public.devices add column if not exists expires_at bigint;

create index if not exists devices_last_seen_idx on public.devices (last_seen_at desc);

-- RLS ligada e SEM policies: só a chave secreta (service_role) acessa. A
-- chave publishable/anon fica bloqueada de ler ou escrever qualquer coisa —
-- defesa em profundidade caso ela vaze (ela não é secreta).
alter table public.iptv_users enable row level security;
alter table public.devices    enable row level security;
