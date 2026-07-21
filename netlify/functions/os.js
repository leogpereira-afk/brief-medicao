// Netlify Function — endpoint /.netlify/functions/os
// Backend: Netlify Blobs (stores: "os", "fotos", "cfg", "log", "integracoes")
// Autenticação leve: header x-token ou corpo.token === process.env.TOKEN
//
// Neste app cada registro do store "os" é um BRIEFING de medição:
//   { id, situacao: 'rascunho'|'enviado', status, cliente, itens: [{ fotos: [{id,...}] }],
//     croquis: [{id,...}], apagadoEm (lixeira), criadoEm/Por, atualizadoEm/Por, ... }

const { getStore, connectLambda } = require('@netlify/blobs');

// Abre um store do Netlify Blobs usando o contexto injetado pelo runtime
// (via connectLambda no início do handler). O caminho manual com
// BLOBS_SITE_ID/BLOBS_TOKEN fica só como fallback — o token pessoal expira
// (foi o que derrubou a sincronização em 30/06/2026).
let _blobsConectado = false;
function blobStore(name) {
  if (_blobsConectado) return getStore(name);
  const siteID = process.env.BLOBS_SITE_ID;
  const token  = process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token });
  return getStore(name);
}

// Todas as fotos referenciadas por um briefing (itens + croquis).
function fotoIdsDoBriefing(b) {
  if (!b) return [];
  const ids = [];
  for (const item of (b.itens || [])) {
    for (const f of (item.fotos || [])) if (f && f.id && !f.arquivada) ids.push(f.id);
  }
  for (const c of (b.croquis || [])) if (c && c.id && !c.arquivada) ids.push(c.id);
  return ids;
}

// Registro no log de atividades (store "log", uma chave por evento, ordenável
// por data). Falha de log nunca derruba a operação principal.
async function registrarLog(entrada) {
  try {
    const key = 'log_' + new Date().toISOString() + '_' + Math.random().toString(36).slice(2, 6);
    await blobStore('log').setJSON(key, { em: new Date().toISOString(), ...entrada });
  } catch (e) {
    console.warn('[os.js] log falhou:', e && e.message);
  }
}

// Dispara o webhook (n8n) configurado no cfg. Timeout curto pra não segurar
// a resposta do upsert; erro vira log, não erro pro cliente.
async function dispararWebhook(payload) {
  try {
    const cfg = await blobStore('cfg').get('cfg', { type: 'json' }).catch(() => null);
    const url = cfg && cfg.webhookUrl;
    if (!url) return { ok: false, motivo: 'sem URL configurada' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      return { ok: r.ok, http: r.status };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.warn('[os.js] webhook falhou:', e && e.message);
    return { ok: false, erro: (e && e.message) || String(e) };
  }
}

exports.handler = async (event, context) => {
  // Conecta o contexto do Blobs que o runtime envia no evento (Lambda v1).
  try { connectLambda(event); _blobsConectado = true; } catch { _blobsConectado = false; }

  if (event.httpMethod !== 'POST') {
    return resp({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return resp({ error: 'JSON inválido' }, 400);
  }

  const token = (event.headers && event.headers['x-token']) || body.token;
  if (!process.env.TOKEN || token !== process.env.TOKEN) {
    return resp({ error: 'Não autorizado' }, 401);
  }

  const { action } = body;

  try {
    switch (action) {

      // ── ping ────────────────────────────────────────────────────────────────
      case 'ping':
        return resp({ ok: true });

      // ── diag: testa os dois caminhos de autenticação do Netlify Blobs ──────
      // (contexto automático do runtime × manual via BLOBS_SITE_ID/BLOBS_TOKEN)
      // Não expõe segredos — só diz qual caminho funciona.
      case 'diag': {
        const out = { env: {
          siteId: !!process.env.BLOBS_SITE_ID,
          token: !!process.env.BLOBS_TOKEN,
          tokenLen: (process.env.BLOBS_TOKEN || '').length
        } };
        try {
          const s = getStore('os');
          const r = await s.list();
          out.auto = 'ok (' + ((r && r.blobs) ? r.blobs.length : '?') + ' chaves)';
        } catch (e) { out.auto = 'ERR: ' + ((e && (e.message || e.name)) || e); }
        try {
          const s = getStore({ name: 'os', siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
          const r = await s.list();
          out.manual = 'ok (' + ((r && r.blobs) ? r.blobs.length : '?') + ' chaves)';
        } catch (e) { out.manual = 'ERR: ' + ((e && (e.message || e.name)) || e); }
        return resp(out);
      }

      // ── list: retorna os briefings em páginas ───────────────────────────────
      // Paginado para a resposta nunca passar do limite de ~6 MB das Netlify
      // Functions. O cliente percorre as páginas usando "after"/"nextAfter".
      case 'list': {
        const store = blobStore('os');
        const PAGE = 150; // registros completos por resposta (margem folgada vs. 6 MB)

        const keys = (await allKeys(store)).sort();
        // Paginação por CHAVE ("after"): estável quando registros são criados ou
        // apagados entre páginas (o offset numérico deslocava o corte e podia
        // pular um registro — que o cliente então apagava do cache local achando
        // que ele sumiu do servidor). "offset" segue aceito p/ clientes antigos.
        let inicio;
        if (body.after != null) {
          inicio = keys.findIndex(k => k > String(body.after));
          if (inicio < 0) inicio = keys.length;
        } else {
          inicio = Math.max(0, Number(body.offset) || 0);
        }
        const slice = keys.slice(inicio, inicio + PAGE);
        const items = await Promise.all(
          slice.map(k => store.get(k, { type: 'json' }).catch(() => null))
        );
        const fim = inicio + slice.length;
        return resp({
          os: items.filter(Boolean),
          total: keys.length,
          nextAfter: fim < keys.length && slice.length ? slice[slice.length - 1] : null,
          nextOffset: fim < keys.length ? fim : null
        });
      }

      // ── upsert: grava/atualiza um briefing (com detecção de conflito) ───────
      case 'upsert': {
        const store = blobStore('os');
        const { os } = body;
        if (!os || !os.id) return resp({ error: 'Briefing sem id' }, 400);

        const existing = await store.get(os.id, { type: 'json' }).catch(() => null);
        if (existing && existing.atualizadoEm && os.atualizadoEm) {
          const tsServer = new Date(existing.atualizadoEm).getTime();
          const tsClient = new Date(os.atualizadoEm).getTime();
          if (tsServer > tsClient) {
            return resp({ conflito: true, servidor: existing });
          }
        }

        // Preserva o atualizadoEm do autor. Reescrever com o relógio do
        // servidor misturava duas fontes de tempo: bastava o relógio do
        // aparelho atrasar para o próprio autor receber "conflito" na
        // edição seguinte.
        const toSave = { ...os };

        // Numeração do brief: o servidor atribui o número sequencial na
        // primeira sincronização (aparelhos offline não têm como combinar
        // números entre si sem conflito) e preserva o número já atribuído
        // mesmo se algum aparelho mandar uma versão sem ele.
        if (existing && existing.numeroBrief && !toSave.numeroBrief) {
          toSave.numeroBrief = existing.numeroBrief;
        }
        if (!toSave.numeroBrief) {
          toSave.numeroBrief = await proximoNumeroBrief(store);
        }

        await store.setJSON(os.id, toSave);

        // Eventos derivados da transição (log + webhook), sem travar a resposta
        // em caso de falha de log/webhook.
        const quem = toSave.atualizadoPor || 'app';
        const base = { briefingId: toSave.id, numero: toSave.numeroBrief || null, cliente: toSave.cliente || '' };
        const foiEnviado = toSave.situacao === 'enviado' && (!existing || existing.situacao !== 'enviado');
        if (!existing) {
          await registrarLog({ quem, acao: 'criou o briefing', ...base });
        } else if (toSave.apagadoEm && !existing.apagadoEm) {
          await registrarLog({ quem, acao: 'moveu pra lixeira', ...base });
        } else if (!toSave.apagadoEm && existing.apagadoEm) {
          await registrarLog({ quem, acao: 'restaurou da lixeira', ...base });
        } else if (foiEnviado) {
          await registrarLog({ quem, acao: 'enviou pro design', ...base });
        } else if (existing.status !== toSave.status && toSave.status) {
          await registrarLog({ quem, acao: 'mudou status: ' + (existing.status || 'sem status') + ' para ' + toSave.status, ...base });
        } else if (existing.situacao === 'enviado') {
          // Rascunho salva sozinho a cada campo; logar cada autosave viraria ruído.
          // Só edição de briefing JÁ ENVIADO entra no log.
          await registrarLog({ quem, acao: 'editou o briefing', ...base });
        }

        if (foiEnviado) {
          const base = (process.env.URL || '').replace(/\/+$/, '');
          await dispararWebhook({
            evento: 'briefing_enviado',
            briefingId: toSave.id,
            numeroBrief: toSave.numeroBrief || null,
            cliente: toSave.cliente || '',
            telefone: toSave.telefone || '',
            vendedor: toSave.vendedor || '',
            tipoMedicao: toSave.tipoMedicao || '',
            status: toSave.status || '',
            osNumero: toSave.osNumero || '',
            semOS: !toSave.osNumero,
            qtdItens: (toSave.itens || []).length,
            url: base ? base + '/#/b/' + toSave.id : '',
            em: new Date().toISOString()
          });
        }

        return resp({ ok: true, os: toSave });
      }

      // ── delete: remove briefing e suas fotos (exclusão DEFINITIVA) ──────────
      // A lixeira de 30 dias é o campo apagadoEm gravado via upsert; esta ação
      // é o passo final (admin com confirmação dupla, ou purga automática).
      case 'delete': {
        const store = blobStore('os');
        const fotosStore = blobStore('fotos');
        const { id } = body;
        if (!id) return resp({ error: 'id ausente' }, 400);

        // Apaga fotos do briefing (itens + croquis)
        const existing = await store.get(id, { type: 'json' }).catch(() => null);
        if (existing) {
          const fotoIds = fotoIdsDoBriefing(existing);
          await Promise.all(fotoIds.map(fid => fotosStore.delete(fid).catch(() => {})));
        }

        await store.delete(id);
        await registrarLog({
          quem: body._quem || 'app', acao: 'apagou definitivamente',
          briefingId: id, numero: (existing && existing.numeroBrief) || null,
          cliente: (existing && existing.cliente) || ''
        });
        return resp({ ok: true });
      }

      // ── ajustarSeq: acerta o contador da numeração do brief (manutenção) ───
      case 'ajustarSeq': {
        const ultimo = Math.max(0, Number(body.ultimo) || 0);
        await blobStore('cfg').setJSON('seq_brief', {
          ultimo, em: new Date().toISOString(), ajustadoPor: body._quem || 'admin'
        });
        return resp({ ok: true, ultimo });
      }

      // ── getCfg / setCfg ─────────────────────────────────────────────────────
      case 'getCfg': {
        const store = blobStore('cfg');
        const cfg = await store.get('cfg', { type: 'json' }).catch(() => null);
        return resp({ cfg: cfg || {} });
      }

      case 'setCfg': {
        const store = blobStore('cfg');
        if (!body.cfg) return resp({ error: 'cfg ausente' }, 400);
        await store.setJSON('cfg', body.cfg);
        if (body._quem) {
          await registrarLog({ quem: body._quem, acao: 'alterou configurações' });
        }
        return resp({ ok: true });
      }

      // ── putPhoto: grava foto (base64) ───────────────────────────────────────
      case 'putPhoto': {
        const store = blobStore('fotos');
        const { base64, mime, fileId } = body;
        if (!base64) return resp({ error: 'base64 ausente' }, 400);
        const id = fileId || ('foto_' + Date.now() + '_' + Math.random().toString(36).slice(2));
        await store.setJSON(id, { base64, mime: mime || 'image/jpeg' });
        return resp({ fileId: id });
      }

      // ── deletePhoto: remove foto individual (excluída/substituída no app) ──
      case 'deletePhoto': {
        const store = blobStore('fotos');
        const { fileId } = body;
        if (!fileId) return resp({ error: 'fileId ausente' }, 400);
        await store.delete(fileId).catch(() => {});
        return resp({ ok: true });
      }

      // ── getPhoto: recupera foto ─────────────────────────────────────────────
      case 'getPhoto': {
        const store = blobStore('fotos');
        const { fileId } = body;
        if (!fileId) return resp({ error: 'fileId ausente' }, 400);
        const foto = await store.get(fileId, { type: 'json' }).catch(() => null);
        if (!foto) return resp({ error: 'Foto não encontrada' }, 404);
        return resp({ base64: foto.base64, mime: foto.mime });
      }

      // ── saude: visão geral p/ o painel "Saúde da conexão" do app ───────────
      case 'saude': {
        const store = blobStore('os');
        const keys = await allKeys(store);
        const integ = blobStore('integracoes');
        const manut = await integ.get('manutencao_status', { type: 'json' }).catch(() => null);
        return resp({ ok: true, totalOS: keys.length, ultimaManutencao: manut });
      }

      // ── armazenamento: números p/ o painel do admin ─────────────────────────
      // Os briefings são JSON pequenos: carregamos todos e somamos. O peso das
      // fotos vem do campo bytes gravado pelo app no upload (evita baixar os
      // blobs); a contagem real de blobs de foto confere se há órfãos.
      case 'armazenamento': {
        const store = blobStore('os');
        const keys = await allKeys(store);
        const todos = (await Promise.all(
          keys.map(k => store.get(k, { type: 'json' }).catch(() => null))
        )).filter(Boolean);

        let bancoBytes = 0;
        let fotosBytes = 0;
        let fotosQtd = 0;
        const porMes = {};
        const porBriefing = [];
        let lixeira = 0;

        for (const b of todos) {
          const jsonBytes = JSON.stringify(b).length;
          bancoBytes += jsonBytes;
          let fb = 0, fq = 0;
          for (const item of (b.itens || [])) {
            for (const f of (item.fotos || [])) {
              if (f && !f.arquivada) { fb += (f.bytes || 0); fq++; }
            }
          }
          for (const c of (b.croquis || [])) {
            if (c && !c.arquivada) { fb += (c.bytes || 0); fq++; }
          }
          fotosBytes += fb; fotosQtd += fq;
          if (b.apagadoEm) lixeira++;
          const mes = String(b.criadoEm || '').slice(0, 7) || 'sem data';
          if (!porMes[mes]) porMes[mes] = 0;
          porMes[mes] += jsonBytes + fb;
          porBriefing.push({
            id: b.id, cliente: b.cliente || 'Sem nome', criadoEm: b.criadoEm || '',
            status: b.status || '', bytes: jsonBytes + fb, naLixeira: !!b.apagadoEm
          });
        }

        const fotosStoreKeys = await allKeys(blobStore('fotos'));
        porBriefing.sort((a, z) => z.bytes - a.bytes);

        return resp({
          banco: { bytes: bancoBytes, registros: todos.length },
          fotos: { bytes: fotosBytes, quantidade: fotosQtd, blobsNoServidor: fotosStoreKeys.length },
          lixeira,
          porMes: Object.keys(porMes).sort().map(m => ({ mes: m, bytes: porMes[m] })),
          maiores: porBriefing.slice(0, 10)
        });
      }

      // ── listarLog: log de atividades, mais recente primeiro ────────────────
      case 'listarLog': {
        const store = blobStore('log');
        const PAGE = 100;
        const keys = (await allKeys(store)).sort().reverse();
        let inicio = 0;
        if (body.before != null) {
          inicio = keys.findIndex(k => k < String(body.before));
          if (inicio < 0) inicio = keys.length;
        }
        const slice = keys.slice(inicio, inicio + PAGE);
        const logs = (await Promise.all(
          slice.map(k => store.get(k, { type: 'json' }).catch(() => null))
        )).filter(Boolean);
        return resp({
          logs,
          nextBefore: (inicio + slice.length) < keys.length && slice.length ? slice[slice.length - 1] : null
        });
      }

      // ── limpezaFotos: apaga fotos de briefings concluídos há mais de X meses,
      // mantendo os dados (as fotos ficam marcadas como arquivadas) ───────────
      case 'limpezaFotos': {
        const meses = Math.max(1, Number(body.meses) || 6);
        const corte = new Date(Date.now() - meses * 30 * 24 * 60 * 60 * 1000).toISOString();
        const store = blobStore('os');
        const fotosStore = blobStore('fotos');
        const keys = await allKeys(store);
        let briefingsLimpos = 0;
        let fotosApagadas = 0;
        let bytesLiberados = 0;

        for (const k of keys) {
          const b = await store.get(k, { type: 'json' }).catch(() => null);
          if (!b || b.apagadoEm) continue;
          if (b.status !== 'Concluído') continue;
          const ref = b.enviadoEm || b.criadoEm || '';
          if (!ref || ref >= corte) continue;

          let mexeu = false;
          const arquivar = async (f) => {
            if (!f || !f.id || f.arquivada) return;
            await fotosStore.delete(f.id).catch(() => {});
            bytesLiberados += (f.bytes || 0);
            f.arquivada = true;
            fotosApagadas++;
            mexeu = true;
          };
          for (const item of (b.itens || [])) {
            for (const f of (item.fotos || [])) await arquivar(f);
          }
          for (const c of (b.croquis || [])) await arquivar(c);

          if (mexeu) {
            b.atualizadoEm = new Date().toISOString();
            b.atualizadoPor = 'Limpeza (' + (body._quem || 'admin') + ')';
            await store.setJSON(b.id, b);
            briefingsLimpos++;
          }
        }

        await registrarLog({
          quem: body._quem || 'admin',
          acao: 'limpeza em lote: ' + fotosApagadas + ' foto(s) de ' + briefingsLimpos + ' briefing(s) concluído(s) há mais de ' + meses + ' meses'
        });
        return resp({ ok: true, briefingsLimpos, fotosApagadas, bytesLiberados });
      }

      // ── purgarLixeira: exclusão definitiva do que passou do prazo ───────────
      // (também roda sozinha todo dia pela function agendada "manutencao")
      case 'purgarLixeira': {
        const dias = Math.max(1, Number(body.dias) || 30);
        const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
        const store = blobStore('os');
        const fotosStore = blobStore('fotos');
        const keys = await allKeys(store);
        let purgados = 0;
        for (const k of keys) {
          const b = await store.get(k, { type: 'json' }).catch(() => null);
          if (!b || !b.apagadoEm || b.apagadoEm >= corte) continue;
          const fotoIds = fotoIdsDoBriefing(b);
          await Promise.all(fotoIds.map(fid => fotosStore.delete(fid).catch(() => {})));
          await store.delete(b.id);
          purgados++;
        }
        if (purgados) {
          await registrarLog({ quem: body._quem || 'sistema', acao: 'lixeira purgada: ' + purgados + ' briefing(s) com mais de ' + dias + ' dias' });
        }
        return resp({ ok: true, purgados });
      }

      // ── testarWebhook: dispara um POST de teste na URL configurada ─────────
      case 'testarWebhook': {
        let url = body.url;
        if (!url) {
          const cfg = await blobStore('cfg').get('cfg', { type: 'json' }).catch(() => null);
          url = cfg && cfg.webhookUrl;
        }
        if (!url) return resp({ ok: false, motivo: 'Nenhuma URL de webhook configurada' });
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ evento: 'teste', origem: 'Brief de Medição', em: new Date().toISOString() }),
            signal: ctrl.signal
          });
          return resp({ ok: r.ok, http: r.status });
        } catch (e) {
          return resp({ ok: false, erro: (e && e.message) || String(e) });
        } finally {
          clearTimeout(timer);
        }
      }

      default:
        return resp({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (e) {
    console.error('[os.js] erro:', e);
    const msg = (e && (e.message || e.name)) || 'Erro interno';
    return resp({ error: msg, tipo: e && e.name }, 500);
  }
};

// Próximo número sequencial do brief, à prova de corrida.
//
// O contador vive em cfg/seq_brief. Duas Netlify Functions podem rodar ao mesmo
// tempo (dois vendedores criando brief no mesmo instante): um "lê 1, grava 2" de
// cada lado geraria número DUPLICADO. Por isso o incremento usa escrita
// condicional do Netlify Blobs (compare-and-swap por etag): só grava se o etag
// não mudou desde a leitura; se outro incrementou no meio, relê e tenta de novo.
// O piso no maior número já existente é rede de segurança caso o contador se perca.
async function proximoNumeroBrief(osStore) {
  const cfgStore = blobStore('cfg');

  // Piso: maior número já atribuído nos registros (defasado pela consistência
  // eventual da listagem, mas o contador com etag é a fonte primária).
  let piso = 0;
  try {
    const keys = await allKeys(osStore);
    const todos = await Promise.all(keys.map(k => osStore.get(k, { type: 'json' }).catch(() => null)));
    for (const b of todos) {
      if (b && Number(b.numeroBrief) > piso) piso = Number(b.numeroBrief);
    }
  } catch {}

  for (let tentativa = 0; tentativa < 30; tentativa++) {
    let atual = 0;
    let etag = null;
    try {
      const meta = await cfgStore.getWithMetadata('seq_brief', { type: 'json' });
      if (meta) { atual = Number(meta.data && meta.data.ultimo) || 0; etag = meta.etag; }
    } catch {}
    const proximo = Math.max(atual, piso) + 1;
    const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    let res;
    try {
      res = await cfgStore.set('seq_brief', JSON.stringify({ ultimo: proximo, em: new Date().toISOString() }), opts);
    } catch {
      continue; // conflito de escrita condicional → outra função ganhou; tenta de novo
    }
    if (res && res.modified) return proximo; // ganhamos a corrida deste incremento
    // res.modified === false: etag mudou (ou a chave já existia) → relê e repete
  }

  // Salvaguarda extrema (não deve acontecer): grava sem condição a partir do piso.
  const fallback = piso + 1;
  try { await cfgStore.setJSON('seq_brief', { ultimo: fallback, em: new Date().toISOString() }); } catch {}
  return fallback;
}

// Coleta TODAS as chaves do store percorrendo o cursor de paginação do Netlify
// Blobs. Retorna só os ids (leve), sem baixar o conteúdo de cada registro.
async function allKeys(store) {
  const keys = [];
  let cursor;
  let guard = 0;
  do {
    const page = await store.list(cursor ? { cursor } : undefined);
    if (page && Array.isArray(page.blobs)) {
      for (const b of page.blobs) keys.push(b.key);
    }
    cursor = page && page.cursor;
    if (++guard > 5000) { console.warn('[os.js] allKeys: guard atingido'); break; }
  } while (cursor);
  return keys;
}

function resp(data, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  };
}
