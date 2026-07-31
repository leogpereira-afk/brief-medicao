-- ============================================================================
-- Manutencao diaria agendada.
--
-- No Netlify era [functions."manutencao"] schedule = "@daily" no netlify.toml.
-- Aqui e o pg_cron chamando a acao "manutencao" do brief-sync pelo pg_net.
--
-- POR QUE ISTO NAO PODE FICAR PARA DEPOIS: sem substituto, o job simplesmente
-- deixa de existir quando o Netlify morrer. A lixeira nunca mais seria esvaziada
-- e o log cresceria para sempre -- e ninguem perceberia, porque nada quebra na
-- tela. So a tela de "saude" mostraria a data do ultimo batimento envelhecendo.
--
-- Sobre o token no comando: ele fica visivel em cron.job. Nao e exposicao nova
-- -- este mesmo token ja viaja no bundle do navegador de todo mundo que abre o
-- app (autenticacao leve, decisao consciente do dono). Se um dia o app ganhar
-- login de verdade, este comando precisa passar a ler do Vault.
--
-- 07:00 UTC = 04:00 de Brasilia: ninguem usando, e a purga mexe em foto.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotente: rodar a migracao de novo nao cria job duplicado.
select cron.unschedule('brief-manutencao-diaria')
where exists (select 1 from cron.job where jobname = 'brief-manutencao-diaria');

select cron.schedule(
  'brief-manutencao-diaria',
  '0 7 * * *',
  $job$
  select net.http_post(
    url     := 'https://heveemylixartyijxewh.supabase.co/functions/v1/brief-sync',
    headers := '{"Content-Type":"application/json","x-token":"e745b3c735b68e76e0ed680f5842f2d19f52b8aad902b856"}'::jsonb,
    body    := '{"action":"manutencao"}'::jsonb
  );
  $job$
);
