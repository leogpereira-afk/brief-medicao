// ============================================================================
// brief-sync — Edge Function do Brief de Medicao (substitui netlify/functions/os.js)
//
// O CONTRATO DE ACOES E O MESMO do os.js: o app manda { action, ... } com o
// header x-token e recebe a mesma resposta de antes. So o backend mudou:
//   store "os"          -> brief_registros (colecao='os')
//   store "log"         -> brief_registros (colecao='log')
//   store "cfg"         -> brief_config_global (o cfg) + brief_meta (seq_brief)
//   store "integracoes" -> brief_meta
//   store "fotos"       -> bucket brief-arquivos
//
// PROJETO COMPARTILHADO com o RH: o nome desta function PRECISA do prefixo.
// Publicar uma function chamada "sync" sobrescreveria a do RH em producao.
//
// verify_jwt = false de proposito: o preflight CORS chega sem token e o gateway
// do Supabase barraria antes de a funcao rodar. A autorizacao e feita AQUI
// DENTRO, comparando o x-token com o secret BRIEF_TOKEN -- exatamente o que a
// Netlify Function fazia com process.env.TOKEN.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("BRIEF_TOKEN") ?? "";
const JWT_SECRET = Deno.env.get("EQUIPE_JWT_SECRET") ?? "";

// AUTORIZACAO (mudou em 05/08/2026): ate aqui a unica porta era o x-token, e
// ele estava escrito em texto puro no config.js -- arquivo servido ao
// navegador. Quem abrisse o codigo-fonte da pagina lia as medicoes, os
// enderecos e os telefones dos clientes sem login. Mesmo buraco do DRE e do
// PCP, mesmo conserto.
//
//   GENTE   -> Authorization: Bearer <cracha da equipe-auth>, com sis="brief"
//   MAQUINA -> x-token, so para o backup do Hub, que nao faz login
async function lerCracha(token: string): Promise<any | null> {
  if (!JWT_SECRET || !token) return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const enc = new TextEncoder();
    const chave = await crypto.subtle.importKey(
      "raw", enc.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const b64url = (x: string) => {
      x = x.replace(/-/g, "+").replace(/_/g, "/");
      while (x.length % 4) x += "=";
      const bin = atob(x);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };
    const ok = await crypto.subtle.verify(
      "HMAC", chave, b64url(partes[2]), enc.encode(`${partes[0]}.${partes[1]}`));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64url(partes[1])));
    if (typeof p.exp === "number" && p.exp < Math.floor(Date.now() / 1000)) return null;
    if (p.sis !== "brief") return null;
    return p;
  } catch {
    return null;
  }
}
// process.env.URL so existe no Netlify; aqui a URL do site vem de um secret.
const SITE_URL = (Deno.env.get("BRIEF_SITE_URL") ?? "").replace(/\/+$/, "");
const BUCKET = "brief-arquivos";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const resp = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ---------------------------------------------------------------- registros
// Espelham o que o os.js fazia com o store do Blobs, mas em SQL.

async function getReg(colecao: string, id: string): Promise<any | null> {
  const { data } = await sb
    .from("brief_registros")
    .select("registro")
    .eq("colecao", colecao)
    .eq("id", id)
    .maybeSingle();
  return data?.registro ?? null;
}

async function setReg(colecao: string, id: string, registro: any) {
  const { error } = await sb
    .from("brief_registros")
    .upsert(
      { colecao, id, registro, atualizado_em: new Date().toISOString() },
      { onConflict: "colecao,id" },
    );
  if (error) throw new Error(error.message);
}

async function delReg(colecao: string, id: string) {
  await sb.from("brief_registros").delete().eq("colecao", colecao).eq("id", id);
}

// Todos os registros de uma colecao. So use quando precisar mesmo de todos
// (o "list" pagina no banco, que e a graca de ter saido do chave-valor).
async function todosRegs(colecao: string): Promise<any[]> {
  const out: any[] = [];
  const PASSO = 1000;
  for (let de = 0; ; de += PASSO) {
    const { data, error } = await sb
      .from("brief_registros")
      .select("registro")
      .eq("colecao", colecao)
      .order("id")
      .range(de, de + PASSO - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []).map((r: any) => r.registro);
    out.push(...lote);
    if (lote.length < PASSO) break;
  }
  return out;
}

async function contarRegs(colecao: string): Promise<number> {
  const { count } = await sb
    .from("brief_registros")
    .select("id", { count: "exact", head: true })
    .eq("colecao", colecao);
  return count ?? 0;
}

// ---------------------------------------------------------------- meta / cfg

async function getMeta(chave: string): Promise<any | null> {
  const { data } = await sb.from("brief_meta").select("valor").eq("chave", chave).maybeSingle();
  return data?.valor ?? null;
}

async function setMeta(chave: string, valor: any) {
  await sb
    .from("brief_meta")
    .upsert({ chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: "chave" });
}

async function getCfg(): Promise<any> {
  const { data } = await sb.from("brief_config_global").select("config").eq("id", true).maybeSingle();
  return data?.config ?? null;
}

async function setCfgDb(config: any) {
  const { error } = await sb
    .from("brief_config_global")
    .upsert({ id: true, config, atualizado_em: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- fotos
// O contrato com o app continua base64+mime. No bucket guardamos os BYTES de
// verdade (com o content-type certo), em vez de um JSON com base64 dentro:
// ocupa ~25% menos e a imagem fica visivel no painel do Supabase.

// O app manda (e espera de volta) uma DATA URL: "data:image/jpeg;base64,XXXX".
// Ela vai direto para img.src -- devolver so o miolo faz a foto nao aparecer.
// Guardamos os bytes puros e o mime, e remontamos a data url na leitura.
const b64ParaBytes = (b64: string) =>
  Uint8Array.from(atob(b64.includes(",") ? b64.split(",")[1] : b64), (c) => c.charCodeAt(0));

// Le o mime de dentro da propria data url ("data:image/png;base64,..."), que e
// mais confiavel que o campo mime avulso -- ele as vezes nem vem.
function mimeDaDataUrl(b64: string, padrao: string): string {
  const m = /^data:([^;,]+)[;,]/.exec(b64 || "");
  return m ? m[1] : padrao;
}

function bytesParaB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  // Em blocos: string muito grande de uma vez estoura a pilha do apply().
  const BLOCO = 0x8000;
  for (let i = 0; i < bytes.length; i += BLOCO) {
    s += String.fromCharCode(...bytes.subarray(i, i + BLOCO));
  }
  return btoa(s);
}

async function apagarFoto(fileId: string) {
  await sb.storage.from(BUCKET).remove([fileId]).catch(() => {});
}

// ---------------------------------------------------------------- helpers

function fotoIdsDoBriefing(b: any): string[] {
  if (!b) return [];
  const ids: string[] = [];
  for (const item of b.itens ?? []) {
    for (const f of item.fotos ?? []) if (f?.id && !f.arquivada) ids.push(f.id);
  }
  for (const c of b.croquis ?? []) if (c?.id && !c.arquivada) ids.push(c.id);
  for (const v of b.pranchas ?? []) {
    for (const p of v.itens ?? []) if (p?.imagemId) ids.push(p.imagemId);
  }
  return ids;
}

async function registrarLog(entrada: Record<string, unknown>) {
  try {
    const chave = "log_" + new Date().toISOString() + "_" + Math.random().toString(36).slice(2, 6);
    await setReg("log", chave, { em: new Date().toISOString(), ...entrada });
  } catch (e) {
    console.warn("[brief-sync] log falhou:", (e as Error)?.message);
  }
}

// Trava do webhook: o TOKEN que autoriza isso vai no bundle, e a URL e
// cadastravel pelo app -- sem esta checagem daria para mandar dados do cliente
// para dentro da rede/nuvem (as portas de metadados entregam credencial da infra).
function webhookPermitido(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0 || a === 169 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (host === "::1" || host.startsWith("[")) return false;
  const lista = String(Deno.env.get("WEBHOOK_HOSTS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (lista.length && !lista.some((h) => host === h || host.endsWith("." + h))) return false;
  return true;
}

async function dispararWebhook(payload: unknown) {
  try {
    const cfg = await getCfg();
    const url = cfg?.webhookUrl;
    if (!url) return { ok: false, motivo: "sem URL configurada" };
    if (!webhookPermitido(url)) return { ok: false, motivo: "endereço não permitido" };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      return { ok: r.ok, http: r.status };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, erro: (e as Error)?.message ?? String(e) };
  }
}

// Numero do brief. No Blobs era um laco reivindicando num_1, num_2... porque
// nao havia contador atomico. Aqui nextval() ja garante exclusividade entre
// chamadas simultaneas -- mesma promessa, sem laco.
async function proximoNumeroBrief(): Promise<number> {
  const { data, error } = await sb.rpc("brief_proximo_numero");
  if (error) throw new Error("numeracao: " + error.message);
  return Number(data);
}

// ---------------------------------------------------------------- handler


/* ---------------------------------------------------------------- revogacao
   "Esse cracha ainda vale?" -- a pergunta que ESTA porta nao fazia.
   O cracha e um JWT de 30 dias (12h no Painel) guardado no aparelho: assinatura,
   validade e sistema conferiam, e mais nada. Desativar alguem na tela de Acessos
   nao fechava porta nenhuma deste lado ate o cracha vencer.

   A regra mora no BANCO (public.acesso_revogado), e nao num arquivo aqui: as
   portas de dados estao em CINCO repositorios e cada function empacota o proprio
   codigo -- um _shared/revogacao.ts viraria doze copias envelhecendo caladas,
   que e a doenca que esta semana perseguiu. O banco os oito ja dividem.

   Cache de 60s por pessoa: uma consulta por minuto, nao por request.
   Banco fora do ar ACEITA e nao guarda no cache -- trancar a casa inteira por
   causa de uma consulta que falhou e pior do que um cracha durar mais um pouco. */
const CACHE_REVOG = new Map<string, { ate: number; revogado: boolean }>();
async function crachaRevogado(sb: any, sistema: string, cracha: any): Promise<boolean> {
  const sub = String(cracha?.sub ?? "").trim();
  if (!sub) return false;
  const papel = String(cracha?.papel ?? "");
  const chave = `${sistema}:${papel}:${sub}`;
  const agora = Date.now();
  const emCache = CACHE_REVOG.get(chave);
  if (emCache && emCache.ate > agora) return emCache.revogado;
  try {
    const { data, error } = await sb.rpc("acesso_revogado", {
      p_sistema: sistema, p_sub: sub, p_papel: papel,
    });
    if (error) throw new Error(error.message);
    const revogado = data === true;
    CACHE_REVOG.set(chave, { ate: agora + 60_000, revogado });
    return revogado;
  } catch (e) {
    console.error("[revogacao] indisponivel:", (e as Error)?.message);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resp({ error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return resp({ error: "JSON inválido" }, 400);
  }

  const m = String(req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  const cracha = m ? await lerCracha(m[1]) : null;
  if (cracha && await crachaRevogado(sb, "brief", cracha)) {
    return resp({ error: "Seu acesso ao sistema foi encerrado. Fale com a gestão.", semSessao: true }, 401);
  }
  const token = req.headers.get("x-token") ?? body.token;
  const ehMaquina = !!TOKEN && token === TOKEN;
  if (!cracha && !ehMaquina) return resp({ error: "Entre no sistema.", semSessao: true }, 401);

  const action = body.action as string;

  try {
    switch (action) {
      case "ping":
        return resp({ ok: true });

      // Antes testava os dois caminhos de auth do Blobs. Agora responde se o
      // banco e o bucket estao de pe -- mesma finalidade, backend novo.
      case "diag": {
        const out: Record<string, unknown> = { backend: "supabase" };
        try {
          out.banco = "ok (" + (await contarRegs("os")) + " briefings)";
        } catch (e) {
          out.banco = "ERR: " + (e as Error).message;
        }
        try {
          const { data, error } = await sb.storage.from(BUCKET).list("", { limit: 1 });
          out.bucket = error ? "ERR: " + error.message : "ok (" + BUCKET + ", " + (data?.length ?? 0) + "+ arquivos)";
        } catch (e) {
          out.bucket = "ERR: " + (e as Error).message;
        }
        return resp(out);
      }

      // Pagina NO BANCO (antes carregava todas as chaves e fatiava na memoria).
      case "list": {
        const PAGE = 150;
        let q = sb.from("brief_registros").select("id, registro").eq("colecao", "os").order("id").limit(PAGE);
        if (body.after != null) q = q.gt("id", String(body.after));
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const linhas = data ?? [];
        const total = await contarRegs("os");
        const temMais = linhas.length === PAGE;
        return resp({
          os: linhas.map((r: any) => r.registro),
          total,
          nextAfter: temMais && linhas.length ? linhas[linhas.length - 1].id : null,
          nextOffset: null, // paginacao por chave; offset era so compatibilidade
        });
      }

      case "upsert": {
        const os = body.os;
        if (!os?.id) return resp({ error: "Briefing sem id" }, 400);

        const existing = await getReg("os", os.id);
        if (existing?.atualizadoEm && os.atualizadoEm) {
          // Versão-base: o cliente manda o atualizadoEm que ele CONHECIA antes
          // de editar. Se o servidor já tem outra versão, alguém editou no
          // meio -> conflito, mesmo que o carimbo do cliente seja mais novo.
          // (Antes só "servidor mais novo que cliente" disparava; a edição
          // alheia do último minuto era sobrescrita em silêncio.)
          if (typeof body.baseAtualizadoEm === "string" || body.baseAtualizadoEm === null) {
            if (body.baseAtualizadoEm !== existing.atualizadoEm) {
              return resp({ conflito: true, servidor: existing });
            }
          } else if (new Date(existing.atualizadoEm).getTime() > new Date(os.atualizadoEm).getTime()) {
            // Cliente antigo (sem versão-base): critério antigo, retrocompatível.
            return resp({ conflito: true, servidor: existing });
          }
        }

        const toSave = { ...os };
        if (existing?.numeroBrief && !toSave.numeroBrief) toSave.numeroBrief = existing.numeroBrief;
        if (!toSave.numeroBrief && !toSave.avulsa) toSave.numeroBrief = await proximoNumeroBrief();

        await setReg("os", os.id, toSave);

        const quem = toSave.atualizadoPor || "app";
        const base = { briefingId: toSave.id, numero: toSave.numeroBrief ?? null, cliente: toSave.cliente ?? "" };
        // Restauração de backup NÃO é atividade nova: sem esta guarda, importar
        // um arquivo num servidor vazio disparava o webhook "briefing_enviado"
        // (e a linha "enviou pro design") pra CADA briefing enviado do arquivo.
        const restauracao = body.origem === "import";
        const foiEnviado = !restauracao && !toSave.avulsa && !toSave.apagadoEm &&
          toSave.situacao === "enviado" && (!existing || existing.situacao !== "enviado");
        // Upsert que não mudou nada além do carimbo (retry da fila, backup
        // idêntico) não vira linha de log.
        const semCarimbo = (o: any) => JSON.stringify({ ...o, atualizadoEm: 0, atualizadoPor: 0 });
        const igual = existing && semCarimbo(existing) === semCarimbo(toSave);
        if (restauracao) {
          if (!existing) await registrarLog({ quem, acao: "restaurou do backup", ...base });
        } else if (!existing) {
          await registrarLog({ quem, acao: toSave.avulsa ? "criou prancha avulsa" : "criou o briefing", ...base });
        } else if (toSave.apagadoEm && !existing.apagadoEm) {
          await registrarLog({ quem, acao: "moveu pra lixeira", ...base });
        } else if (!toSave.apagadoEm && existing.apagadoEm) {
          await registrarLog({ quem, acao: "restaurou da lixeira", ...base });
        } else if (foiEnviado) {
          await registrarLog({ quem, acao: "enviou pro design", ...base });
        } else if (existing.status !== toSave.status && toSave.status) {
          await registrarLog({ quem, acao: "mudou status: " + (existing.status || "sem status") + " para " + toSave.status, ...base });
        } else if (existing.situacao === "enviado" && !igual) {
          // Coalesce: o autosave grava a cada 2,5s -- sem isto, uma sessão de
          // edição num briefing enviado afogava a tela de atividade.
          const { data: ult } = await sb.from("brief_registros").select("registro").eq("colecao", "log")
            .order("id", { ascending: false }).limit(30);
          const rec = (ult ?? []).map((r: any) => r.registro).find((l: any) =>
            l && l.briefingId === toSave.id && l.quem === quem && l.acao === "editou o briefing");
          const ha10min = rec && rec.em && (Date.now() - new Date(rec.em).getTime()) < 10 * 60 * 1000;
          if (!ha10min) await registrarLog({ quem, acao: "editou o briefing", ...base });
        }

        if (foiEnviado) {
          await dispararWebhook({
            evento: "briefing_enviado",
            briefingId: toSave.id,
            numeroBrief: toSave.numeroBrief ?? null,
            cliente: toSave.cliente ?? "",
            telefone: toSave.telefone ?? "",
            vendedor: toSave.vendedor ?? "",
            tipoMedicao: toSave.tipoMedicao ?? "",
            status: toSave.status ?? "",
            osNumero: toSave.osNumero ?? "",
            semOS: !toSave.osNumero,
            qtdItens: (toSave.itens ?? []).length,
            designer: toSave.designerAtribuido?.nome ?? "",
            designerUsuario: toSave.designerAtribuido?.usuario ?? "",
            url: SITE_URL ? SITE_URL + "/#/b/" + toSave.id : "",
            em: new Date().toISOString(),
          });
        }

        return resp({ ok: true, os: toSave });
      }

      case "delete": {
        const id = body.id;
        if (!id) return resp({ error: "id ausente" }, 400);
        const existing = await getReg("os", id);
        if (existing) {
          const ids = fotoIdsDoBriefing(existing);
          if (ids.length) await sb.storage.from(BUCKET).remove(ids).catch(() => {});
        }
        await delReg("os", id);
        await registrarLog({
          quem: body._quem || "app",
          acao: "apagou definitivamente",
          briefingId: id,
          numero: existing?.numeroBrief ?? null,
          cliente: existing?.cliente ?? "",
        });
        return resp({ ok: true });
      }

      // Reposiciona a sequencia. limparClaims nao existe mais: nao ha chaves
      // num_N para limpar -- a sequencia e um contador so.
      case "ajustarSeq": {
        const ultimo = Math.max(0, Number(body.ultimo) || 0);
        const { error } = await sb.rpc("brief_ajustar_numero", { novo_ultimo: ultimo });
        if (error) throw new Error(error.message);
        await setMeta("seq_brief", { ultimo, em: new Date().toISOString(), ajustadoPor: body._quem || "admin" });
        return resp({ ok: true, ultimo });
      }

      case "getCfg":
        return resp({ cfg: (await getCfg()) ?? {} });

      case "setCfg": {
        if (!body.cfg) return resp({ error: "cfg ausente" }, 400);
        // O ELENCO NÃO É DO APP. Quem manda em cfg.usuarios é a equipe-auth,
        // que reescreve a lista (sem senha nenhuma) a cada mudança de conta.
        // O app manda o pacote de configuração INTEIRO ao salvar Fichas ou
        // Configurações -- e mandaria junto a lista velha, ressuscitando as
        // senhas em texto puro que acabamos de tirar daqui. Então o que vier
        // do app nesse campo é descartado: vale sempre o que já está no banco.
        const atualCfg = (await getCfg()) ?? {};
        const cfgLimpo = { ...body.cfg };
        if ("usuarios" in atualCfg) cfgLimpo.usuarios = (atualCfg as any).usuarios;
        else delete cfgLimpo.usuarios;
        await setCfgDb(cfgLimpo);
        if (body._quem) await registrarLog({ quem: body._quem, acao: "alterou configurações" });
        return resp({ ok: true });
      }

      case "putPhoto": {
        const { base64, mime, fileId } = body;
        if (!base64) return resp({ error: "base64 ausente" }, 400);
        const id = fileId || "foto_" + Date.now() + "_" + Math.random().toString(36).slice(2);
        const tipo = mimeDaDataUrl(base64, mime || "image/jpeg");
        const { error } = await sb.storage
          .from(BUCKET)
          .upload(id, b64ParaBytes(base64), { contentType: tipo, upsert: true });
        if (error) throw new Error("upload: " + error.message);
        return resp({ fileId: id });
      }

      case "deletePhoto": {
        if (!body.fileId) return resp({ error: "fileId ausente" }, 400);
        await apagarFoto(body.fileId);
        return resp({ ok: true });
      }

      case "getPhoto": {
        const fileId = body.fileId;
        if (!fileId) return resp({ error: "fileId ausente" }, 400);
        const { data, error } = await sb.storage.from(BUCKET).download(fileId);
        if (error || !data) return resp({ error: "Foto não encontrada" }, 404);
        const tipo = data.type || "image/jpeg";
        // Devolve a DATA URL completa, como o os.js devolvia: o app joga este
        // valor em img.src. Sem o prefixo, a foto some da tela.
        return resp({ base64: `data:${tipo};base64,${bytesParaB64(await data.arrayBuffer())}`, mime: tipo });
      }

      case "saude": {
        const totalOS = await contarRegs("os");
        const manut = await getMeta("manutencao_status");
        return resp({ ok: true, totalOS, ultimaManutencao: manut });
      }

      case "armazenamento": {
        const todos = await todosRegs("os");
        let bancoBytes = 0, fotosBytes = 0, fotosQtd = 0, lixeira = 0;
        const porMes: Record<string, number> = {};
        const porBriefing: any[] = [];

        for (const b of todos) {
          const jsonBytes = JSON.stringify(b).length;
          bancoBytes += jsonBytes;
          let fb = 0, fq = 0;
          for (const item of b.itens ?? []) {
            for (const f of item.fotos ?? []) if (f && !f.arquivada) { fb += f.bytes || 0; fq++; }
          }
          for (const c of b.croquis ?? []) if (c && !c.arquivada) { fb += c.bytes || 0; fq++; }
          for (const v of b.pranchas ?? []) {
            fb += v.bytes || 0;
            for (const p of v.itens ?? []) if (p?.imagemId) fq++;
          }
          fotosBytes += fb; fotosQtd += fq;
          if (b.apagadoEm) lixeira++;
          const mes = String(b.criadoEm ?? "").slice(0, 7) || "sem data";
          porMes[mes] = (porMes[mes] ?? 0) + jsonBytes + fb;
          porBriefing.push({
            id: b.id, cliente: b.cliente || "Sem nome", criadoEm: b.criadoEm || "",
            status: b.status || "", bytes: jsonBytes + fb, naLixeira: !!b.apagadoEm,
          });
        }

        const { data: arquivos } = await sb.storage.from(BUCKET).list("", { limit: 10000 });
        porBriefing.sort((a, z) => z.bytes - a.bytes);

        return resp({
          banco: { bytes: bancoBytes, registros: todos.length },
          fotos: { bytes: fotosBytes, quantidade: fotosQtd, blobsNoServidor: arquivos?.length ?? 0 },
          lixeira,
          porMes: Object.keys(porMes).sort().map((m) => ({ mes: m, bytes: porMes[m] })),
          maiores: porBriefing.slice(0, 10),
        });
      }

      case "listarLog": {
        const PAGE = 100;
        let q = sb.from("brief_registros").select("id, registro").eq("colecao", "log")
          .order("id", { ascending: false }).limit(PAGE);
        if (body.before != null) q = q.lt("id", String(body.before));
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const linhas = data ?? [];
        return resp({
          logs: linhas.map((r: any) => r.registro),
          nextBefore: linhas.length === PAGE ? linhas[linhas.length - 1].id : null,
        });
      }

      case "limpezaFotos": {
        const meses = Math.max(1, Number(body.meses) || 6);
        const corte = new Date(Date.now() - meses * 30 * 24 * 60 * 60 * 1000).toISOString();
        const todos = await todosRegs("os");
        let briefingsLimpos = 0, fotosApagadas = 0, bytesLiberados = 0;

        for (const b of todos) {
          if (!b || b.apagadoEm) continue;
          if (b.status !== "Concluído") continue;
          const ref = b.enviadoEm || b.criadoEm || "";
          if (!ref || ref >= corte) continue;

          let mexeu = false;
          const paraApagar: string[] = [];
          const arquivar = (f: any) => {
            if (!f?.id || f.arquivada) return;
            paraApagar.push(f.id);
            bytesLiberados += f.bytes || 0;
            f.arquivada = true;
            fotosApagadas++;
            mexeu = true;
          };
          for (const item of b.itens ?? []) for (const f of item.fotos ?? []) arquivar(f);
          for (const c of b.croquis ?? []) arquivar(c);
          for (const v of b.pranchas ?? []) {
            for (const p of v.itens ?? []) {
              if (p?.imagemId && !p.imagemArquivada) {
                paraApagar.push(p.imagemId);
                p.imagemArquivada = true;
                fotosApagadas++;
                mexeu = true;
              }
            }
          }

          if (mexeu) {
            if (paraApagar.length) await sb.storage.from(BUCKET).remove(paraApagar).catch(() => {});
            b.atualizadoEm = new Date().toISOString();
            b.atualizadoPor = "Limpeza (" + (body._quem || "admin") + ")";
            await setReg("os", b.id, b);
            briefingsLimpos++;
          }
        }

        await registrarLog({
          quem: body._quem || "admin",
          acao: "limpeza em lote: " + fotosApagadas + " foto(s) de " + briefingsLimpos +
            " briefing(s) concluído(s) há mais de " + meses + " meses",
        });
        return resp({ ok: true, briefingsLimpos, fotosApagadas, bytesLiberados });
      }

      case "purgarLixeira": {
        const dias = Math.max(1, Number(body.dias) || 30);
        const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
        const todos = await todosRegs("os");
        let purgados = 0;
        for (const b of todos) {
          if (!b?.apagadoEm || b.apagadoEm >= corte) continue;
          const ids = fotoIdsDoBriefing(b);
          if (ids.length) await sb.storage.from(BUCKET).remove(ids).catch(() => {});
          await delReg("os", b.id);
          purgados++;
        }
        if (purgados) {
          await registrarLog({
            quem: body._quem || "sistema",
            acao: "lixeira purgada: " + purgados + " briefing(s) com mais de " + dias + " dias",
          });
        }
        return resp({ ok: true, purgados });
      }

      case "testarWebhook": {
        let url = body.url;
        if (!url) url = (await getCfg())?.webhookUrl;
        if (!url) return resp({ ok: false, motivo: "Nenhuma URL de webhook configurada" });
        if (!webhookPermitido(url)) {
          return resp({ ok: false, motivo: "Endereço não permitido. Use um endereço https público (o do n8n)." });
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ evento: "teste", origem: "Brief de Medição", em: new Date().toISOString() }),
            signal: ctrl.signal,
          });
          return resp({ ok: r.ok, http: r.status });
        } catch (e) {
          return resp({ ok: false, erro: (e as Error)?.message ?? String(e) });
        } finally {
          clearTimeout(timer);
        }
      }

      // Manutencao diaria (substitui a scheduled function "manutencao" do
      // Netlify, que rodava @daily). Chamada pelo pg_cron -- ver a migration
      // 0004. Faz as tres coisas que a antiga fazia, na mesma ordem.
      case "manutencao": {
        const DIAS_LIXEIRA = 30;
        const DIAS_LOG = 90;
        const agora = Date.now();
        const corteLixeira = new Date(agora - DIAS_LIXEIRA * 864e5).toISOString();
        const corteLog = new Date(agora - DIAS_LOG * 864e5).toISOString();

        let purgados = 0;
        let logsRemovidos = 0;
        try {
          // 1) Lixeira: briefing apagado ha mais de 30 dias some de vez, com as
          // fotos junto -- e o que a tela do admin promete ao usuario.
          for (const b of await todosRegs("os")) {
            if (!b?.apagadoEm || b.apagadoEm >= corteLixeira) continue;
            const ids = fotoIdsDoBriefing(b);
            if (ids.length) await sb.storage.from(BUCKET).remove(ids).catch(() => {});
            await delReg("os", b.id);
            purgados++;
          }

          // 2) Log antigo. As chaves sao "log_<ISO>_<sufixo>", entao a
          // comparacao de texto ja resolve a data -- e o banco apaga em lote,
          // sem precisar carregar entrada por entrada como o Blobs exigia.
          const { count } = await sb
            .from("brief_registros")
            .delete({ count: "exact" })
            .eq("colecao", "log")
            .lt("id", "log_" + corteLog);
          logsRemovidos = count ?? 0;

          // 3) Batimento: a acao "saude" le isto para mostrar no painel quando
          // a ultima manutencao rodou. Sem ele, ninguem percebe se o cron parar.
          await setMeta("manutencao_status", {
            em: new Date().toISOString(),
            ok: true,
            purgados,
            logsRemovidos,
          });
          return resp({ ok: true, purgados, logsRemovidos });
        } catch (e) {
          // Falha tambem e registrada: um cron que quebra em silencio e pior
          // que um cron que nao existe.
          await setMeta("manutencao_status", {
            em: new Date().toISOString(),
            ok: false,
            erro: (e as Error)?.message ?? String(e),
          }).catch(() => {});
          throw e;
        }
      }

      // Manutencao diaria. No Netlify era uma function agendada a parte
      // (manutencao.mjs, @daily); aqui e uma acao chamada pelo pg_cron. Faz as
      // mesmas tres coisas: purga a lixeira vencida, apara o log velho e deixa
      // o batimento que a tela de saude le.
      case "manutencao": {
        const DIAS_LIXEIRA = 30;
        const DIAS_LOG = 90;
        const agora = Date.now();
        const corteLixeira = new Date(agora - DIAS_LIXEIRA * 864e5).toISOString();
        const corteLog = new Date(agora - DIAS_LOG * 864e5).toISOString();

        let purgados = 0;
        let logsRemovidos = 0;
        try {
          for (const b of await todosRegs("os")) {
            if (!b?.apagadoEm || b.apagadoEm >= corteLixeira) continue;
            const ids = fotoIdsDoBriefing(b);
            if (ids.length) await sb.storage.from(BUCKET).remove(ids).catch(() => {});
            await delReg("os", b.id);
            purgados++;
          }

          // As chaves do log sao "log_<ISO>_<sufixo>": no Postgres da para apagar
          // por faixa de chave numa tacada, em vez de varrer registro a registro.
          const { count } = await sb
            .from("brief_registros")
            .delete({ count: "exact" })
            .eq("colecao", "log")
            .lt("id", "log_" + corteLog);
          logsRemovidos = count ?? 0;

          await setMeta("manutencao_status", {
            em: new Date().toISOString(), ok: true, purgados, logsRemovidos,
          });
          console.log(`[manutencao] lixeira: ${purgados}; log: ${logsRemovidos}`);
          return resp({ ok: true, purgados, logsRemovidos });
        } catch (e) {
          // Grava a falha no batimento: a tela de saude precisa mostrar que a
          // manutencao parou, senao ela morre em silencio por meses.
          await setMeta("manutencao_status", {
            em: new Date().toISOString(), ok: false, erro: (e as Error)?.message ?? String(e),
          }).catch(() => {});
          throw e;
        }
      }

      default:
        return resp({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (e) {
    console.error("[brief-sync] erro:", e);
    return resp({ error: (e as Error)?.message ?? "Erro interno" }, 500);
  }
});
