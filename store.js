// store.js — Camada única de persistência e sincronização
// Todo acesso a dado passa por aqui. Depende de config.js (TOKEN).

const STORE = (() => {
  // ── Chaves localStorage ────────────────────────────────────────────────────
  const K = {
    OS:         'app_sync_os',
    CFG:        'app_sync_cfg',
    USER:       'app_sync_user',
    LEMBRADO:   'app_sync_usuario_lembrado',
    INSTALADOR: 'app_sync_instalador',
    FILA:       'app_sync_fila',
    LASTSYNC:   'app_sync_lastsync'
  };

  // ── IndexedDB (fotos) ──────────────────────────────────────────────────────
  let _db = null;

  function _openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('app_sync', 1);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore('fotos', { keyPath: 'id' });
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function putFoto(id, base64, mime) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('fotos', 'readwrite');
      tx.objectStore('fotos').put({ id, base64, mime: mime || 'image/jpeg' });
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function getFoto(id) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('fotos', 'readonly');
      const req = tx.objectStore('fotos').get(id);
      req.onsuccess = e => resolve(e.target.result || null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function delFoto(id) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('fotos', 'readwrite');
      tx.objectStore('fotos').delete(id);
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // ── localStorage helpers ───────────────────────────────────────────────────
  function lsGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v !== null ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  }

  function lsSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        console.error('[store] QuotaExceededError em', key);
        _notifyListeners('quota', null);
      }
    }
  }

  // ── CRUD de O.S (cache local) ─────────────────────────────────────────────
  // "OS" aqui é a entidade genérica do kit; neste app, cada registro é um briefing.
  function getAllOS() {
    return lsGet(K.OS, []);
  }

  function getOS(id) {
    return getAllOS().find(o => o.id === id) || null;
  }

  function _setAllOS(arr) {
    lsSet(K.OS, arr);
  }

  // Salva (cria ou atualiza) uma O.S offline-first
  function saveOS(os) {
    const all = getAllOS();
    const idx = all.findIndex(o => o.id === os.id);
    if (idx >= 0) all[idx] = os;
    else all.push(os);
    _setAllOS(all);
    _enqueue({ action: 'upsert', os });
    trySync();
  }

  function deleteOS(id, quem) {
    _setAllOS(getAllOS().filter(o => o.id !== id));
    _enqueue({ action: 'delete', id, _quem: quem || '' });
    trySync();
  }

  // ── CFG ───────────────────────────────────────────────────────────────────
  const CFG_DEFAULT = {
    // Usuários do app: { id, nome, usuario, senha, papel: 'vendedor'|'designer'|'admin', ativo }
    usuarios: [],
    // Dicas exibidas ao marcar cada superfície (editáveis no painel do admin)
    dicas: {
      'Alvenaria': 'Conferir reboco ou pintura recente antes de definir a fixação.',
      'Drywall': 'Checar estrutura metálica por trás, não aguenta peso sem reforço.',
      'Madeira': 'Verificar tratamento e sinal de cupim.',
      'Metal': 'Checar oxidação e a melhor forma de fixação.',
      'Pedra lisa': 'Fixação química funciona bem, atenção a rachaduras.',
      'Pedra irregular': 'Mais de um ponto de fixação, textura pode exigir folga.',
      'Vidro': 'Nunca furar, avaliar adesivo especial ou perfil de fixação.',
      'Concreto aparente': 'Fixação robusta, atenção a fissuras.',
      'Sinalização/ACM existente': 'Avaliar o estado da estrutura atual e como a peça nova será fixada sobre ela.',
      'Telha': 'Confirmar o tipo de telha e a estrutura de apoio por baixo, telha sozinha não segura peso.'
    },
    // Listas editáveis no painel do admin (tipos vindos da spec + grupos da ficha de visita)
    tiposItem: ['Letreiro frontal', 'Fachada em lona', 'Fachada ACM', 'Letreiro direto na parede', 'Luminoso', 'Totem', 'Adesivo', 'Adesivo de veículo', 'Papel de parede', 'Placa', 'Banner', 'Envelopamento', 'Outro'],
    // Quais fotos são OBRIGATÓRIAS em cada tipo de item. Adesivo de parede
    // resolve com uma foto; letreiro e totem precisam do conjunto todo.
    // Tipo que não estiver aqui usa fotosPadrao. Editável no painel do admin.
    fotosPadrao: ['fachada', 'close', 'escala'],
    fotosPorTipo: {
      'Adesivo': ['fachada'],
      'Papel de parede': ['fachada'],
      'Adesivo de veículo': ['fachada'],
      'Banner': ['fachada'],
      'Placa': ['fachada', 'close']
    },
    superficies: ['Alvenaria', 'Drywall', 'Madeira', 'Metal', 'Pedra lisa', 'Pedra irregular', 'Vidro', 'Concreto aparente', 'Sinalização/ACM existente', 'Telha', 'Outro'],
    // Webhook (n8n) chamado pelo servidor quando um briefing é enviado pro design
    webhookUrl: '',

    // ── Prancha (gerador de layout) ────────────────────────────────────────
    // Contatos da empresa que saem no cabeçalho da prancha (admin edita)
    empresa: {
      nome: 'Impresilk Soluções Visuais',
      instagram: '@impresilk',
      whatsapp: '(38) 99878-0021',
      telefone: '(38) 3223-5477',
      endereco: 'Av. Feliciano Martins de Freitas, 127 | Vila Regina | Montes Claros - MG',
      email: 'site@impresilk.com.br'
    },
    // Setores de produção: cada um marcado vira uma prancha
    setoresProducao: ['Instalação', 'Router', 'Fibra letra caixa', 'Laser C02', 'Serralheria',
      'Impressão lona', 'Impressão vinil', 'Impressão UV', 'Laser brindes', 'Ploter papel outdoor'],
    // Tipos de serviço do selo laranja
    tiposServico: ['Instalação', 'Router', 'Fibra letra caixa', 'Laser C02', 'Serralheria',
      'Impressão lona', 'Impressão vinil', 'Impressão UV', 'Laser brindes', 'Ploter papel outdoor',
      'Retirada', 'Manutenção', 'Entrega'],
    // Texto fixo de direitos autorais no rodapé do cabeçalho
    textoDireitos: 'Este desenho, protegido pela legislação de direitos autorais, é de propriedade exclusiva da empresa Impresilk Comunicação Visual. Não pode ser usado, copiado ou cedido, de forma parcial ou integral, fora dos termos contratuais.'
  };

  function getCFG() {
    return Object.assign({}, CFG_DEFAULT, lsGet(K.CFG, {}));
  }

  function saveCFG(cfg, quem) {
    lsSet(K.CFG, cfg);
    _enqueue({ action: 'setCfg', cfg, _quem: quem || '' });
    trySync();
  }

  // ── Fila offline ──────────────────────────────────────────────────────────
  function getQueue() { return lsGet(K.FILA, []); }

  function _enqueue(item) {
    let q = getQueue();
    // Deduplica upserts da mesma O.S
    if (item.action === 'upsert') {
      const i = q.findIndex(x => x.action === 'upsert' && x.os.id === item.os.id);
      if (i >= 0) { q[i] = item; lsSet(K.FILA, q); return; }
    }
    // Quando deleta uma O.S, descarta upserts pendentes dela (não faz sentido
    // mandar uma versão "atualizada" de algo que vai ser apagado em seguida).
    if (item.action === 'delete') {
      q = q.filter(x => !(x.action === 'upsert' && x.os && x.os.id === item.id));
      // Se já existe um delete pra mesma id na fila, evita duplicar.
      if (q.some(x => x.action === 'delete' && x.id === item.id)) {
        lsSet(K.FILA, q);
        return;
      }
    }
    // Deletar uma foto descarta o upload pendente dela (senão o servidor
    // recebe o put depois do delete e a foto "excluída" ressuscita lá).
    if (item.action === 'deletePhoto') {
      q = q.filter(x => !(x.action === 'putPhoto' && x.fileId === item.fileId));
      if (q.some(x => x.action === 'deletePhoto' && x.fileId === item.fileId)) {
        lsSet(K.FILA, q);
        return;
      }
    }
    q.push(item);
    lsSet(K.FILA, q);
  }

  // Assinatura estável de um item da fila (independe da referência do objeto).
  // Necessária porque getQueue() re-parseia o localStorage e cria objetos novos,
  // então comparar por referência (x !== item) nunca removeria nada.
  function _sigFila(item) {
    if (!item) return '';
    if (item.action === 'upsert')      return 'upsert:'  + (item.os && item.os.id);
    if (item.action === 'delete')      return 'delete:'  + item.id;
    if (item.action === 'putPhoto')    return 'putPhoto:' + item.fileId;
    if (item.action === 'deletePhoto') return 'deletePhoto:' + item.fileId;
    if (item.action === 'setCfg')      return 'setCfg';
    return JSON.stringify(item);
  }

  function _removeFromQueue(item) {
    const sig = _sigFila(item);
    let removido = false;
    const q = getQueue().filter(x => {
      if (!removido && _sigFila(x) === sig) {
        // Upsert: só remove se for a MESMA versão que foi enviada. Se o
        // usuário salvou de novo durante o envio, a fila contém uma versão
        // mais nova — mantê-la para o próximo ciclo (senão a edição feita
        // durante o sync em voo se perderia sem aviso).
        if (item.action === 'upsert' && x.os && item.os && x.os.atualizadoEm !== item.os.atualizadoEm) {
          return true;
        }
        removido = true;
        return false;
      }
      return true;
    });
    lsSet(K.FILA, q);
  }

  // ── Chamada à API ─────────────────────────────────────────────────────────
  async function api(body) {
    return apiFn('os', body);
  }

  // Chama qualquer Netlify Function do projeto (os, mubisys, …) com timeout.
  async function apiFn(fn, body, timeoutMs = 15000) {
    // Timeout: em sinal fraco, navigator.onLine pode ser true mas o fetch trava.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch('/.netlify/functions/' + fn, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': TOKEN },
        body:    JSON.stringify(body),
        signal:  ctrl.signal
      });
      if (!res.ok && res.status !== 409) {
        throw new Error('HTTP ' + res.status);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Sync state ────────────────────────────────────────────────────────────
  let _syncing = false;
  let _syncListeners      = [];
  let _conflictListeners  = [];
  let _genericListeners   = {};

  function onSync(fn)     { _syncListeners.push(fn); }
  function onConflict(fn) { _conflictListeners.push(fn); }

  function _notifySync(status, pending) {
    _syncListeners.forEach(fn => { try { fn(status, pending); } catch {} });
  }

  function _notifyConflict(local, remote) {
    _conflictListeners.forEach(fn => { try { fn(local, remote); } catch {} });
  }

  function _notifyListeners(event, data) {
    (_genericListeners[event] || []).forEach(fn => { try { fn(data); } catch {} });
  }

  function on(event, fn) {
    if (!_genericListeners[event]) _genericListeners[event] = [];
    _genericListeners[event].push(fn);
  }

  // ── trySync: envia fila pendente ──────────────────────────────────────────
  // _flagged: chaves de itens com conflito não-resolvido (pulamos no próximo
  // ciclo pra não travar a fila inteira atrás de um item esperando o usuário).
  const _flagged = new Set();
  // Contagem de falhas por item (chave = _sigFila). Item que falha N vezes
  // sai da fila pra não inchar o localStorage indefinidamente.
  const _failCount = new Map();
  const MAX_FAILS = 25;

  async function trySync() {
    if (_syncing) return;
    const q = getQueue();
    if (!q.length) { _flagged.clear(); _notifySync('ok', 0); return; }
    if (!navigator.onLine) { _notifySync('offline', q.length); return; }

    _syncing = true;
    _notifySync('pending', q.length);

    let consecutiveNetFails = 0;
    for (const item of [...q]) {
      const sig = _sigFila(item);
      // Pula itens em conflito até o usuário resolver.
      if (_flagged.has(sig)) continue;
      try {
        if (item.action === 'putPhoto') {
          let base64 = item.base64;
          if (!base64) { const f = await getFoto(item.fileId); base64 = f && f.base64; }
          if (!base64) { _removeFromQueue(item); _failCount.delete(sig); continue; }
          const res = await api({ action: 'putPhoto', base64, mime: item.mime, fileId: item.fileId });
          if (res && res.fileId) { _removeFromQueue(item); _failCount.delete(sig); }
        } else {
          const res = await api(item);
          if (res && res.conflito) {
            _flagged.add(sig);                 // não retentar até resolução
            _notifyConflict(item.os, res.servidor);
            continue;                          // segue para o próximo item
          }
          _removeFromQueue(item);
          _failCount.delete(sig);
          if (item.action === 'upsert' && res && res.os) {
            const all = getAllOS();
            const idx = all.findIndex(o => o.id === res.os.id);
            if (idx >= 0) {
              // numeroBrief é campo do SERVIDOR (atribuído na 1ª sincronização):
              // copia sempre que chegar, mesmo se houve edição local nova.
              if (res.os.numeroBrief && !all[idx].numeroBrief) {
                all[idx].numeroBrief = res.os.numeroBrief;
              }
              // Só sincroniza o timestamp se NÃO houve edição local durante o
              // envio — senão o pull deixaria de enxergar a divergência e a
              // edição nova ficaria só neste aparelho.
              if (all[idx].atualizadoEm === item.os.atualizadoEm) {
                all[idx].atualizadoEm = res.os.atualizadoEm;
              }
              _setAllOS(all);
            }
          }
        }
        consecutiveNetFails = 0;
      } catch (e) {
        // Distingue falha de rede (parar o ciclo) de erro permanente do item
        // (incrementa contador; quando estourar, descarta o item pra não travar).
        const msg = (e && e.message) || '';
        const isNetwork = !msg.startsWith('HTTP ') || /HTTP 5\d\d/.test(msg);
        if (isNetwork) {
          consecutiveNetFails++;
          if (consecutiveNetFails >= 1) break; // sai do loop, tenta no próximo trySync
        } else {
          const n = (_failCount.get(sig) || 0) + 1;
          _failCount.set(sig, n);
          if (n >= MAX_FAILS) {
            console.warn('[store] descartando item após', n, 'falhas:', sig, msg);
            _removeFromQueue(item);
            _failCount.delete(sig);
            _notifyListeners('item-descartado', { item, motivo: msg });
          }
        }
      }
    }

    _syncing = false;
    const remaining = getQueue();
    _notifySync(remaining.length ? (navigator.onLine ? 'pending' : 'offline') : 'ok', remaining.length);
  }

  // ── pull: busca lista do servidor e mescla ────────────────────────────────
  async function pull(onRefresh) {
    if (!navigator.onLine) return;
    try {
      const local = getAllOS();
      const byId = new Map(local.map(o => [o.id, o]));
      let changed = false;

      // Deletes pendentes na fila: a O.S ainda existe no servidor, mas foi
      // excluída aqui — sem este filtro o pull a "ressuscitava" na lista.
      const pendingDeletes = new Set(
        getQueue().filter(x => x.action === 'delete').map(x => x.id)
      );

      // O endpoint "list" é paginado (resposta limitada para não estourar o
      // teto de ~6 MB das Netlify Functions). Preferimos paginação por CHAVE
      // ("after"/"nextAfter"), estável quando O.S são criadas/apagadas entre
      // páginas; "nextOffset" fica como fallback para função antiga no ar.
      const remoteIds = new Set();
      let offset = 0;
      let after = null;
      let guard = 0; // trava de segurança contra loop infinito
      while (true) {
        const res = await api(after != null ? { action: 'list', after } : { action: 'list', offset });
        if (!Array.isArray(res.os)) return;

        for (const remote of res.os) {
          if (!remote || !remote.id) continue;
          if (pendingDeletes.has(remote.id)) continue;
          remoteIds.add(remote.id);
          const localOS = byId.get(remote.id);
          if (!localOS) {
            local.push(remote);
            byId.set(remote.id, remote);
            changed = true;
          } else {
            const tsRemote = remote.atualizadoEm ? new Date(remote.atualizadoEm).getTime() : 0;
            const tsLocal  = localOS.atualizadoEm ? new Date(localOS.atualizadoEm).getTime() : 0;
            if (tsRemote > tsLocal) {
              Object.assign(localOS, remote);
              changed = true;
            }
          }
        }

        if (res.nextAfter != null) after = res.nextAfter;
        else if (res.nextOffset != null) offset = res.nextOffset;
        else break;
        if (++guard > 1000) {
          // Atingiu o teto de segurança (>150k O.S). Avisa em vez de truncar silenciosamente.
          console.warn('[store] pull abortado: mais de 1000 páginas. Lista pode estar truncada.');
          _notifyListeners('pull-truncado', { paginas: guard });
          break;
        }
      }

      // Após varrer TODAS as páginas: remove do local as O.S que sumiram do
      // servidor (foram apagadas em outro aparelho ou via limpeza administrativa),
      // mas preserva as que ainda estão na fila aguardando envio (criadas offline).
      const queue = getQueue();
      const pendingIds = new Set(
        queue.filter(q => q.action === 'upsert' && q.os && q.os.id).map(q => q.os.id)
      );
      // Carência de consistência eventual: a LISTAGEM do Blobs demora ~1 min para
      // refletir um registro recém-gravado (o get por chave é imediato). Sem esta
      // folga, um brief criado e já sincronizado (fora da fila) sumiria da tela do
      // vendedor por até um minuto, porque ainda não aparece na listagem. Registros
      // tocados nos últimos GRACA_MS ficam protegidos; algo apagado de verdade em
      // outro aparelho some no ciclo seguinte, passada a carência.
      const GRACA_MS = 3 * 60 * 1000;
      const agoraMs = Date.now();
      const recente = o => {
        const t = o.atualizadoEm || o.criadoEm;
        return t && (agoraMs - new Date(t).getTime()) < GRACA_MS;
      };
      const sobreviventes = local.filter(o => remoteIds.has(o.id) || pendingIds.has(o.id) || recente(o));
      if (sobreviventes.length !== local.length) {
        changed = true;
        local.length = 0;
        for (const o of sobreviventes) local.push(o);
      }

      if (changed) {
        _setAllOS(local);
        lsSet(K.LASTSYNC, new Date().toISOString());
        if (typeof onRefresh === 'function') onRefresh();
      }

      const q = getQueue();
      _notifySync(q.length ? 'pending' : 'ok', q.length);
      return { updated: changed };
    } catch {
      _notifySync('offline', getQueue().length);
    }
  }

  // ── pullCFG ───────────────────────────────────────────────────────────────
  async function pullCFG() {
    if (!navigator.onLine) return;
    // Se há um setCfg pendente na fila, a config local é mais nova que a do
    // servidor — não sobrescrever (evita perder níveis/usuários/funcionários
    // editados offline). O trySync envia a versão local em seguida.
    if (getQueue().some(x => x.action === 'setCfg')) return;
    try {
      const res = await api({ action: 'getCfg' });
      if (res.cfg && Object.keys(res.cfg).length) {
        const merged = Object.assign(getCFG(), res.cfg);
        lsSet(K.CFG, merged);
      }
    } catch {}
  }

  // ── Fotos ─────────────────────────────────────────────────────────────────
  // Comprime imagem antes de gravar (max 1280px, JPEG 0.75)
  async function compressImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const MAX = 1280;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const ratio = Math.min(MAX / width, MAX / height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  async function pushPhoto(file) {
    const base64 = await compressImage(file);
    if (!base64) return null;
    const mime   = 'image/jpeg';
    const fileId = 'foto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    // Salva local (IndexedDB)
    await putFoto(fileId, base64, mime);

    // Tenta enviar ao servidor
    if (navigator.onLine) {
      try {
        const res = await api({ action: 'putPhoto', base64, mime, fileId });
        return res.fileId || fileId;
      } catch {}
    }

    // Falhou → enfileira só o fileId (o base64 já está no IndexedDB)
    _enqueue({ action: 'putPhoto', mime, fileId });
    return fileId;
  }

  // Remove a foto local E do servidor (enfileira deletePhoto na fila de sync).
  // delFoto sozinho só apagava do IndexedDB — o blob ficava para sempre no
  // servidor e nos outros aparelhos.
  function delFotoSync(fileId) {
    if (!fileId) return;
    delFoto(fileId);
    _enqueue({ action: 'deletePhoto', fileId });
    trySync();
  }

  async function pullPhoto(fileId) {
    // Cache local primeiro
    const local = await getFoto(fileId);
    if (local) return local.base64;

    if (!navigator.onLine) return null;
    try {
      const res = await api({ action: 'getPhoto', fileId });
      if (res.base64) {
        await putFoto(fileId, res.base64, res.mime || 'image/jpeg');
        return res.base64;
      }
    } catch {}
    return null;
  }

  // ── Identidade local ──────────────────────────────────────────────────────
  function getUser()         { return lsGet(K.USER,       null); }
  function setUser(u)        { lsSet(K.USER, u); }
  // Só o nome de usuário fica lembrado no aparelho; a senha nunca é guardada.
  function getUsuarioLembrado()  { return lsGet(K.LEMBRADO, '') || ''; }
  function setUsuarioLembrado(u) { lsSet(K.LEMBRADO, u || ''); }
  function getInstalador()   { return lsGet(K.INSTALADOR, null); }
  function setInstalador(n)  { lsSet(K.INSTALADOR, n); }
  function getLastSync()     { return lsGet(K.LASTSYNC,   null); }

  // ── Resolver conflito manualmente ─────────────────────────────────────────
  // Sobrescreve O.S local com versão do servidor
  function aceitarServidor(remoteOS) {
    const all = getAllOS();
    const idx = all.findIndex(o => o.id === remoteOS.id);
    if (idx >= 0) all[idx] = remoteOS; else all.push(remoteOS);
    _setAllOS(all);
    // Remove item da fila para esta O.S e libera a flag de conflito.
    const q = getQueue().filter(x => !(x.action === 'upsert' && x.os.id === remoteOS.id));
    lsSet(K.FILA, q);
    _flagged.delete('upsert:' + remoteOS.id);
  }

  // Força sobrescrita: grava o local e re-enfileira
  function sobrescreverServidor(localOS) {
    // Atualiza timestamp para ser mais novo
    localOS.atualizadoEm = new Date().toISOString();
    _flagged.delete('upsert:' + localOS.id);
    saveOS(localOS);
  }

  // ── Reconexão automática ───────────────────────────────────────────────────
  window.addEventListener('online',  () => { trySync(); });
  window.addEventListener('offline', () => { _notifySync('offline', getQueue().length); });

  // ── Backup ────────────────────────────────────────────────────────────────
  function exportarBackup() {
    return {
      versao:      4,
      exportadoEm: new Date().toISOString(),
      os:  getAllOS(),
      cfg: getCFG()
    };
  }

  function importarBackup(data) {
    if (!data || !Array.isArray(data.os)) throw new Error('Arquivo inválido');
    _setAllOS(data.os);
    if (data.cfg) lsSet(K.CFG, data.cfg);
    // Limpa a fila pendente — referências a IDs que sumiram no backup virariam
    // erros eternos no servidor; o pull seguinte re-sincroniza o que faltar.
    lsSet(K.FILA, []);
    _flagged.clear();
    _failCount.clear();
  }

  // ── UUID v4 cripto-seguro (fallback p/ Math.random em ambientes antigos) ──
  function uuid() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const b = new Uint8Array(16);
        crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40; // version 4
        b[8] = (b[8] & 0x3f) | 0x80; // variant 10
        const h = [...b].map(x => x.toString(16).padStart(2, '0'));
        return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10,16).join('')}`;
      }
    } catch {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ── API pública ───────────────────────────────────────────────────────────
  return {
    // CRUD O.S
    getAllOS, getOS, saveOS, deleteOS,
    // CFG
    getCFG, saveCFG,
    // Identidade
    getUser, setUser, getInstalador, setInstalador, getLastSync,
    getUsuarioLembrado, setUsuarioLembrado,
    // Sync
    trySync, pull, pullCFG,
    // Fotos
    pushPhoto, pullPhoto, putFoto, getFoto, delFoto, delFotoSync, compressImage,
    // Eventos
    onSync, onConflict, on,
    // Conflito manual
    aceitarServidor, sobrescreverServidor,
    // Fila
    getQueue,
    // Backup
    exportarBackup, importarBackup,
    // Utilitários
    uuid, api, apiFn
  };
})();
