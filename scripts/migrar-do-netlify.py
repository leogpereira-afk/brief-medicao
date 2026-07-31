#!/usr/bin/env python3
"""
Migracao dos dados do Brief: Netlify Blobs -> Supabase.

Le AO VIVO do site antigo (que continua no ar e intocado) pelas acoes que ele
ja expoe, e grava no Supabase. Nao apaga nada do Netlify -- o site velho so
morre na Fase 6, depois do ok explicito.

POR QUE NAO USA A service_role KEY:
  o molde do RH usa a service_role para gravar via PostgREST. Aqui a gravacao
  vai pelo endpoint SQL da Management API, com o token sbp_ que ja esta em uso.
  Assim a chave mestra do projeto (que ignora TODAS as protecoes de linha) nunca
  precisa ser materializada em disco nem passar por aqui.

POR QUE NAO USA A ACAO "upsert" DO brief-sync:
  o upsert dispara o WEBHOOK quando um briefing entra em situacao 'enviado'.
  Numa migracao isso avisaria os designers sobre briefings antigos, como se
  tivessem acabado de chegar. Os registros vao direto para a tabela.
  As FOTOS, sim, vao pela acao putPhoto -- ela nao tem efeito colateral.

Uso:
  python3 scripts/migrar-do-netlify.py            # migra
  python3 scripts/migrar-do-netlify.py --conferir # so compara as contagens
"""

import json
import os
import sys
import urllib.request

NETLIFY = "https://brief-impresilk.netlify.app/.netlify/functions/os"
TOKEN_BRIEF = "e745b3c735b68e76e0ed680f5842f2d19f52b8aad902b856"
REF = "heveemylixartyijxewh"
FN_SUPABASE = f"https://{REF}.supabase.co/functions/v1/brief-sync"
ENV_TOKEN = os.path.expanduser("~/.config/impresilk/supabase.env")


def token_admin() -> str:
    with open(ENV_TOKEN) as f:
        for linha in f:
            if linha.startswith("SUPABASE_ACCESS_TOKEN="):
                return linha.split("=", 1)[1].strip()
    raise SystemExit("token do Supabase nao encontrado em " + ENV_TOKEN)


def post(url: str, corpo: dict, cabecalhos: dict, timeout: int = 120) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(corpo).encode(),
        headers={"Content-Type": "application/json", **cabecalhos},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def do_netlify(corpo: dict) -> dict:
    return post(NETLIFY, corpo, {"x-token": TOKEN_BRIEF})


def do_supabase_fn(corpo: dict) -> dict:
    return post(FN_SUPABASE, corpo, {"x-token": TOKEN_BRIEF})


# A Management API fica atras do Cloudflare, que barra o urllib do Python com
# 403/1010 (erro ja pago antes -- esta anotado no prompt-mestre). Por isso o SQL
# vai por curl. O corpo passa por arquivo para nao expor a query na linha de
# comando nem esbarrar no limite de tamanho de argumento.
def sql(query: str) -> list:
    import subprocess
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"query": query}, f)
        caminho = f.name
    try:
        r = subprocess.run(
            [
                "curl", "-s", "--fail-with-body", "-m", "120",
                "-X", "POST",
                f"https://api.supabase.com/v1/projects/{REF}/database/query",
                "-H", "Authorization: Bearer " + token_admin(),
                "-H", "Content-Type: application/json",
                "--data-binary", "@" + caminho,
            ],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            raise SystemExit(f"SQL falhou ({r.returncode}): {r.stdout[:300]}{r.stderr[:200]}")
        return json.loads(r.stdout or "[]")
    finally:
        os.unlink(caminho)


# Postgres escapa aspa simples dobrando. O JSON dos briefings tem texto livre
# digitado por vendedor (nome de cliente, observacao) -- sem isto, um apostrofo
# quebraria a instrucao inteira.
def lit(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


# ---------------------------------------------------------------- leitura

def puxar_os() -> list:
    """Todos os briefings, seguindo a paginacao por chave do site antigo."""
    todos, after = [], None
    for _ in range(200):  # guarda: 200 paginas de 150 = 30 mil
        corpo = {"action": "list"}
        if after is not None:
            corpo["after"] = after
        r = do_netlify(corpo)
        todos.extend(r.get("os") or [])
        after = r.get("nextAfter")
        if after is None:
            break
    return todos


def puxar_log() -> list:
    """Log de atividades, do mais recente para o mais antigo."""
    todos, before = [], None
    for _ in range(200):
        corpo = {"action": "listarLog"}
        if before is not None:
            corpo["before"] = before
        r = do_netlify(corpo)
        todos.extend(r.get("logs") or [])
        before = r.get("nextBefore")
        if before is None:
            break
    return todos


def ids_de_fotos(briefings: list) -> list:
    """Toda foto referenciada: itens, croquis e imagens das pranchas."""
    ids = []
    for b in briefings:
        for item in b.get("itens") or []:
            for f in item.get("fotos") or []:
                if f and f.get("id") and not f.get("arquivada"):
                    ids.append(f["id"])
        for c in b.get("croquis") or []:
            if c and c.get("id") and not c.get("arquivada"):
                ids.append(c["id"])
        for v in b.get("pranchas") or []:
            for p in v.get("itens") or []:
                if p and p.get("imagemId"):
                    ids.append(p["imagemId"])
    return sorted(set(ids))


# ---------------------------------------------------------------- gravacao

def gravar_registros(colecao: str, pares: list) -> int:
    """pares = [(id, dict)]. Grava em lotes para nao estourar o tamanho da query."""
    total, LOTE = 0, 50
    for i in range(0, len(pares), LOTE):
        fatia = pares[i : i + LOTE]
        valores = ",".join(
            f"({lit(colecao)}, {lit(str(rid))}, {lit(json.dumps(reg, ensure_ascii=False))}::jsonb)"
            for rid, reg in fatia
        )
        sql(
            "insert into public.brief_registros (colecao, id, registro) values "
            + valores
            + " on conflict (colecao, id) do update set registro = excluded.registro,"
            " atualizado_em = now()"
        )
        total += len(fatia)
    return total


def main() -> None:
    so_conferir = "--conferir" in sys.argv

    print("== lendo do Netlify (site antigo, intocado) ==")
    briefings = puxar_os()
    cfg = (do_netlify({"action": "getCfg"}) or {}).get("cfg") or {}
    log = puxar_log()
    fotos = ids_de_fotos(briefings)
    print(f"   briefings : {len(briefings)}")
    print(f"   log       : {len(log)}")
    print(f"   fotos     : {len(fotos)}")
    print(f"   cfg       : {len(cfg)} chaves")

    if not so_conferir:
        print("\n== gravando no Supabase ==")
        n = gravar_registros("os", [(b["id"], b) for b in briefings if b.get("id")])
        print(f"   briefings gravados: {n}")

        pares_log = []
        for e in log:
            chave = e.get("_chave") or ("log_" + str(e.get("em", "")) + "_" + str(len(pares_log)))
            pares_log.append((chave, e))
        n = gravar_registros("log", pares_log)
        print(f"   log gravado: {n}")

        sql(
            "insert into public.brief_config_global (id, config) values (true, "
            + lit(json.dumps(cfg, ensure_ascii=False))
            + "::jsonb) on conflict (id) do update set config = excluded.config,"
            " atualizado_em = now()"
        )
        print("   cfg gravado")

        # A sequencia precisa comecar ACIMA do maior numero ja usado, senao o
        # proximo briefing criado repetiria um numero existente.
        maior = max([int(b.get("numeroBrief") or 0) for b in briefings] + [0])
        sql(f"select setval('public.brief_numero_seq', {max(maior, 1)}, true)")
        print(f"   sequencia posicionada em {maior} (proximo sera {maior + 1})")

        print("\n== fotos (uma a uma, pela acao putPhoto) ==")
        ok = falhou = 0
        for fid in fotos:
            try:
                r = do_netlify({"action": "getPhoto", "fileId": fid})
                if not r.get("base64"):
                    falhou += 1
                    print(f"   [sem dado] {fid}")
                    continue
                do_supabase_fn(
                    {
                        "action": "putPhoto",
                        "fileId": fid,
                        "base64": r["base64"],
                        "mime": r.get("mime") or "image/jpeg",
                    }
                )
                ok += 1
            except Exception as e:  # foto solta nao derruba a migracao
                falhou += 1
                print(f"   [erro] {fid}: {e}")
        print(f"   fotos migradas: {ok} | falhas: {falhou}")

    print("\n== PORTAO: contagem antiga == contagem nova? ==")
    novo = do_supabase_fn({"action": "armazenamento"})
    n_os = (novo.get("banco") or {}).get("registros")
    n_fotos = (novo.get("fotos") or {}).get("blobsNoServidor")
    print(f"   briefings  Netlify {len(briefings):4d}  ->  Supabase {n_os}")
    print(f"   fotos      Netlify {len(fotos):4d}  ->  Supabase {n_fotos}")
    igual = (n_os == len(briefings)) and (n_fotos == len(fotos))
    print("   " + ("CONFERE" if igual else "DIVERGE -- nao seguir para a virada"))


if __name__ == "__main__":
    main()
