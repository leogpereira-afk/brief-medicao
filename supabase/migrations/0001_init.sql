-- ============================================================================
-- Schema do BRIEF DE MEDICAO no Supabase (substitui o Netlify Blobs).
--
-- ATENCAO -- PROJETO COMPARTILHADO: este projeto hospeda TAMBEM o RH, que ficou
-- com os nomes CRUS (registros, config_global, meta, perfis, bucket "arquivos",
-- function "sync"). Por isso TUDO aqui leva o prefixo brief_ / brief-. Criar
-- qualquer objeto sem prefixo reutiliza silenciosamente a tabela do RH em
-- producao -- "create table if not exists" NAO avisa.
--
-- De-para dos stores do Blobs:
--   os          -> brief_registros (colecao='os')
--   log         -> brief_registros (colecao='log')
--   integracoes -> brief_meta      (credenciais do Mubisys + manutencao_status)
--   fotos       -> bucket brief-arquivos
--   cfg         -> brief_config_global
--
-- RLS ligado e SEM policy: so a Edge Function (service_role) acessa. Reproduz a
-- barreira de hoje ("so a Netlify Function fala com o Blobs") -- ninguem no
-- navegador le o Postgres direto com a anon key.
-- ============================================================================

create table if not exists public.brief_registros (
  colecao       text not null,
  id            text not null,
  registro      jsonb not null,
  atualizado_em timestamptz not null default now(),
  apagado       boolean not null default false,
  primary key (colecao, id)
);
create index if not exists brief_registros_colecao_idx on public.brief_registros (colecao);
-- A manutencao diaria varre por data (lixeira 30d, log 90d): sem este indice
-- ela faria varredura completa a cada noite.
create index if not exists brief_registros_atualizado_idx on public.brief_registros (colecao, atualizado_em);
alter table public.brief_registros enable row level security;

create table if not exists public.brief_config_global (
  id            boolean primary key default true check (id),
  config        jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.brief_config_global enable row level security;

-- Chave/valor: contador "rev" do pull economico + o que hoje vive no store
-- "integracoes" (credenciais do Mubisys, que nunca vao para o navegador).
create table if not exists public.brief_meta (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.brief_meta enable row level security;

-- Fotos das medicoes. Bucket privado: so a Edge Function (service_role) le e
-- grava, igual ao bucket "arquivos" do RH -- mas com nome proprio.
insert into storage.buckets (id, name, public)
values ('brief-arquivos', 'brief-arquivos', false)
on conflict (id) do nothing;
