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
    STAMPS:     'app_sync_stamps',
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

  // Devolve true se gravou, false se a memória do aparelho estourou. Quem
  // grava algo que NÃO pode se perder (um briefing) precisa saber disso pra
  // não dizer "salvo" quando não salvou.
  function lsSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''))) {
        console.error('[store] QuotaExceededError em', key);
        _notifyListeners('quota', null);
      } else {
        console.error('[store] falha ao gravar', key, e);
      }
      return false;
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
    return lsSet(K.OS, arr);
  }

  // Salva (cria ou atualiza) uma O.S offline-first. Devolve false se NÃO
  // conseguiu gravar no aparelho (memória cheia) -- aí o chamador não deve
  // dizer que salvou.
  function saveOS(os) {
    const all = getAllOS();
    const idx = all.findIndex(o => o.id === os.id);
    // Versão-base: o atualizadoEm que ESTE aparelho conhecia antes desta
    // edição. Viaja no item da fila; o servidor compara com o que tem gravado
    // e devolve conflito quando OUTRO aparelho editou no meio -- sem isso, a
    // edição alheia do último minuto era sobrescrita em silêncio (o teste por
    // "quem tem timestamp maior" nunca dispara nesse sentido).
    const base = idx >= 0 ? (all[idx].atualizadoEm || null) : null;
    if (base) registrarStamp(os.id, base);
    if (os.atualizadoEm) registrarStamp(os.id, os.atualizadoEm);
    if (idx >= 0) all[idx] = os;
    else all.push(os);
    const ok = _setAllOS(all);
    if (!ok) return false;        // sem gravar o cache, não faz sentido enfileirar
    // Fila cheia (quota) = NÃO salvou de verdade: sem o item na fila o registro
    // não está em pendingIds e o pull o varreria em ~3min. O false chega ao
    // editor ("⚠ Não salvou") e o autosave de 600ms vira o retry natural.
    if (!_enqueue({ action: 'upsert', os, baseAtualizadoEm: base })) return false;
    // O dado JÁ está salvo local e na fila. O envio pro servidor é agrupado:
    // digitar um briefing dispara autosave a cada 600ms, e mandar o briefing
    // INTEIRO pra rede a cada tecla deixava o app pesado no celular. A fila
    // garante que nada se perde; só o momento do upload é adiado e coalescido.
    agendarSync();
    return true;
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
  // Carimbos (atualizadoEm) que ESTE aparelho já teve no cache, por briefing.
  // São os "ancestrais conhecidos": se um conflito apontar pra um carimbo que
  // já passou por aqui, o servidor não tem nada que este aparelho não viu --
  // a edição local foi construída EM CIMA daquilo e pode seguir sem perguntar.
  // (É o que fecha o falso conflito do ack perdido: o app enviou, o servidor
  // aplicou, a resposta se perdeu no sinal ruim/reload -- e a edição seguinte
  // "conflitava" com a própria escrita.)
  function _stampsVistos() { return lsGet(K.STAMPS, {}); }
  function registrarStamp(id, stamp) {
    if (!id || !stamp) return;
    const m = _stampsVistos();
    const l = m[id] || [];
    if (l.includes(stamp)) return;
    l.push(stamp);
    m[id] = l.slice(-20);
    lsSet(K.STAMPS, m);
  }
  function stampVisto(id, stamp) {
    return !!(id && stamp && (_stampsVistos()[id] || []).includes(stamp));
  }

  function getQueue() { return lsGet(K.FILA, []); }
  // Quantos itens da fila já falharam várias vezes seguidas -- o chip usa isso
  // pra trocar "N pendente(s)" (parece saudável) por um aviso com erro.
  function filaComErro() {
    return getQueue().filter(it => (_failCount.get(_sigFila(it)) || 0) >= 5).length;
  }
  // Ids de briefings que ainda têm upsert na fila (não confirmados pelo servidor).
  function idsNaFila() {
    const s = new Set();
    getQueue().forEach(it => { if (it.action === 'upsert' && it.os && it.os.id) s.add(it.os.id); });
    return s;
  }

  // Devolve o resultado do lsSet: false = quota estourada, o item NÃO está na
  // fila. Quem chama precisa propagar (saveOS devolve false e o editor mostra
  // "não salvou"). Engolir isso fazia o app dizer "✓ Salvo" com o item fora da
  // fila -- e o pull apagava o briefing do aparelho 3 minutos depois.
  function _enqueue(item) {
    let q = getQueue();
    // Deduplica upserts da mesma O.S
    if (item.action === 'upsert') {
      const i = q.findIndex(x => x.action === 'upsert' && x.os.id === item.os.id);
      if (i >= 0) {
        // O substituto HERDA a versão-base do item original: ela aponta pra
        // última versão CONFIRMADA pelo servidor que este aparelho viu. Sem a
        // herança, a 2ª edição local usaria a 1ª (ainda não enviada) como base
        // e geraria falso conflito contra o próprio trabalho.
        if ('baseAtualizadoEm' in q[i]) item.baseAtualizadoEm = q[i].baseAtualizadoEm;
        q[i] = item;
        return lsSet(K.FILA, q);
      }
    }
    // Quando deleta uma O.S, descarta upserts pendentes dela (não faz sentido
    // mandar uma versão "atualizada" de algo que vai ser apagado em seguida).
    if (item.action === 'delete') {
      q = q.filter(x => !(x.action === 'upsert' && x.os && x.os.id === item.id));
      // Se já existe um delete pra mesma id na fila, evita duplicar.
      if (q.some(x => x.action === 'delete' && x.id === item.id)) {
        return lsSet(K.FILA, q);
      }
    }
    // Deletar uma foto descarta o upload pendente dela (senão o servidor
    // recebe o put depois do delete e a foto "excluída" ressuscita lá).
    if (item.action === 'deletePhoto') {
      q = q.filter(x => !(x.action === 'putPhoto' && x.fileId === item.fileId));
      if (q.some(x => x.action === 'deletePhoto' && x.fileId === item.fileId)) {
        return lsSet(K.FILA, q);
      }
    }
    q.push(item);
    return lsSet(K.FILA, q);
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

  // Chama uma função do backend (os, mubisys, …) com timeout.
  //
  // O endereço vem do config.js: hoje são Edge Functions do Supabase, antes eram
  // Netlify Functions. O resto do app não sabe da diferença — continua pedindo
  // 'os' e 'mubisys', e a tradução para o nome real acontece aqui.
  async function apiFn(fn, body, timeoutMs = 15000) {
    // Timeout: em sinal fraco, navigator.onLine pode ser true mas o fetch trava.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const alvo = (typeof API_FN === 'object' && API_FN[fn]) || fn;
      const url = (typeof API_BASE === 'string' && API_BASE)
        ? API_BASE + '/' + alvo
        : '/.netlify/functions/' + fn; // volta ao Netlify se o config for antigo
      const res = await fetch(url, {
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
  let _pulling = false;   // evita pulls sobrepostos (boot + timer + botão manual)

  // Envio agrupado: o primeiro save dispara na hora (send/edição pontual sai
  // rápido); saves em rajada (digitação) coalescem numa tentativa só no fim da
  // janela. Como a fila já guardou tudo, adiar o upload nunca perde dado.
  let _syncTimer = null;
  let _ultimoSyncMs = 0;
  const SYNC_THROTTLE = 2500;
  function agendarSync() {
    const desde = Date.now() - _ultimoSyncMs;
    if (desde >= SYNC_THROTTLE) { _ultimoSyncMs = Date.now(); trySync(); return; }
    if (!_syncTimer) {
      _syncTimer = setTimeout(() => {
        _syncTimer = null; _ultimoSyncMs = Date.now(); trySync();
      }, SYNC_THROTTLE - desde);
    }
  }
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
  const MAX_FAILS = 25;       // erro 4xx: o servidor recusou o item de vez
  const MAX_FAILS_5XX = 50;   // erro 5xx: o servidor respondeu, mas quebrando -- teto maior
  // Backoff por item: um item que acabou de falhar espera antes de retentar,
  // SEM sair da fila e SEM travar os itens de trás. Antes, a primeira falha
  // 5xx/timeout dava `break` no ciclo inteiro: o item envenenado virava a
  // cabeça da fila e nada atrás dele subia nunca mais -- com o chip mostrando
  // só "N pendente(s)", igual a uma fila saudável.
  const _skipAte = new Map();
  // Briefing a que um item da fila se refere (pra preservar a ordem relativa
  // upsert/delete do MESMO registro quando um deles é pulado).
  const _idDoItem = it =>
    (it.action === 'upsert' && it.os && it.os.id) || (it.action === 'delete' && it.id) || '';

  async function trySync() {
    if (_syncing) return;
    const q = getQueue();
    if (!q.length) { _flagged.clear(); _notifySync('ok', 0); return; }
    if (!navigator.onLine) { _notifySync('offline', q.length); return; }

    _syncing = true;
    _notifySync('pending', q.length);

    let consecutiveNetFails = 0;
    let servidorVenceu = 0;
    // Registros com item pulado NESTE ciclo: os itens seguintes do mesmo
    // registro também esperam, senão um delete passaria na frente do upsert.
    const puladosIds = new Set();
    for (const item of [...q]) {
      const sig = _sigFila(item);
      const rid = _idDoItem(item);
      // Pula itens em conflito até o usuário resolver.
      if (_flagged.has(sig)) { if (rid) puladosIds.add(rid); continue; }
      if (rid && puladosIds.has(rid)) continue;
      // Item em backoff (falhou há pouco): espera a vez dele, segue pros outros.
      if ((_skipAte.get(sig) || 0) > Date.now()) { if (rid) puladosIds.add(rid); continue; }
      try {
        if (item.action === 'putPhoto') {
          let base64 = item.base64;
          if (!base64) { const f = await getFoto(item.fileId); base64 = f && f.base64; }
          if (!base64) { _removeFromQueue(item); _failCount.delete(sig); continue; }
          // Timeout proporcional ao tamanho: 500 KB em sinal fraco não completa
          // em 15s nunca -- abortava, retentava o MESMO item e queimava rádio.
          const tFoto = Math.min(120000, 15000 + Math.round(base64.length / 10));
          const res = await apiFn('os', { action: 'putPhoto', base64, mime: item.mime, fileId: item.fileId }, tFoto);
          if (res && res.fileId) { _removeFromQueue(item); _failCount.delete(sig); }
        } else {
          const res = await api(item);
          if (res && res.conflito) {
            // Item de restauração de backup: o servidor tem versão mais nova
            // -> servidor vence, sem modal (um arquivo antigo não pode
            // reverter o que a equipe fez desde então).
            if (item.origem === 'import') {
              aceitarServidor(res.servidor);
              servidorVenceu++;
              continue;
            }
            // Falso conflito: a versão do servidor é um carimbo que este
            // aparelho JÁ TEVE (a edição local foi feita em cima dela; a base
            // só ficou velha porque um ack se perdeu). Atualiza a base e
            // deixa o próximo ciclo reenviar -- sem incomodar ninguém.
            if (res.servidor && stampVisto(item.os && item.os.id, res.servidor.atualizadoEm)) {
              const q2 = getQueue();
              const qi = q2.findIndex(x => _sigFila(x) === sig);
              if (qi >= 0) { q2[qi].baseAtualizadoEm = res.servidor.atualizadoEm; lsSet(K.FILA, q2); }
              continue;
            }
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
              // Subiu agora: limpa a marca de "não subiu", se havia.
              if (all[idx]._syncFalhou) { delete all[idx]._syncFalhou; delete all[idx]._syncMotivo; }
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
            registrarStamp(res.os.id, res.os.atualizadoEm);
            // Se sobrou um upsert mais novo na fila (edição feita durante o
            // envio), a base dele passa a ser a versão que o servidor acabou
            // de confirmar -- senão o próximo envio geraria falso conflito.
            const q2 = getQueue();
            const qi = q2.findIndex(x => x.action === 'upsert' && x.os && x.os.id === res.os.id);
            if (qi >= 0 && 'baseAtualizadoEm' in q2[qi]) {
              q2[qi].baseAtualizadoEm = res.os.atualizadoEm || null;
              lsSet(K.FILA, q2);
            }
          }
        }
        consecutiveNetFails = 0;
        _skipAte.delete(sig);
      } catch (e) {
        // Três classes de falha:
        //   HTTP 4xx  -> o servidor RECUSOU o item: conta rápido (25) e descarta.
        //   HTTP 5xx  -> o servidor respondeu quebrando: pode ser permanente
        //                (Storage recusando a foto toda vez) -- conta devagar (50)
        //                e TAMBÉM descarta, senão a válvula nunca alcança.
        //   sem HTTP  -> timeout/abort/queda: indistinguível de sinal ruim, NUNCA
        //                descarta (descartar aqui perderia trabalho de verdade).
        // Em todas: backoff só no item, o resto da fila continua subindo.
        const msg = (e && e.message) || '';
        const e5xx = /^HTTP 5\d\d/.test(msg);
        const conexao = !msg.startsWith('HTTP ');
        const n = (_failCount.get(sig) || 0) + 1;
        if (!conexao) _failCount.set(sig, n);
        const teto = e5xx ? MAX_FAILS_5XX : MAX_FAILS;
        if (!conexao && n >= teto) {
          console.warn('[store] descartando item após', n, 'falhas:', sig, msg);
          _removeFromQueue(item);
          _failCount.delete(sig);
          _skipAte.delete(sig);
          // Não some em silêncio: marca o PRÓPRIO briefing como "não subiu",
          // pra a lista poder mostrar isso em vez de ele parecer sincronizado.
          if (item.action === 'upsert' && item.os && item.os.id) {
            const all = getAllOS();
            const idx = all.findIndex(o => o.id === item.os.id);
            if (idx >= 0) { all[idx]._syncFalhou = true; all[idx]._syncMotivo = msg; _setAllOS(all); }
          }
          _notifyListeners('item-descartado', { item, motivo: msg });
        } else {
          // Backoff exponencial por item: 8s -> 16s -> ... -> 2min.
          _skipAte.set(sig, Date.now() + Math.min(120000, 8000 * Math.pow(2, Math.min(n - 1, 4))));
          if (rid) puladosIds.add(rid);
          if (conexao || e5xx) {
            consecutiveNetFails++;
            // DOIS itens diferentes falhando em sequência = rede fora de
            // verdade: aí parar o ciclo inteiro é o comportamento certo.
            if (consecutiveNetFails >= 2) break;
          }
        }
      }
    }

    _syncing = false;
    if (servidorVenceu) {
      _notifyListeners('restauracao-servidor', { n: servidorVenceu });
    }
    const remaining = getQueue();
    _notifySync(remaining.length ? (navigator.onLine ? 'pending' : 'offline') : 'ok', remaining.length);
    // Sobrou item na fila (entrou durante o envio, ou falhou por rede)? Re-agenda
    // em vez de esperar o próximo gatilho -- podia demorar até 60s pra tentar.
    if (remaining.length && navigator.onLine && !_reagendou) {
      _reagendou = true;
      setTimeout(() => { _reagendou = false; trySync(); }, 4000);
    }
  }
  let _reagendou = false;

  // ── pull: busca lista do servidor e mescla ────────────────────────────────
  async function pull(onRefresh) {
    if (!navigator.onLine) return;
    // Um pull de cada vez. Sem isto, boot + timer de 60s + botão manual podiam
    // rodar pulls sobrepostos, cada um baixando a lista e redesenhando a tela.
    // Devolve {pulou:true} -- diferente de undefined (que significa ERRO), pra
    // o botão "Sincronizar" não anunciar "servidor fora" quando só coincidiu
    // com um pull de fundo já em andamento.
    if (_pulling) return { pulou: true };
    _pulling = true;
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
              registrarStamp(remote.id, remote.atualizadoEm);
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
      // _syncFalhou também protege: o briefing descartado da fila após MAX_FAILS
      // não está no servidor (nunca subiu) nem na fila (foi descartado) e já
      // passou da carência — sem esta guarda, o pull o apagava do aparelho antes
      // de o vendedor tocar em "NÃO SUBIU" pra reenviar. Ele nunca subiu, logo
      // não existe no servidor: a proteção não ressuscita nada apagado de verdade.
      const sobreviventes = local.filter(o => remoteIds.has(o.id) || pendingIds.has(o.id) || recente(o) || o._syncFalhou);
      if (sobreviventes.length !== local.length) {
        changed = true;
        local.length = 0;
        for (const o of sobreviventes) local.push(o);
      }

      if (changed) {
        // RE-MESCLA antes de gravar. O pull lê o cache no início e só grava no
        // fim, com vários awaits no meio -- se o trySync gravou nesse intervalo
        // (ex.: o numeroBrief que o servidor acabou de atribuir), escrever o
        // snapshot antigo apagava aquilo PRA SEMPRE (o pull seguinte via os
        // timestamps iguais e não recopiava).
        const atual = getAllOS();
        if (atual.length) {
          const porId = new Map(local.map(o => [o.id, o]));
          atual.forEach(o => {
            const noPull = porId.get(o.id);
            // Briefing criado DURANTE o pull: sem esta linha, gravar o retrato
            // o apagaria do cache até o próximo ciclo.
            if (!noPull) { local.push(o); return; }
            // Edição local mais nova que o retrato do pull GANHA inteira --
            // era a medição digitada durante o pull que sumia da tela.
            const tsA = o.atualizadoEm ? new Date(o.atualizadoEm).getTime() : 0;
            const tsP = noPull.atualizadoEm ? new Date(noPull.atualizadoEm).getTime() : 0;
            if (tsA > tsP) { Object.assign(noPull, o); return; }
            // Campos que o SERVIDOR atribui e o pull pode não ter visto ainda
            // (o trySync não mexe no atualizadoEm quando houve edição local).
            if (o.numeroBrief && !noPull.numeroBrief) noPull.numeroBrief = o.numeroBrief;
            // Marca de falha de envio é estado local: não deixa o pull limpar.
            if (o._syncFalhou && !noPull._syncFalhou) { noPull._syncFalhou = true; noPull._syncMotivo = o._syncMotivo; }
          });
        }
        _setAllOS(local);
        lsSet(K.LASTSYNC, new Date().toISOString());
        if (typeof onRefresh === 'function') onRefresh();
      }

      const q = getQueue();
      _notifySync(q.length ? 'pending' : 'ok', q.length);
      return { updated: changed };
    } catch {
      // Falhou o pull: se o aparelho ESTÁ na internet, quem caiu foi o servidor.
      // Dizer "Offline" mandava o vendedor procurar sinal que já existia.
      _notifySync(navigator.onLine ? 'servidor' : 'offline', getQueue().length);
    } finally {
      _pulling = false;
    }
  }

  // ── pullCFG ───────────────────────────────────────────────────────────────
  // Devolve true quando a config local está EM DIA (baixou agora, ou há um
  // setCfg local pendente que é mais novo que o servidor). Devolve false
  // quando NÃO conseguiu conferir (offline/erro) -- as telas de admin usam
  // isso como trava: salvar por cima sem ter relido regravava o pacote velho
  // da empresa inteiro quando a conexão voltava.
  async function pullCFG() {
    if (!navigator.onLine) return false;
    // Se há um setCfg pendente na fila, a config local é mais nova que a do
    // servidor — não sobrescrever (evita perder níveis/usuários/funcionários
    // editados offline). O trySync envia a versão local em seguida.
    if (getQueue().some(x => x.action === 'setCfg')) return true;
    try {
      const res = await api({ action: 'getCfg' });
      if (res.cfg && Object.keys(res.cfg).length) {
        const merged = Object.assign(getCFG(), res.cfg);
        lsSet(K.CFG, merged);
      }
      return true;
    } catch { return false; }
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

    // NUNCA espera a rede: o "tento mandar agora" custava até 17s de slot
    // congelado por foto no sinal lento da rua (medido). A fila faz o MESMO
    // upload em segundo plano; a foto aparece na tela na hora.
    _enqueue({ action: 'putPhoto', mime, fileId });
    agendarSync();
    return fileId;
  }

  // Guarda uma imagem que JÁ está em base64 (arte da prancha, foto trocada) com
  // a mesma garantia da foto do briefing: grava local e, se o envio falhar,
  // entra na fila offline em vez de se perder.
  async function salvarFotoBase64(base64, mime, idSugerido) {
    if (!base64) return null;
    const fileId = idSugerido || ('foto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    const tipo = mime || 'image/jpeg';
    await putFoto(fileId, base64, tipo);
    if (navigator.onLine) {
      try {
        const res = await api({ action: 'putPhoto', base64, mime: tipo, fileId });
        if (res && res.fileId) return fileId;
      } catch {}
    }
    _enqueue({ action: 'putPhoto', mime: tipo, fileId });
    trySync();
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
    if (remoteOS && remoteOS.id && remoteOS.atualizadoEm) registrarStamp(remoteOS.id, remoteOS.atualizadoEm);
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
    // "Manter a minha" é sobrescrita DELIBERADA: tira a versão-base do item
    // pra o servidor não devolver o mesmo conflito de novo (sem base ele cai
    // no critério antigo de timestamp, que o carimbo acima satisfaz).
    const q = getQueue();
    const i = q.findIndex(x => x.action === 'upsert' && x.os && x.os.id === localOS.id);
    if (i >= 0) { delete q[i].baseAtualizadoEm; lsSet(K.FILA, q); }
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

  async function importarBackup(data) {
    if (!data || !Array.isArray(data.os)) throw new Error('Arquivo inválido');
    const regs = data.os.filter(o => o && o.id);
    const ok = _setAllOS(data.os);
    if (!ok) throw new Error('Não coube no armazenamento do aparelho');
    if (data.cfg) lsSet(K.CFG, data.cfg);
    // A fila antiga referencia IDs que podem ter sumido no arquivo -- zera.
    // MAS os putPhoto são autossuficientes (base64 no IndexedDB, que o import
    // não toca) e continuam valendo: preservá-los.
    const fotosPendentes = getQueue().filter(x => x.action === 'putPhoto');
    // RE-ENFILEIRA os briefings do arquivo, numa gravação SÓ (laço de _enqueue
    // relia e regravava a fila inteira a cada item, e engolia quota calado).
    // Sem a fila eles não entram em pendingIds e o pull os varre em minutos.
    // origem:'import' marca o item: se o servidor tiver versão MAIS NOVA, o
    // conflito se resolve sozinho a favor do servidor -- restauração não pode
    // reverter o trabalho da equipe nem abrir um modal por briefing.
    const fila = fotosPendentes.concat(regs.map(os => ({ action: 'upsert', os, origem: 'import' })));
    if (!lsSet(K.FILA, fila)) {
      lsSet(K.FILA, fotosPendentes);
      throw new Error('Backup grande demais pra este aparelho — importe num computador');
    }
    _flagged.clear();
    _failCount.clear();
    _skipAte.clear();
    // O arquivo NÃO contém fotos. As que existirem NESTE aparelho (IndexedDB)
    // sobem junto -- putPhoto no servidor é upsert de arquivo, re-enviar o que
    // já existe é inofensivo -- cobrindo a restauração pós-perda do servidor.
    const naFila = new Set(fotosPendentes.map(x => x.fileId));
    const ids = [];
    for (const os of regs) {
      (os.itens || []).forEach(it => (it.fotos || []).forEach(f => { if (f && f.id) ids.push(f.id); }));
      (os.croquis || []).forEach(c => { if (c && c.id) ids.push(c.id); });
      (os.pranchas || []).forEach(v => (v.itens || []).forEach(p => { if (p && p.imagemId) ids.push(p.imagemId); }));
    }
    for (const fid of ids) {
      if (naFila.has(fid)) continue;
      naFila.add(fid);
      try {
        const f = await getFoto(fid);
        if (f && f.base64) _enqueue({ action: 'putPhoto', fileId: fid, mime: f.mime });
      } catch { /* sem a foto local não há o que subir */ }
    }
    agendarSync();
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
    trySync, pull, pullCFG, filaComErro,
    // Fotos
    pushPhoto, pullPhoto, putFoto, getFoto, delFoto, delFotoSync, compressImage, salvarFotoBase64,
    // Eventos
    onSync, onConflict, on,
    // Conflito manual
    aceitarServidor, sobrescreverServidor,
    // Fila
    getQueue, idsNaFila,
    // Backup
    exportarBackup, importarBackup,
    // Utilitários
    uuid, api, apiFn
  };
})();
