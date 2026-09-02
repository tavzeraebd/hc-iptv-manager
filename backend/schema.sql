-- IPTV Manager — portal hospedado no Supabase
-- Rode este script uma vez no SQL Editor do seu projeto Supabase
-- (Dashboard -> SQL Editor -> New query -> cole -> Run).
--
-- Depois defina no host do portal:
--   SUPABASE_URL=https://<ref>.supabase.co
--   SUPABASE_SECRET_KEY=sb_secret_...        (API Keys -> Secret keys)
--   PORTAL_ADMIN_TOKEN=<uma senha longa aleatória>
--   PORTAL_PUBLIC_URL=https://<seu-portal>          (para o webhook do Mercado Pago)
--   MP_ACCESS_TOKEN=APP_USR-...  (ou TEST-... p/ sandbox)   -- Mercado Pago
--   MP_WEBHOOK_SECRET=...        (Painel MP -> seu app -> Webhooks -> assinatura secreta)

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

-- Config do portal editável pelo Manager (preço de renovação etc.)
create table if not exists public.portal_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);
insert into public.portal_settings (key, value, updated_at)
values ('renewal', '{"priceCents":1990,"months":1,"qrTtlMin":30}'::jsonb,
        (extract(epoch from now()) * 1000)::bigint)
on conflict (key) do nothing;

-- Cobranças PIX (Mercado Pago)
create table if not exists public.payments (
  id            uuid primary key,
  device_mac    text not null,
  provider      text not null default 'mercadopago',
  provider_ref  text,
  amount_cents  integer not null,
  months        integer not null default 1,
  status        text not null default 'pending'
                  check (status in ('pending','paid','expired','error','cancelled')),
  qr_code       text,
  qr_code_b64   text,
  ticket_url    text,
  created_at    bigint not null,
  expires_at    bigint,
  paid_at       bigint,
  processed     boolean not null default false
);
create index if not exists payments_device_idx      on public.payments (device_mac, created_at desc);
create index if not exists payments_provider_ref_idx on public.payments (provider_ref);
create index if not exists payments_status_idx       on public.payments (status);

-- RLS ligada e SEM policies: só a chave secreta (service_role) acessa. A
-- chave publishable/anon fica bloqueada de ler ou escrever qualquer coisa —
-- defesa em profundidade caso ela vaze (ela não é secreta).
alter table public.iptv_users      enable row level security;
alter table public.devices         enable row level security;
alter table public.portal_settings enable row level security;
alter table public.payments        enable row level security;
