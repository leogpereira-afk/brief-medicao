-- Numero do brief, a prova de corrida. nextval() e atomico: duas chamadas
-- simultaneas NUNCA recebem o mesmo numero (era o que o truque das chaves
-- num_N + onlyIfNew garantia no Blobs, so que com laco de ate 1000 voltas).
--
-- O laco aqui e so uma rede de seguranca: se a sequencia ficar atras do maior
-- numero ja gravado (ex.: migracao importou dados depois de acertar o setval),
-- ele avanca ate passar. Em operacao normal roda uma vez so.
create or replace function public.brief_proximo_numero()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
  maior bigint;
begin
  select coalesce(max((registro->>'numeroBrief')::bigint), 0) into maior
    from public.brief_registros
    where colecao = 'os' and registro->>'numeroBrief' ~ '^[0-9]+$';
  loop
    n := nextval('public.brief_numero_seq');
    exit when n > maior;
  end loop;
  return n;
end;
$$;

-- Reposiciona o contador (acao "ajustarSeq" do app).
create or replace function public.brief_ajustar_numero(novo_ultimo bigint)
returns void
language sql
security definer
set search_path = public
as $$
  select setval('public.brief_numero_seq', greatest(novo_ultimo, 1), true);
$$;

-- So a Edge Function (service_role) chama. Sem isto, qualquer um com a anon key
-- poderia queimar numeros de brief ou reposicionar o contador pelo /rest/v1/rpc.
revoke all on function public.brief_proximo_numero() from public, anon, authenticated;
revoke all on function public.brief_ajustar_numero(bigint) from public, anon, authenticated;
