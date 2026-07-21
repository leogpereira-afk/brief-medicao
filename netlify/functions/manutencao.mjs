// Netlify Scheduled Function (Functions 2.0/ESM) — manutenção diária:
//   1. Purga da lixeira: briefings apagados há mais de 30 dias somem de vez
//      (registro + fotos), como prometido na tela do admin.
//   2. Faxina do log de atividades: entradas com mais de 90 dias.
//   3. Batimento cardíaco em integracoes/manutencao_status (lido pela ação "saude").
// Agendamento em netlify.toml: [functions."manutencao"] schedule = "@daily"
//
// O runtime injeta o contexto do Netlify Blobs sozinho (nada de token manual).
import { getStore } from '@netlify/blobs';

const DIAS_LIXEIRA = 30;
const DIAS_LOG = 90;

export default async () => {
  try {
    const agora = Date.now();
    const corteLixeira = new Date(agora - DIAS_LIXEIRA * 24 * 60 * 60 * 1000).toISOString();
    const corteLog = new Date(agora - DIAS_LOG * 24 * 60 * 60 * 1000).toISOString();

    // ── 1) Lixeira ────────────────────────────────────────────────────────
    const store = getStore('os');
    const fotosStore = getStore('fotos');
    const keys = await allKeys(store);
    let purgados = 0;
    for (const k of keys) {
      const b = await store.get(k, { type: 'json' }).catch(() => null);
      if (!b || !b.apagadoEm || b.apagadoEm >= corteLixeira) continue;
      const fotoIds = [];
      for (const item of (b.itens || [])) {
        for (const f of (item.fotos || [])) if (f && f.id && !f.arquivada) fotoIds.push(f.id);
      }
      for (const c of (b.croquis || [])) if (c && c.id && !c.arquivada) fotoIds.push(c.id);
      await Promise.all(fotoIds.map(fid => fotosStore.delete(fid).catch(() => {})));
      await store.delete(b.id);
      purgados++;
    }

    // ── 2) Log antigo ─────────────────────────────────────────────────────
    // As chaves são "log_<ISO>_<sufixo>": comparação de string resolve a data.
    const logStore = getStore('log');
    const logKeys = await allKeys(logStore);
    let logsRemovidos = 0;
    for (const k of logKeys) {
      if (k.startsWith('log_') && k.slice(4, 24) < corteLog.slice(0, 20)) {
        await logStore.delete(k).catch(() => {});
        logsRemovidos++;
      }
    }

    // ── 3) Batimento cardíaco ─────────────────────────────────────────────
    await getStore('integracoes').setJSON('manutencao_status', {
      em: new Date().toISOString(), ok: true, purgados, logsRemovidos
    }).catch(() => {});

    console.log(`[manutencao] lixeira: ${purgados} purgado(s); log: ${logsRemovidos} removido(s).`);
    return Response.json({ ok: true, purgados, logsRemovidos });
  } catch (e) {
    console.error('[manutencao] erro:', e);
    try {
      await getStore('integracoes').setJSON('manutencao_status', {
        em: new Date().toISOString(), ok: false, erro: String((e && e.message) || e)
      });
    } catch {}
    return Response.json({ error: e.message || 'Erro interno' }, { status: 500 });
  }
};

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
    if (++guard > 5000) { console.warn('[manutencao] allKeys: guard atingido'); break; }
  } while (cursor);
  return keys;
}
