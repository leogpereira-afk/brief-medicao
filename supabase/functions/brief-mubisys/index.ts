// ============================================================================
// brief-mubisys — Edge Function (substitui netlify/functions/mubisys.js)
//
// Busca uma O.S pelo numero para preencher o briefing sozinho. Ordem:
//   1. API do Mubisys direto (credenciais cadastradas no Painel de Controle)
//   2. App PCP, que ja importa as O.S do Mubisys de hora em hora
//   3. Nada encontrado -> o app cai na digitacao manual
//
// De-para: store "integracoes" chave "mubisys" -> brief_meta chave "mubisys".
//
// ATENCAO (dependencia cruzada): o PCP ainda esta no Netlify. BRIEF_PCP_URL
// aponta para la. Quando o PCP migrar, este segredo TEM que ser atualizado --
// senao o segundo caminho de busca morre calado e o vendedor volta a digitar
// tudo na mao sem ninguem perceber.
//
// verify_jwt = false: o preflight CORS chega sem token. A autorizacao e feita
// aqui dentro, comparando x-token com BRIEF_TOKEN (o mesmo do brief-sync).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("BRIEF_TOKEN") ?? "";
const PCP_URL = Deno.env.get("BRIEF_PCP_URL") ?? "";
const PCP_TOKEN = Deno.env.get("BRIEF_PCP_TOKEN") ?? "";
const DEFAULT_BASE = "https://api.mubisys.com/api";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const resp = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Hosts em que e seguro mandar o Access-Token do Mubisys.
//
// O `base` e cadastravel pelo app, e o token que autoriza esse cadastro esta no
// bundle (autenticacao leve, decisao consciente). Sem esta trava, quem tivesse
// o token podia apontar o `base` para o proprio servidor e o Brief entregaria a
// credencial do ERP -- um alvo muito maior que o proprio Brief.
function baseConfiavel(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const envBase = String(Deno.env.get("BRIEF_MUBISYS_BASE") ?? "").trim();
  if (envBase) {
    try {
      if (new URL(envBase).host === u.host) return true;
    } catch { /* env mal formada nao derruba a checagem */ }
  }
  const host = u.host.toLowerCase();
  return host === "mubisys.com" || host.endsWith(".mubisys.com");
}

async function getMeta(chave: string): Promise<any | null> {
  const { data } = await sb.from("brief_meta").select("valor").eq("chave", chave).maybeSingle();
  return data?.valor ?? null;
}

async function setMeta(chave: string, valor: unknown) {
  await sb.from("brief_meta").upsert(
    { chave, valor, atualizado_em: new Date().toISOString() },
    { onConflict: "chave" },
  );
}

async function getCreds() {
  const cfg = (await getMeta("mubisys")) ?? {};
  const baseBruta = String(cfg.base || Deno.env.get("BRIEF_MUBISYS_BASE") || DEFAULT_BASE).replace(/\/+$/, "");
  // Base fora da lista: cai no padrao em vez de vazar a credencial.
  const base = baseConfiavel(baseBruta) ? baseBruta : DEFAULT_BASE;
  if (base !== baseBruta) console.warn("[brief-mubisys] base recusada:", baseBruta);
  return {
    publicKey: cfg.publicKey || Deno.env.get("BRIEF_MUBISYS_PUBLIC_KEY") || "",
    accessToken: cfg.accessToken || Deno.env.get("BRIEF_MUBISYS_TOKEN") || "",
    base,
    status: cfg.status || "PRODUCAO",
  };
}

// Sinal fraco ou API fora nao pode segurar a function ate o teto.
async function fetchTimeout(url: string, opts: RequestInit = {}, ms = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const pick = (obj: any, ...keys: string[]) => {
  if (!obj) return "";
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== "") return v;
  }
  return "";
};

function normalizarItens(lista: any): any[] {
  if (!Array.isArray(lista)) return [];
  return lista
    .map((it: any) => {
      if (!it || typeof it !== "object") return null;
      const descricao = String(pick(it, "descricao", "produto", "nome", "item_descricao", "nome_produto") || "").trim();
      let medidas = String(pick(it, "medidas", "medida", "dimensoes") || "").trim();
      if (!medidas) {
        const larg = pick(it, "largura", "larg");
        const alt = pick(it, "altura", "alt");
        if (larg && alt) medidas = String(larg) + "x" + String(alt);
      }
      const qtde = String(pick(it, "qtde", "quantidade", "qtd", "quant") || "1").trim();
      if (!descricao && !medidas) return null;
      return { descricao, medidas, qtde };
    })
    .filter(Boolean)
    .slice(0, 60); // teto de seguranca para O.S. gigante
}

function extrairLista(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  if (data?.data) return [data.data];
  return [];
}

function extrairUm(data: any): any {
  if (data?.data && !Array.isArray(data.data)) return data.data;
  return extrairLista(data)[0] || data || {};
}

function montarEndereco(c: any): string {
  c = c || {};
  const direto = pick(c, "enderecoCompleto", "endereco");
  if (direto && typeof direto === "string") return direto;
  return [
    pick(c, "logradouro", "rua"),
    pick(c, "numero"),
    pick(c, "complemento"),
    pick(c, "bairro"),
    pick(c, "cep") ? "CEP: " + pick(c, "cep") : "",
    [pick(c, "cidade", "municipio"), pick(c, "estado", "uf")].filter(Boolean).join(" - "),
  ].filter(Boolean).join(" - ");
}

function mapearMubisys(o: any) {
  o = o || {};
  const contato = (Array.isArray(o.cliente_contato) && o.cliente_contato[0]) || {};
  const endereco = (Array.isArray(o.cliente_endereco) && o.cliente_endereco[0]) || {};
  return {
    numero: String(pick(o, "sequencial_ordem", "numero", "numeroOS", "codigo") || ""),
    cliente: typeof o.cliente === "string" ? o.cliente : pick(o.cliente || {}, "nome", "razaoSocial"),
    contato: pick(contato, "nome_contato", "nome", "contato", "responsavel"),
    telefone: pick(contato, "celular", "telefone", "whatsapp", "fone"),
    endereco: montarEndereco(endereco),
    servico: pick(o, "nome_trabalho", "referencia", "titulo", "descricao"),
    vendedor: pick(o, "vendedor", "atendente", "vendedorNome"),
    itens: normalizarItens(o.itens || o.produtos || o.ordem_servico_itens || o.itens_ordem),
  };
}

async function buscarNoPCP(numero: string) {
  const base = PCP_URL.replace(/\/+$/, "");
  // BRIEF_PCP_URL pode ser o site antigo (Netlify: monta o caminho da function)
  // ou o endpoint NOVO completo (Edge Function: usa como esta). Aceitar os dois
  // e o que permitiu trocar o secret na virada sem tocar em codigo de novo.
  const url = base.includes("/functions/v1/") ? base : base + "/.netlify/functions/os";
  let after: unknown = null;
  for (let guard = 0; guard < 50; guard++) {
    const r = await fetchTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-token": PCP_TOKEN },
      body: JSON.stringify(after != null ? { action: "list", after } : { action: "list" }),
    });
    if (!r.ok) throw new Error("PCP HTTP " + r.status);
    const data = await r.json().catch(() => null);
    if (!data || !Array.isArray(data.os)) return null;
    const achou = data.os.find((o: any) => o && String(o.numero || "").trim() === numero);
    if (achou) {
      return {
        numero: String(achou.numero || numero),
        cliente: achou.cliente || "",
        contato: achou.contato || "",
        telefone: achou.whatsapp || "",
        endereco: achou.endereco || "",
        servico: achou.servico || "",
        vendedor: achou.vendedor || "",
        itens: normalizarItens(achou.itens),
      };
    }
    if (data.nextAfter != null) after = data.nextAfter;
    else return null;
  }
  return null;
}


// Confere o cracha da pessoa: assinatura (HS256 com o EQUIPE_JWT_SECRET),
// validade e de QUAL sistema ele e -- cracha de outro sistema nao abre este.
const JWT_SECRET_EQUIPE = Deno.env.get("EQUIPE_JWT_SECRET") ?? "";
async function lerCracha(token: string): Promise<any | null> {
  if (!JWT_SECRET_EQUIPE || !token) return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const enc = new TextEncoder();
    const chave = await crypto.subtle.importKey(
      "raw", enc.encode(JWT_SECRET_EQUIPE), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const b64url = (t: string) => {
      t = t.replace(/-/g, "+").replace(/_/g, "/");
      while (t.length % 4) t += "=";
      const bin = atob(t);
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resp({ error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return resp({ error: "JSON inválido" }, 400);
  }

  /* DUAS FORMAS DE ENTRAR, como no brief-sync.
     Antes so o x-token valia -- e ele vinha do config.js, que era publico. Ao
     tirar o segredo do bundle (o app passou a mandar so o cracha), esta porta
     ficou fechada para as PESSOAS: a busca de O.S. respondia 401 para todo
     mundo. O x-token continua, agora so para maquina. */
  const m = String(req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  const cracha = m ? await lerCracha(m[1]) : null;
  const token = req.headers.get("x-token") ?? body.token;
  const ehMaquina = !!TOKEN && token === TOKEN;
  if (!cracha && !ehMaquina) return resp({ error: "Entre no sistema.", semSessao: true }, 401);

  try {
    if (body.action === "salvarConfig") {
      const atual = (await getMeta("mubisys")) ?? {};
      // Recusa base fora dos hosts confiaveis ja na gravacao, para o admin ver o
      // erro em vez de a busca cair calada no padrao.
      if (body.base && String(body.base).trim() && !baseConfiavel(String(body.base).trim().replace(/\/+$/, ""))) {
        return resp({ error: "Endereço do Mubisys não permitido. Use o endereço oficial (…mubisys.com)." }, 400);
      }
      await setMeta("mubisys", {
        // Vazio significa "mantem o atual" (nao apaga a chave). Sem isto, salvar
        // o formulario em branco -- o que acontecia sem internet -- zerava tudo.
        publicKey: (body.publicKey ? String(body.publicKey).trim() : atual.publicKey) || "",
        accessToken: (body.accessToken ? String(body.accessToken).trim() : atual.accessToken) || "",
        base: (body.base ? String(body.base).trim() : atual.base) || "",
        status: body.status || atual.status || "PRODUCAO",
      });
      return resp({ ok: true });
    }

    if (body.action === "statusConfig") {
      const c = await getCreds();
      const t = c.accessToken || "";
      return resp({
        mubisysConfigurado: !!(c.publicKey && c.accessToken),
        pcpConfigurado: !!(PCP_URL && PCP_TOKEN),
        publicKey: c.publicKey,
        base: c.base,
        status: c.status,
        tokenMascarado: t ? "•".repeat(Math.max(0, t.length - 4)) + t.slice(-4) : "",
      });
    }

    if (body.action === "buscarOS") {
      const numero = String(body.numero ?? "").trim();
      if (!numero) return resp({ error: "numero ausente" }, 400);

      const creds = await getCreds();
      const fontes = {
        mubisys: !!(creds.publicKey && creds.accessToken),
        pcp: !!(PCP_URL && PCP_TOKEN),
      };

      if (fontes.mubisys) {
        try {
          const url = `${creds.base}/${creds.publicKey}/ordem-servico/numero/${encodeURIComponent(numero)}`;
          const r = await fetchTimeout(url, {
            headers: { "Access-Token": creds.accessToken, Accept: "application/json" },
          });
          const data = await r.json().catch(() => null);
          if (r.ok) {
            const os = mapearMubisys(extrairUm(data));
            if (os && (os.cliente || os.numero)) {
              return resp({ encontrado: true, origem: "mubisys", os: { ...os, numero: os.numero || numero } });
            }
          }
        } catch (e) {
          console.warn("[brief-mubisys] busca direta falhou:", (e as Error)?.message);
        }
      }

      if (fontes.pcp) {
        try {
          const os = await buscarNoPCP(numero);
          if (os) return resp({ encontrado: true, origem: "pcp", os });
        } catch (e) {
          console.warn("[brief-mubisys] fallback PCP falhou:", (e as Error)?.message);
        }
      }

      return resp({ encontrado: false, fontes });
    }

    return resp({ error: `Ação desconhecida: ${body.action}` }, 400);
  } catch (e) {
    return resp({ error: (e as Error)?.message ?? "Erro interno" }, 500);
  }
});
