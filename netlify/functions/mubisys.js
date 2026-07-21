// Netlify Function — endpoint /.netlify/functions/mubisys
// Busca uma O.S pelo número para preencher o briefing automaticamente.
//
// Ordem de busca:
//   1. API do Mubisys direto (credenciais cadastradas no Painel de Controle →
//      Integração Mubisys, guardadas no store "integracoes" do Blobs, que nunca
//      vai para o navegador; fallback nas envs MUBISYS_PUBLIC_KEY/MUBISYS_TOKEN/MUBISYS_BASE)
//   2. App PCP da Impresilk (pcpimpresilk), que já importa as O.S do Mubisys de
//      hora em hora — envs PCP_URL + PCP_TOKEN
//   3. Nada encontrado → o app cai na digitação manual com aviso
//
// A chamada do próprio app é protegida pelo mesmo TOKEN de os.js.

const { getStore, connectLambda } = require('@netlify/blobs');

const DEFAULT_BASE = 'https://api.mubisys.com/api';

// Contexto do Blobs vem do runtime (connectLambda no handler). O caminho manual
// via BLOBS_SITE_ID/BLOBS_TOKEN fica só de fallback — o token pessoal expira.
let _blobsConectado = false;
function blobStore(name) {
  if (_blobsConectado) return getStore(name);
  const siteID = process.env.BLOBS_SITE_ID;
  const token  = process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token });
  return getStore(name);
}

// Resolve as credenciais: primeiro o cadastro feito no app, depois env vars.
async function getCreds() {
  let cfg = null;
  try { cfg = await blobStore('integracoes').get('mubisys', { type: 'json' }); } catch {}
  cfg = cfg || {};
  return {
    publicKey:   cfg.publicKey   || process.env.MUBISYS_PUBLIC_KEY || '',
    accessToken: cfg.accessToken || process.env.MUBISYS_TOKEN || '',
    base:        ((cfg.base || process.env.MUBISYS_BASE || DEFAULT_BASE)).replace(/\/+$/, ''),
    status:      cfg.status || 'PRODUCAO'
  };
}

exports.handler = async (event) => {
  try { connectLambda(event); _blobsConectado = true; } catch { _blobsConectado = false; }

  if (event.httpMethod !== 'POST') return resp({ error: 'Method not allowed' }, 405);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return resp({ error: 'JSON inválido' }, 400); }

  // Autenticação do app (mesma de os.js)
  const token = (event.headers && event.headers['x-token']) || body.token;
  if (!process.env.TOKEN || token !== process.env.TOKEN) {
    return resp({ error: 'Não autorizado' }, 401);
  }

  const { action } = body;

  try {
    // ── salvarConfig: cadastra/atualiza as credenciais (vindas do app) ────────
    if (action === 'salvarConfig') {
      const store = blobStore('integracoes');
      const atual = (await store.get('mubisys', { type: 'json' }).catch(() => null)) || {};
      const novo = {
        publicKey: (body.publicKey != null ? String(body.publicKey).trim() : atual.publicKey) || '',
        // Se o token vier vazio, mantém o que já estava (permite editar só a publicKey)
        accessToken: (body.accessToken ? String(body.accessToken).trim() : atual.accessToken) || '',
        base: (body.base ? String(body.base).trim() : atual.base) || '',
        status: body.status || atual.status || 'PRODUCAO'
      };
      await store.setJSON('mubisys', novo);
      return resp({ ok: true });
    }

    // ── statusConfig: diz o que está configurado (sem expor o token) ─────────
    if (action === 'statusConfig') {
      const c = await getCreds();
      const t = c.accessToken || '';
      return resp({
        mubisysConfigurado: !!(c.publicKey && c.accessToken),
        pcpConfigurado: !!(process.env.PCP_URL && process.env.PCP_TOKEN),
        publicKey: c.publicKey,
        base: c.base,
        status: c.status,
        tokenMascarado: t ? ('•'.repeat(Math.max(0, t.length - 4)) + t.slice(-4)) : ''
      });
    }

    // ── buscarOS: procura a O.S pelo número (Mubisys → PCP → nada) ───────────
    if (action === 'buscarOS') {
      const numero = String(body.numero || '').trim();
      if (!numero) return resp({ error: 'numero ausente' }, 400);

      const creds = await getCreds();
      const fontes = {
        mubisys: !!(creds.publicKey && creds.accessToken),
        pcp: !!(process.env.PCP_URL && process.env.PCP_TOKEN)
      };

      // 1) Mubisys direto
      if (fontes.mubisys) {
        try {
          const url = `${creds.base}/${creds.publicKey}/ordem-servico/numero/${encodeURIComponent(numero)}`;
          const r = await fetchTimeout(url, { headers: { 'Access-Token': creds.accessToken, 'Accept': 'application/json' } });
          const data = await r.json().catch(() => null);
          if (r.ok) {
            const os = mapearMubisys(extrairUm(data));
            if (os && (os.cliente || os.numero)) {
              return resp({ encontrado: true, origem: 'mubisys', os: { ...os, numero: os.numero || numero } });
            }
          }
        } catch (e) {
          console.warn('[mubisys] busca direta falhou:', e && e.message);
        }
      }

      // 2) Fallback: app PCP (já tem as O.S importadas do Mubisys)
      if (fontes.pcp) {
        try {
          const os = await buscarNoPCP(numero);
          if (os) return resp({ encontrado: true, origem: 'pcp', os });
        } catch (e) {
          console.warn('[mubisys] fallback PCP falhou:', e && e.message);
        }
      }

      return resp({ encontrado: false, fontes });
    }

    return resp({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    return resp({ error: e.message || 'Erro interno' }, 500);
  }
};

// fetch com timeout (sinal fraco/API fora não pode segurar a function até o teto)
async function fetchTimeout(url, opts = {}, ms = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Percorre a lista paginada do PCP procurando a O.S pelo número.
async function buscarNoPCP(numero) {
  const base = String(process.env.PCP_URL || '').replace(/\/+$/, '');
  const url = base + '/.netlify/functions/os';
  let after = null;
  let guard = 0;
  while (guard++ < 50) {
    const r = await fetchTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-token': process.env.PCP_TOKEN },
      body: JSON.stringify(after != null ? { action: 'list', after } : { action: 'list' })
    });
    if (!r.ok) throw new Error('PCP HTTP ' + r.status);
    const data = await r.json().catch(() => null);
    if (!data || !Array.isArray(data.os)) return null;
    const achou = data.os.find(o => o && String(o.numero || '').trim() === numero);
    if (achou) {
      return {
        numero: String(achou.numero || numero),
        cliente: achou.cliente || '',
        contato: achou.contato || '',
        telefone: achou.whatsapp || '',
        endereco: achou.endereco || '',
        servico: achou.servico || '',
        vendedor: achou.vendedor || ''
      };
    }
    if (data.nextAfter != null) after = data.nextAfter;
    else return null;
  }
  return null;
}

// ── Helpers de extração (mesmos do conector do PCP) ─────────────────────────
function extrairLista(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.results)) return data.results;
  if (data && data.data) return [data.data];
  return [];
}
function extrairUm(data) {
  if (data && data.data && !Array.isArray(data.data)) return data.data;
  const l = extrairLista(data);
  return l[0] || data || {};
}
function pick(obj, ...keys) {
  if (!obj) return '';
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== '') return v;
  }
  return '';
}
function montarEndereco(c) {
  c = c || {};
  const direto = pick(c, 'enderecoCompleto', 'endereco');
  if (direto && typeof direto === 'string') return direto;
  const partes = [
    pick(c, 'logradouro', 'rua'),
    pick(c, 'numero'),
    pick(c, 'complemento'),
    pick(c, 'bairro'),
    pick(c, 'cep') ? 'CEP: ' + pick(c, 'cep') : '',
    [pick(c, 'cidade', 'municipio'), pick(c, 'estado', 'uf')].filter(Boolean).join(' - ')
  ].filter(Boolean);
  return partes.join(' - ');
}

// Mapeia a O.S crua do Mubisys para o que o briefing precisa.
// Nomes de campo confirmados via "preview" com dados reais no conector do PCP.
function mapearMubisys(o) {
  o = o || {};
  const contato  = (Array.isArray(o.cliente_contato)  && o.cliente_contato[0])  || {};
  const endereco = (Array.isArray(o.cliente_endereco) && o.cliente_endereco[0]) || {};
  return {
    numero:   String(pick(o, 'sequencial_ordem', 'numero', 'numeroOS', 'codigo') || ''),
    cliente:  typeof o.cliente === 'string' ? o.cliente : pick(o.cliente || {}, 'nome', 'razaoSocial'),
    contato:  pick(contato, 'nome_contato', 'nome', 'contato', 'responsavel'),
    telefone: pick(contato, 'celular', 'telefone', 'whatsapp', 'fone'),
    endereco: montarEndereco(endereco),
    servico:  pick(o, 'nome_trabalho', 'referencia', 'titulo', 'descricao'),
    vendedor: pick(o, 'vendedor', 'atendente', 'vendedorNome')
  };
}

function resp(data, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  };
}
