// app.js — Brief de Medição · Impresilk
// App inteiro em cima do STORE (kit de sincronização offline-first).
// Perfis: vendedor (cria e vê os próprios), designer (recebe, muda status,
// exporta), admin (tudo + painel de controle).

/* ══════════════════ Constantes ══════════════════ */

const STATUS_LISTA = ['Aguardando orçamento', 'Em design', 'Aprovado pra execução', 'Concluído'];
const OBSTACULOS = ['Árvore', 'Poste', 'Marquise', 'Fiação', 'Outro'];
const SERVICOS_EXTRAS = [
  'Remoção de adesivo com removedor', 'Remoção de fachada', 'Remoção de letras da parede',
  'Pintura', 'Lixamento', 'Serviços de solda', 'Troca de lâmpadas', 'Serviço elétrico',
  'Serviço de munk', 'Serviço de terceirizados', 'Cantoneiras', 'Spot', 'Refletor', 'Telhado', 'Calha'
];
const AMBIENTES = ['Externo', 'Interno'];
const FOTOS_ITEM = [
  { tipo: 'fachada', rotulo: 'Geral da fachada', obrig: true },
  { tipo: 'close', rotulo: 'Close da superfície', obrig: true },
  { tipo: 'escala', rotulo: 'Referência de escala', obrig: true },
  { tipo: 'atual', rotulo: 'Peça atual (se substituição)', obrig: false }
];

/* ══════════════════ Helpers ══════════════════ */

const $ = (sel, raiz) => (raiz || document).querySelector(sel);
const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Mesma regra do servidor (equipe-auth): sem acento, minúsculo, espaço
// colapsado. O login agora vem normalizado de lá — se aqui divergir, "meus
// briefings" para de reconhecer o dono.
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function pad2(n) { return String(n).padStart(2, '0'); }

// Regra do kit: timestamps em UTC, exibição e filtros SEMPRE no dia local.
function diaLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function fmtData(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
}
function fmtDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return fmtData(iso) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function isoParaInputLocal(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function inputLocalParaISO(v) {
  const d = v ? new Date(v) : new Date();
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// ── Datas digitadas só com números ────────────────────────────────────────
// Na rua, com uma mão e sol na tela, o seletor de data nativo atrapalha: o
// vendedor digita 22072026 no teclado numérico e o campo formata 22/07/2026.
function mascaraData(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return d.slice(0, 2) + '/' + d.slice(2);
  return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
}
function mascaraHora(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 4);
  if (d.length <= 2) return d;
  return d.slice(0, 2) + ':' + d.slice(2);
}
function isoParaDataBr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
}
function isoParaHoraBr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
// dd/mm/aaaa (+ hh:mm) → ISO em UTC. Devolve null se a data não for válida,
// para o autosave nunca gravar lixo enquanto o vendedor ainda está digitando.
function dataBrParaISO(dataBr, horaBr) {
  const m = String(dataBr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dia = Number(m[1]), mes = Number(m[2]), ano = Number(m[3]);
  const hm = String(horaBr || '').match(/^(\d{1,2}):(\d{2})$/);
  const hh = hm ? Number(hm[1]) : 0, mi = hm ? Number(hm[2]) : 0;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hh > 23 || mi > 59) return null;
  const d = new Date(ano, mes - 1, dia, hh, mi);
  // Rejeita data que "vira o mês" (ex.: 31/02 viraria 03/03)
  if (d.getDate() !== dia || d.getMonth() !== mes - 1) return null;
  return d.toISOString();
}
// dd/mm/aaaa → aaaa-mm-dd (formato usado na comparação dos filtros por dia local)
function dataBrParaYmd(dataBr) {
  const m = String(dataBr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
}

function fmtBytes(b) {
  b = Number(b) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
  return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function numBr(v) {
  const n = Number(String(v == null ? '' : v).replace(',', '.'));
  return isFinite(n) ? n : 0;
}
function fmtM2(cm2) {
  return (cm2 / 10000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m²';
}
function areaPar(p) { return numBr(p.largura) * numBr(p.altura); }
function areaItem(item) { return (item.medidas || []).reduce((s, p) => s + areaPar(p), 0); }
function temMedida(item) { return (item.medidas || []).some(p => numBr(p.largura) > 0 && numBr(p.altura) > 0); }

function mascaraTel(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (!d.length) return '';
  if (d.length <= 2) return '(' + d;
  if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
  if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
}

// Numeração do brief: atribuída pelo SERVIDOR na primeira sincronização
// (aparelhos offline não têm como combinar números entre si sem conflito).
function padBrief(n) { return String(n).padStart(4, '0'); }
function rotuloBrief(b) {
  return b && b.numeroBrief ? 'Nº ' + padBrief(b.numeroBrief) : 'Nº sai na 1ª sincronização';
}

// Ambiente virou lista (aceita Interno E Externo). Briefing gravado no formato
// antigo tinha uma string; sem esta conversão o dado sumiria da tela em silêncio.
function ambientesDe(b) {
  if (!b) return [];
  if (Array.isArray(b.ambientes)) return b.ambientes;
  return b.ambiente ? [b.ambiente] : [];
}

function nomeItem(item) {
  if (!item) return '';
  if (item.tipo === 'Outro') return item.tipoOutro || 'Outro';
  return item.tipo || '';
}

function badgeStatus(status) {
  const mapa = {
    'Aguardando orçamento': 'status-aguardando',
    'Em design': 'status-design',
    'Aprovado pra execução': 'status-execucao',
    'Concluído': 'status-concluido'
  };
  if (!status) return '';
  return '<span class="badge ' + (mapa[status] || 'neutro') + '">' + esc(status) + '</span>';
}

function arquivoSeguro(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'briefing';
}

function debounce(fn, ms) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

/* ══════════════════ Toast / Modal / Lightbox ══════════════════ */

function toast(msg, tipo) {
  let area = $('#toasts');
  if (!area) { area = document.createElement('div'); area.id = 'toasts'; document.body.appendChild(area); }
  const t = document.createElement('div');
  t.className = 'toast' + (tipo ? ' ' + tipo : '');
  t.textContent = msg;
  area.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 3400);
  setTimeout(() => t.remove(), 3900);
}

function abrirModal(html, opcoes) {
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  fundo.innerHTML = '<div class="modal">' + html + '</div>';
  // `persistente`: não fecha no toque fora. Usado em decisão obrigatória (ex.:
  // conflito entre aparelhos) -- fechar sem escolher deixava o briefing travado
  // sem sincronizar pra sempre.
  if (!(opcoes && opcoes.persistente)) {
    fundo.addEventListener('click', e => { if (e.target === fundo) fundo.remove(); });
  }
  $('#overlays').appendChild(fundo);
  return fundo;
}

function abrirLightbox(fotos, inicio) {
  // fotos: [{id, legenda}]
  let idx = inicio || 0;
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML =
    '<button class="fechar">✕</button>' +
    '<img alt="Foto ampliada">' +
    '<div class="legenda"></div>' +
    '<div class="navegar">' +
    (fotos.length > 1 ? '<button class="ant">←</button>' : '') +
    '<button class="baixar" title="Baixar esta foto">📥 Baixar</button>' +
    (fotos.length > 1 ? '<button class="prox">→</button>' : '') +
    '</div>';
  const img = $('img', lb);
  const leg = $('.legenda', lb);
  let atualB64 = null;   // a foto REALMENTE carregada (não o img.src, que vira a URL da página quando vazio)
  let pedido = 0;        // token: só a última troca de foto vale
  $('.baixar', lb).onclick = () => {
    // Só baixa se a foto carregou. Antes, tocar antes de carregar salvava a
    // própria página como ".jpg" (img.src vazio resolvia pra URL do app).
    if (!atualB64) { toast('Espere a foto carregar pra baixar.', 'erro'); return; }
    const f = fotos[idx];
    const a = document.createElement('a');
    a.href = atualB64;
    a.download = arquivoSeguro(f.legenda || 'foto') + '.jpg';
    document.body.appendChild(a); a.click(); a.remove();
  };
  async function mostrar() {
    const f = fotos[idx];
    const meu = ++pedido;
    atualB64 = null;
    leg.textContent = (f.legenda || '') + '  (' + (idx + 1) + ' de ' + fotos.length + ')';
    img.removeAttribute('src');
    const b64 = await STORE.pullPhoto(f.id);
    if (meu !== pedido) return; // o usuário já pulou pra outra foto: ignora esta
    if (b64) { atualB64 = b64; img.src = b64; }
    else leg.textContent = 'Foto ainda não sincronizada neste aparelho';
  }
  $('.fechar', lb).onclick = () => lb.remove();
  lb.addEventListener('click', e => { if (e.target === lb) lb.remove(); });
  if (fotos.length > 1) {
    $('.ant', lb).onclick = () => { idx = (idx - 1 + fotos.length) % fotos.length; mostrar(); };
    $('.prox', lb).onclick = () => { idx = (idx + 1) % fotos.length; mostrar(); };
  }
  $('#overlays').appendChild(lb);
  mostrar();
}

function confirmar(titulo, texto, rotuloOk, aoConfirmar, perigo) {
  const m = abrirModal(
    '<h3>' + esc(titulo) + '</h3><p>' + texto + '</p>' +
    '<div class="acoes-modal">' +
    '<button class="botao fantasma btn-cancelar">Cancelar</button>' +
    '<button class="botao ' + (perigo ? 'perigo' : '') + ' btn-ok">' + esc(rotuloOk) + '</button>' +
    '</div>'
  );
  $('.btn-cancelar', m).onclick = () => m.remove();
  $('.btn-ok', m).onclick = () => { m.remove(); aoConfirmar(); };
}

/* ══════════════════ Manual embutido ══════════════════ */

function abrirManual(aba) {
  const medir = [
    'Usar sempre o mesmo ponto de referência, por exemplo o canto inferior esquerdo.',
    'Altura de instalação é do chão até a base da peça.',
    'Anotar sempre em centímetros.',
    'Superfície irregular: registrar mais de um ponto de medição.',
    'Conferir duas vezes antes de enviar, principalmente em execução.'
  ];
  const fotografar = [
    'Geral da fachada, de frente.',
    'Close da superfície exata onde a peça vai ser instalada.',
    'Foto com referência de escala, como uma porta ou tomada.',
    'Evitar foto contra a luz.',
    'Se for substituição, fotografar a peça atual.'
  ];
  function lista(passos) {
    return '<ol style="margin-left:20px; display:grid; gap:8px;">' + passos.map(p => '<li>' + esc(p) + '</li>').join('') + '</ol>';
  }
  const m = abrirModal(
    '<h3>Manual rápido</h3>' +
    '<div class="abas" style="margin-top:10px">' +
    '<button class="aba aba-medir">Como medir</button>' +
    '<button class="aba aba-foto">Como fotografar</button></div>' +
    '<div class="conteudo-manual"></div>' +
    '<div class="acoes-modal"><button class="botao btn-fechar largo">Entendi</button></div>'
  );
  function mostrar(qual) {
    $('.aba-medir', m).classList.toggle('ativa', qual === 'medir');
    $('.aba-foto', m).classList.toggle('ativa', qual !== 'medir');
    $('.conteudo-manual', m).innerHTML = lista(qual === 'medir' ? medir : fotografar);
  }
  $('.aba-medir', m).onclick = () => mostrar('medir');
  $('.aba-foto', m).onclick = () => mostrar('foto');
  $('.btn-fechar', m).onclick = () => m.remove();
  mostrar(aba === 'foto' ? 'foto' : 'medir');
}

/* ══════════════════ Sessão e boot ══════════════════ */

let SESSAO = STORE.getUser();
let ROTA = { nome: 'lista' };
let BRIEF = null;         // briefing aberto no editor
let ETAPA = 1;            // etapa ativa no wizard (mobile)
// Cards de item recolhidos. Fica só na memória da tela (não vai pro servidor):
// é preferência de visualização do momento, não dado do briefing.
const ITENS_RECOLHIDOS = new Set();
// Itens da O.S. que o vendedor desmarcou na lista (senão voltavam marcados
// a cada redesenho da tela).
const OS_ITENS_DESMARCADOS = new Set();
function filtrosZerados() {
  return { texto: '', os: '', de: '', ate: '', deBr: '', ateBr: '', status: '', vendedor: '', tipo: '', semOS: false, meus: false, semDesigner: false };
}
let FILTROS = filtrosZerados();
// Há algum filtro além da busca por nome? Decide se "Mais filtros" abre sozinho.
function filtrosExtraAtivos() {
  return !!(FILTROS.os || FILTROS.de || FILTROS.ate || FILTROS.status || FILTROS.vendedor ||
    FILTROS.tipo || FILTROS.semOS || FILTROS.meus || FILTROS.semDesigner);
}
let SYNC_ESTADO = { status: 'ok', pendentes: 0 };
// Ligado enquanto o botão de sincronizar do topo está rodando.
let _sincronizando = false;
// Etapa e briefing do último desenho do editor: pra decidir se sobe pro topo.
let _ultimaEtapaRender = 0;
let _ultimoBriefRender = '';

function ehDesktop() { return window.matchMedia('(min-width: 900px)').matches; }

STORE.onSync((status, pendentes) => {
  SYNC_ESTADO = { status, pendentes };
  const chip = $('#chip-sync');
  // Enquanto o usuário está sincronizando pelo botão, não sobrescreve o
  // "Sincronizando…": o retorno some antes de ser lido e parece que nada rodou.
  if (chip && !_sincronizando) {
    chip.className = 'chip-sync ' + status;
    chip.textContent = rotuloSync(status, pendentes);
  }
  // O servidor atribui o número do brief na primeira sincronização; quando ele
  // chega, atualiza a tela aberta sem re-renderizar (pra não roubar o foco).
  if (BRIEF && !BRIEF.numeroBrief) {
    const atual = STORE.getOS(BRIEF.id);
    if (atual && atual.numeroBrief) {
      BRIEF.numeroBrief = atual.numeroBrief;
      const campo = $('#num-brief-campo');
      if (campo) campo.value = rotuloBrief(BRIEF);
    }
  }
  // Os selos "⏳ subindo…" e "⚠ NÃO SUBIU" são um retrato do momento em que a
  // lista foi desenhada. Sem redesenhar ao fim do sync, o cartão ficava
  // "subindo…" pra sempre e o vendedor tocava de novo achando que falhou.
  if (ROTA.nome === 'lista' && typeof _refreshCards === 'function' && !_sincronizando) _refreshCards();
});

// Resumo em linguagem simples do que difere entre as duas versões, pro usuário
// decidir sabendo o que perde. Conta itens, fotos e medidas dos dois lados.
function resumoVersao(b) {
  const itens = (b.itens || []).length;
  const fotos = (b.itens || []).reduce((s, it) => s + (it.fotos || []).filter(f => !f.arquivada).length, 0);
  const medidas = (b.itens || []).reduce((s, it) => s + (it.medidas || []).filter(m => m.largura || m.altura).length, 0);
  return { itens, fotos, medidas };
}

// Diferenças de campo a campo entre as duas versões, com rótulo de gente.
// Sem isso o modal mostrava dois resumos idênticos ("2 itens · 6 fotos") e a
// escolha era um chute -- o lado perdedor sumia em silêncio.
function diferencasVersoes(local, servidor) {
  const CAMPOS = [
    ['cliente', 'Cliente'], ['responsavel', 'Contato'], ['telefone', 'Telefone'],
    ['endereco', 'Endereço'], ['status', 'Status'], ['situacao', 'Situação'],
    ['osNumero', 'O.S.'], ['tipoMedicao', 'Tipo de medição'], ['urgente', 'Urgência'],
  ];
  const out = [];
  const mostrar = v => v === true ? 'sim' : v === false || v == null || v === '' ? '—' : String(v);
  CAMPOS.forEach(([campo, rotulo]) => {
    const a = local ? local[campo] : null, b = servidor ? servidor[campo] : null;
    if (JSON.stringify(a ?? '') !== JSON.stringify(b ?? '')) out.push({ rotulo, minha: mostrar(a), outra: mostrar(b) });
  });
  const dl = (local && local.designerAtribuido && local.designerAtribuido.nome) || '';
  const ds = (servidor && servidor.designerAtribuido && servidor.designerAtribuido.nome) || '';
  if (dl !== ds) out.push({ rotulo: 'Designer', minha: dl || '—', outra: ds || '—' });
  const pl = (local && local.pranchas || []).length, ps = (servidor && servidor.pranchas || []).length;
  if (pl !== ps) out.push({ rotulo: 'Versões de prancha', minha: String(pl), outra: String(ps) });
  return out;
}

// UM conflito por vez na tela. Sem esta fila, dois briefings conflitando (ou
// um conflito + a confirmação de apagar) empilhavam modais persistentes um em
// cima do outro -- na rua vira uma parede de decisões e o toque certo sai errado.
const _conflitosNaFila = [];
let _conflitoAberto = false;
function _proximoConflito() {
  _conflitoAberto = false;
  const prox = _conflitosNaFila.shift();
  if (prox) _tratarConflito(prox.local, prox.servidor);
}

STORE.onConflict((local, servidor) => {
  if (_conflitoAberto) { _conflitosNaFila.push({ local, servidor }); return; }
  _tratarConflito(local, servidor);
});

function _tratarConflito(local, servidor) {
  // Ação pontual do detalhe esbarrou em edição alheia: reaplica a intenção
  // por cima da versão nova e segue o baile -- nada se perde, ninguém escolhe.
  const intent = local && local.id ? _intencoes.get(local.id) : null;
  if (intent && intent.tentativas < 2 && (Date.now() - intent.em) < 60000) {
    intent.tentativas++;
    STORE.aceitarServidor(servidor);
    const atual = STORE.getOS(servidor.id);
    if (atual) {
      gravarBriefing(atual, intent.mudar);
      if (BRIEF && BRIEF.id === servidor.id) BRIEF = STORE.getOS(servidor.id);
      renderApp();
      const quemFoi = (servidor && servidor.atualizadoPor) || 'outro aparelho';
      toast(quemFoi + ' salvou primeiro — sua mudança foi reaplicada por cima da versão mais nova ✓', 'sucesso');
      _proximoConflito();
      return;
    }
  }
  if (local && local.id) _intencoes.delete(local.id);
  _conflitoAberto = true;
  const rl = resumoVersao(local), rs = resumoVersao(servidor);
  const quem = (servidor && servidor.atualizadoPor) || 'outra pessoa';
  const quando = servidor && servidor.atualizadoEm ? fmtDataHora(servidor.atualizadoEm) : '';
  const localMaior = (rl.itens + rl.fotos + rl.medidas) > (rs.itens + rs.fotos + rs.medidas);
  const linha = (r) => r.itens + ' item(ns) · ' + r.medidas + ' medida(s) · ' + r.fotos + ' foto(s)';
  const m = abrirModal(
    '<h3>Alterado em outro aparelho</h3>' +
    '<p>O briefing de <b>' + esc((local && local.cliente) || 'cliente') + '</b> foi alterado por <b>' + esc(quem) + '</b>' +
    (quando ? ' em ' + esc(quando) : '') + ' enquanto você editava aqui. Qual versão vale?</p>' +
    '<div class="comparar-versoes">' +
    '<div class="versao"><div class="rot">A SUA (aqui)</div><div class="dados">' + linha(rl) + '</div></div>' +
    '<div class="versao"><div class="rot">A do outro aparelho</div><div class="dados">' + linha(rs) + '</div></div>' +
    '</div>' +
    (function () {
      const difs = diferencasVersoes(local, servidor).slice(0, 6);
      if (!difs.length) return '';
      return '<div class="card" style="margin-top:10px"><div class="sub-secao" style="margin-top:0">O que difere</div>' +
        difs.map(d => '<div class="dupla-dado"><dt>' + esc(d.rotulo) + '</dt><dd>' +
          esc(d.minha) + ' <span style="color:var(--cinza-4)">(sua)</span> · ' +
          esc(d.outra) + ' <span style="color:var(--cinza-4)">(outro)</span></dd></div>').join('') + '</div>';
    })() +
    (localMaior ? '<div class="aviso amarelo">A sua versão tem mais coisa. Usar a do outro aparelho apaga o que você mediu aqui.</div>' : '') +
    '<div class="acoes-modal">' +
    '<button class="botao btn-minha">Manter a minha</button>' +
    '<button class="botao fantasma btn-serv">Usar a do outro aparelho</button></div>',
    { persistente: true } // decisão obrigatória: não fecha no toque fora
  );
  $('.btn-serv', m).onclick = () => {
    const aplicar = () => {
      STORE.aceitarServidor(servidor);
      if (BRIEF && BRIEF.id === servidor.id) BRIEF = STORE.getOS(servidor.id);
      m.remove(); renderApp(); toast('Versão do outro aparelho aplicada');
      _proximoConflito();
    };
    // Segunda confirmação só quando há mesmo o que perder.
    if (localMaior) {
      confirmar('Apagar o que você mediu aqui?',
        'A sua versão (' + linha(rl) + ') vai ser trocada pela do outro aparelho e <b>não dá pra desfazer</b>.',
        'Sim, usar a do outro', aplicar, true);
    } else aplicar();
  };
  $('.btn-minha', m).onclick = () => {
    STORE.sobrescreverServidor(local);
    m.remove(); toast('Sua versão foi mantida e reenviada');
    _proximoConflito();
  };
}

STORE.on('quota', () => toast('Memória do aparelho cheia — briefings novos podem não estar sendo salvos. Sincronize e apague briefings antigos.', 'erro'));
STORE.on('restauracao-servidor', (d) => {
  toast((d && d.n) + ' briefing(s) do backup estavam mais novos no servidor e foram mantidos como estão lá.', 'sucesso');
});
STORE.on('item-descartado', (d) => {
  const cli = d && d.item && d.item.os && d.item.os.cliente ? ' de ' + d.item.os.cliente : '';
  toast('O briefing' + cli + ' não conseguiu subir pro design. Ele está marcado na lista com "NÃO SUBIU" — toque pra tentar de novo.', 'erro');
});

window.addEventListener('hashchange', () => { lerRota(); renderApp(); });

async function boot() {
  if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js'); } catch {} }
  // Já logado neste aparelho: vai direto pra área do perfil. Antes, toda
  // abertura caía em "Escolha por onde você entra" e exigia mais um toque --
  // e tocar na porta errada dava aviso vermelho e um login inútil.
  if (SESSAO && (location.hash === '' || location.hash === '#/' || location.hash === '#/inicio')) {
    const porPapel = { vendedor: '#/lista', designer: '#/lista', admin: '#/lista' };
    location.hash = porPapel[SESSAO.papel] || '#/lista';
  }
  lerRota();
  renderApp(); // mostra o cache na hora; a rede atualiza quando chegar
  // Config e lista buscam EM PARALELO (antes era em fila: esperava a config pra
  // só então buscar a lista -- dois round-trips somados, sentidos no cold start
  // da manhã). Cada um redesenha quando chega.
  // Só concluir a partir de uma lista RECÉM-conferida. pullCFG devolve false
  // quando não conseguiu falar com o servidor; antes, o retorno era ignorado e
  // a conferência rodava contra a cópia velha do aparelho. Isso não doía
  // enquanto o login também vinha dessa cópia — agora dói: dá para ter sessão
  // legítima de alguém que este aparelho nunca viu, ser expulso por uma lista
  // desatualizada e não conseguir voltar, porque entrar agora exige internet.
  STORE.pullCFG().then(ok => { if (ok) conferirAcesso(); renderApp(); });
  STORE.pull(() => renderApp()).then(() => STORE.trySync());

  // Sincronização de fundo: só com o app À VISTA (não gasta bateria/dados em
  // segundo plano) e sempre reenviando a fila junto (item preso não fica parado).
  setInterval(() => {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    // A config vem junto: é o que revoga o acesso de quem foi desligado sem
    // depender da pessoa fechar e reabrir o app.
    STORE.pullCFG().then(ok => ok && conferirAcesso());
    STORE.pull(atualizarPorSync);
    STORE.trySync();
  }, 60000);
  // Voltar pro app (destravar a tela, trocar de aba) sincroniza na hora, em vez
  // de esperar até 60s -- é quando o vendedor mais quer ver o estado fresco.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { STORE.pull(atualizarPorSync); STORE.trySync(); }
  });
}

// Desligar alguém no painel tem que TIRAR o acesso. Antes, quem já estava
// logado seguia usando o app pra sempre (a sessão só era conferida no login).
// Confere contra a config recém-baixada: sumiu da equipe ou foi desativado,
// cai fora -- e o papel também é atualizado se o admin tiver mudado.
function conferirAcesso() {
  if (!SESSAO) return;
  const cfg = STORE.getCFG();
  const equipe = cfg.usuarios || [];
  if (!equipe.length) return; // sem lista baixada não dá pra concluir nada
  const u = equipe.find(x => norm(x.usuario) === norm(SESSAO.usuario));
  if (!u || u.ativo === false) {
    STORE.setUser(null); AUTH.esquecer(); SESSAO = null; zerarEstadoDeTela();
    location.hash = '#/login';
    toast(u ? 'Seu acesso foi desativado pelo administrador.' : 'Seu usuário não está mais na equipe.', 'erro');
    return;
  }
  // Papel rebaixado/promovido no painel vale na hora (um ex-admin não pode
  // continuar com as ações de admin na mão).
  if (u.papel && u.papel !== SESSAO.papel) {
    SESSAO = Object.assign({}, SESSAO, { papel: u.papel, nome: u.nome || SESSAO.nome });
    STORE.setUser(SESSAO);
    toast('Seu perfil agora é ' + u.papel + '.', 'sucesso');
    // Sem redesenhar, um ex-admin continuava com o Painel aberto e funcional
    // até trocar de tela (renderAdmin se auto-protege ao re-renderizar; e a
    // promoção passa a mostrar o link do Painel na hora).
    renderApp();
  }
}

// Chamado quando a sincronização de fundo traz novidade. Na LISTA, troca só os
// cartões -- redesenhar a tela inteira (como antes) tirava o cursor da busca e
// comia o que o designer estava digitando. No detalhe, redesenha só se não
// houver um campo de texto em foco.
function atualizarPorSync() {
  // Se o briefing aberto no editor foi pra lixeira em outro aparelho, trava o
  // editor -- senão o salvamento automático o traz de volta, e o log passa a
  // culpar quem estava só digitando ("restaurou da lixeira").
  if (ROTA.nome === 'editor' && BRIEF) {
    const atual = STORE.getOS(BRIEF.id);
    if (atual && atual.apagadoEm && !BRIEF.apagadoEm) {
      _timerSalvar && clearTimeout(_timerSalvar);
      _salvarPendente = false;
      const quem = atual.apagadoPor ? ' por ' + atual.apagadoPor : '';
      BRIEF = null; // impede autosave de ressuscitar
      abrirModal('<h3>Este briefing foi movido pra lixeira</h3>' +
        '<p>Alguém' + esc(quem) + ' moveu este briefing pra lixeira enquanto você editava. Suas alterações não valem mais.</p>' +
        '<div class="acoes-modal"><button class="botao btn-ok">Entendi</button></div>');
      const m = $('#overlays').lastElementChild;
      if (m) $('.btn-ok', m).onclick = () => { m.remove(); location.hash = '#/lista'; };
      return;
    }
  }
  if (ROTA.nome === 'lista') {
    if (typeof _refreshCards === 'function') _refreshCards();
    return;
  }
  if (ROTA.nome === 'detalhe') {
    const ativo = document.activeElement;
    const digitando = ativo && /^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName);
    if (!digitando) renderApp();
  }
}
// Atalho pra atualizar só os cartões da lista, sem mexer nos filtros.
let _refreshCards = null;

function lerRota() {
  const h = location.hash.replace(/^#\/?/, '');
  const partes = h.split('/');
  // Porta de entrada: escolhe Comercial ou Designer antes de qualquer login
  if (h === '' || h === 'inicio') { ROTA = { nome: 'inicio' }; return; }
  if (partes[0] === 'entrar') { ROTA = { nome: 'login', area: partes[1] || 'comercial' }; return; }
  if (h === 'trocar-senha') { ROTA = { nome: 'senha' }; return; }
  if (!SESSAO) { ROTA = { nome: 'inicio' }; return; }
  if (h === 'agenda') ROTA = { nome: 'agenda' };
  else if (h === 'lista') ROTA = { nome: 'lista' };
  else if (h === 'login') ROTA = { nome: 'login', area: 'comercial' };
  else if (h === 'novo') ROTA = { nome: 'novo' };
  else if (partes[0] === 'editar') ROTA = { nome: 'editor', id: partes[1] };
  else if (partes[0] === 'b') ROTA = { nome: 'detalhe', id: partes[1], aba: partes[2] || 'dados' };
  else if (partes[0] === 'admin') ROTA = { nome: 'admin', aba: partes[1] || 'usuarios' };
  else if (partes[0] === 'layout') ROTA = { nome: 'layout', modo: partes[1] || '', id: partes[2] || '' };
  else if (h === 'arquivos') ROTA = { nome: 'arquivos' };
  else ROTA = { nome: 'lista' };
}

/* ══════════════════ Layout base ══════════════════ */

function podeCriar() { return SESSAO && (SESSAO.papel === 'vendedor' || SESSAO.papel === 'admin'); }

// Texto do botão de sincronização, a partir do estado atual.
function rotuloSync(status, pendentes) {
  if (status === 'ok') return 'Sincronizado';
  if (status === 'pending') {
    // Item que já falhou várias vezes não pode se esconder atrás do rótulo de
    // fila saudável: o vendedor precisa saber que tem algo precisando de ajuda.
    const comErro = STORE.filaComErro();
    return (pendentes || 0) + ' pendente(s)' + (comErro ? ' — ' + comErro + ' com erro' : '');
  }
  // "Servidor fora" ≠ "Offline": o celular tem internet, quem não respondeu foi
  // o sistema. Mandar procurar sinal que já existe só gera ligação pro escritório.
  if (status === 'servidor') return 'Servidor fora';
  return 'Sem internet';
}

function htmlTopo(tituloTela) {
  const chip = SYNC_ESTADO.status;
  return (
    '<header class="topo">' +
    // A logo leva pra tela inicial: é o "voltar pro começo" que todo mundo
    // tenta por instinto. Sem isso, só o menu ☰ saía das telas internas.
    '<a class="marca" href="#/" title="Voltar para a tela inicial">' +
    '<img src="logo-impresilk.png" alt="Impresilk">' +
    '<div><div class="titulo">' + esc(tituloTela || 'Brief de Medição') + '</div>' +
    '<div class="sub">Impresilk · ' + esc(SESSAO ? SESSAO.nome : '') + '</div></div>' +
    '</a>' +
    // Navegação SEMPRE visível, inclusive no celular (vira uma faixa de
    // atalhos embaixo do título). Antes ela sumia abaixo de 900px e a única
    // saída era o ☰ -- quem usa no celular, que é a maioria, não descobria que
    // existiam Arquivos e Gerador de layout.
    '<nav class="nav-topo">' +
    (souMedidor()
      ? '<a href="#/agenda" class="' + (ROTA.nome === 'agenda' ? 'ativo' : '') + '">📍 Minhas visitas</a>'
      : '<a href="#/lista" class="' + (ROTA.nome === 'lista' ? 'ativo' : '') + '">📋 Briefings</a>') +
    // Quem não é medidor mas tem visita marcada no nome (vendedor que vai medir,
    // gestão) só descobria isso abrindo briefing por briefing. O atalho aparece
    // sozinho quando existe compromisso, e some quando não existe.
    (!souMedidor() && SESSAO && AREAS.medicao.papeis.includes(SESSAO.papel) && contarCompromissos()
      ? '<a href="#/agenda" class="' + (ROTA.nome === 'agenda' ? 'ativo' : '') + '">📍 Minhas visitas' +
        '<span class="marcador-nav">' + contarCompromissos() + '</span></a>'
      : '') +
    (podeCriar() ? '<a href="#/novo" class="' + (ROTA.nome === 'novo' || ROTA.nome === 'editor' ? 'ativo' : '') + '">➕ Novo</a>' : '') +
    (podeVerArquivos() ? '<a href="#/arquivos" class="' + (ROTA.nome === 'arquivos' ? 'ativo' : '') + '">🖼 Arquivos</a>' : '') +
    (podeUsarLayout() ? '<a href="#/layout" class="' + (ROTA.nome === 'layout' ? 'ativo' : '') + '">🗂 Layout</a>' : '') +
    (SESSAO && SESSAO.papel === 'admin' ? '<a href="#/admin" class="' + (ROTA.nome === 'admin' ? 'ativo' : '') + '">🛠 Painel</a>' : '') +
    '</nav>' +
    // O estado da sincronização é BOTÃO, não etiqueta: antes ele só informava, e
    // quem via "2 pendente(s)" não tinha onde apertar -- tinha que abrir o menu
    // e achar "Sincronizar agora". Agora o próprio aviso resolve.
    '<button type="button" id="chip-sync" class="chip-sync ' + chip + '" ' +
    'title="Tocar para sincronizar agora">' + esc(rotuloSync(chip, SYNC_ESTADO.pendentes)) + '</button>' +
    '<button class="botao-menu" id="botao-menu" aria-label="Menu">☰</button>' +
    '</header>'
  );
}

function ligarTopo() {
  const b = $('#botao-menu');
  if (b) b.onclick = abrirMenu;
  const sair = $('#link-sair-desktop');
  if (sair) sair.onclick = e => { e.preventDefault(); sairDaConta(); };
  const chip = $('#chip-sync');
  if (chip) chip.onclick = () => sincronizarAgora();
  // No celular a faixa de navegação rola de lado. Se a tela aberta é a última
  // da fila (Painel), o atalho dela ficava escondido fora da vista.
  const ativo = $('.nav-topo a.ativo');
  if (ativo && ativo.scrollIntoView) ativo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// Sincroniza e DIZ o que aconteceu. O botão fica travado enquanto roda, senão
// dá pra disparar cinco vezes seguidas achando que não funcionou.
async function sincronizarAgora() {
  if (_sincronizando) return;
  _sincronizando = true;
  const chip = $('#chip-sync');
  if (chip) { chip.disabled = true; chip.classList.add('rodando'); chip.textContent = 'Sincronizando…'; }
  try {
    // pull devolve undefined quando NÃO conseguiu falar com o servidor. Sem
    // olhar isso, uma fila vazia virava "Tudo sincronizado ✓" mesmo com o
    // servidor fora do ar -- a mentira mais cara que este botão podia contar.
    let r = await STORE.pull(() => renderApp());
    // Coincidiu com um pull de fundo? Espera ele terminar e tenta de novo, em
    // vez de acusar "servidor fora" com o servidor no ar.
    if (r && r.pulou) { await new Promise(res => setTimeout(res, 900)); r = await STORE.pull(() => renderApp()); }
    await STORE.trySync();
    const pend = (STORE.getQueue() || []).length;
    if (!navigator.onLine) toast('Sem conexão agora. Sincroniza sozinho quando voltar o sinal.', 'erro');
    else if (!r) toast('Não consegui falar com o servidor agora. O que você fez está salvo neste aparelho.', 'erro');
    else if (r.pulou && pend === 0) toast('Sincronização já estava rodando — está tudo em dia.', 'sucesso');
    else if (pend > 0) toast(pend + ' item(ns) ainda na fila. Continua tentando sozinho.', 'erro');
    else toast('Tudo sincronizado ✓', 'sucesso');
  } catch (e) {
    toast('Não consegui sincronizar agora: ' + (e && e.message ? e.message : 'sem conexão'), 'erro');
  } finally {
    _sincronizando = false;
    const c = $('#chip-sync');
    if (c) {
      c.disabled = false; c.classList.remove('rodando');
      c.className = 'chip-sync ' + SYNC_ESTADO.status;
      c.textContent = rotuloSync(SYNC_ESTADO.status, SYNC_ESTADO.pendentes);
    }
  }
}

function abrirMenu() {
  const fundo = document.createElement('div');
  fundo.className = 'menu-fundo';
  fundo.onclick = () => { fundo.remove(); sheet.remove(); };
  const sheet = document.createElement('div');
  sheet.className = 'menu-sheet';
  sheet.innerHTML =
    '<div class="quem">' + esc(SESSAO.nome) + '</div>' +
    '<div class="papel">Perfil: ' + esc(SESSAO.papel) + '</div>' +
    '<a href="#/lista">📋 Briefings</a>' +
    (podeCriar() ? '<a href="#/novo">➕ Novo briefing</a>' : '') +
    (podeVerArquivos() ? '<a href="#/arquivos">🖼 Arquivos</a>' : '') +
    (podeUsarLayout() ? '<a href="#/layout">🗂 Gerador de layout</a>' : '') +
    (SESSAO.papel === 'admin' ? '<a href="#/admin">🛠 Painel de controle</a>' : '') +
    '<a href="#/">🏠 Tela inicial</a>' +
    '<button class="item" id="menu-ficha">🖨 Ficha de visita em branco (PDF)</button>' +
    '<button class="item" id="menu-manual">❓ Manual de medição e fotos</button>' +
    '<button class="item" id="menu-sync">🔄 Sincronizar agora</button>' +
    '<a href="#/trocar-senha">🔑 Trocar a minha senha</a>' +
    '<button class="item" id="menu-sair">🚪 Sair da conta</button>';
  document.body.appendChild(fundo);
  document.body.appendChild(sheet);
  const fechar = () => { fundo.remove(); sheet.remove(); };
  $$('a', sheet).forEach(a => a.addEventListener('click', fechar));
  $('#menu-manual', sheet).onclick = () => { fechar(); abrirManual(); };
  $('#menu-ficha', sheet).onclick = () => { fechar(); exportarFichaVisita(null); };
  $('#menu-sync', sheet).onclick = async () => { fechar(); toast('Sincronizando…'); await STORE.pull(() => renderApp()); STORE.trySync(); };
  $('#menu-sair', sheet).onclick = () => { fechar(); sairDaConta(); };
}

// Zera o estado que é só de TELA (não é dado). Sem isto, o filtro do designer
// ("Só os meus") ficava ligado pro vendedor que entrasse no mesmo aparelho --
// e ele nem via o chip pra desligar. O rascunho do editor de fichas também
// sobrevivia e voltava como se fosse o que está salvo.
function zerarEstadoDeTela() {
  FILTROS = filtrosZerados();
  PROD = prodVazio();
  PROJ = projVazio();
  LOTE = null;
  BRIEF = null;
  ETAPA = 1;
  FICHAS_EDIT = null; _fichasSuja = false; _configSuja = false;
  ITENS_RECOLHIDOS.clear(); OS_ITENS_DESMARCADOS.clear();
}

function sairDaConta() {
  const pendentes = (STORE.getQueue() || []).length;
  const m = abrirModal(
    '<h3>Sair da conta</h3>' +
    '<p>Os briefings deste aparelho continuam salvos e sincronizam quando você entrar de novo.</p>' +
    (pendentes ? '<div class="aviso amarelo">Atenção: ' + pendentes + ' item(ns) ainda não subiram. ' +
      'Se limpar o aparelho agora, esse trabalho se perde.</div>' : '') +
    '<p class="dica-campo" style="margin-top:10px">Vai devolver ou emprestar este celular? Use <b>Sair e limpar</b>: apaga os briefings e a senha guardada aqui.</p>' +
    '<div class="acoes-modal">' +
    '<button class="botao fantasma btn-cancelar">Cancelar</button>' +
    '<button class="botao perigo btn-limpar">Sair e limpar</button>' +
    '<button class="botao btn-sair">Sair</button></div>'
  );
  $('.btn-cancelar', m).onclick = () => m.remove();
  $('.btn-sair', m).onclick = () => {
    m.remove();
    STORE.setUser(null); AUTH.esquecer(); SESSAO = null;
    zerarEstadoDeTela();
    location.hash = '#/login';
  };
  // Limpa de verdade: sem isto, "Sair" deixava briefings, fotos e o usuário
  // lembrado no aparelho -- quem pegasse o celular via tudo.
  $('.btn-limpar', m).onclick = () => {
    m.remove();
    confirmar('Apagar tudo deste aparelho?',
      'Vai apagar os briefings, as fotos e a senha guardados <b>neste celular</b>' +
      (pendentes ? ', inclusive <b>' + pendentes + ' item(ns) que ainda não subiram</b>' : '') +
      '. O que já sincronizou continua na nuvem. Não dá pra desfazer.',
      'Apagar e sair', async () => {
        try {
          Object.keys(localStorage).filter(k => k.indexOf('app_sync') === 0).forEach(k => localStorage.removeItem(k));
          if (window.indexedDB && indexedDB.databases) {
            const bancos = await indexedDB.databases().catch(() => []);
            bancos.forEach(db => { if (db.name && /foto|brief/i.test(db.name)) indexedDB.deleteDatabase(db.name); });
          }
        } catch (e) { console.warn('limpeza parcial:', e); }
        SESSAO = null;
        location.hash = '#/login';
        location.reload();
      }, true);
  };
}

function renderApp() {
  const app = $('#app');
  flushSalvar(); // nunca redesenhar por cima de digitação ainda não gravada
  if (!SESSAO && ROTA.nome !== 'login' && ROTA.nome !== 'inicio') { location.hash = '#/'; return; }
  // Senha temporária é obrigação, não sugestão: fechar e reabrir o app não pode
  // servir de desvio. A trava mora aqui, não no redirecionamento do login.
  if (SESSAO && SESSAO.trocarSenha && ROTA.nome !== 'senha') { location.hash = '#/trocar-senha'; return; }
  // Saiu do painel de controle: o rascunho do editor de fichas não vale mais
  // (ao voltar, a aba relê o que está salvo).
  if (ROTA.nome !== 'admin') _fichasAbaViva = false;
  switch (ROTA.nome) {
    case 'inicio': return renderInicio(app);
    case 'layout': return renderLayout(app);
    case 'arquivos': return renderArquivos(app);
    case 'login': return renderLogin(app);
    case 'senha': return renderTrocarSenha(app);
    case 'novo': return criarNovo();
    case 'editor': return renderEditor(app);
    case 'detalhe': return renderDetalhe(app);
    case 'admin': return renderAdmin(app);
    case 'agenda': return renderAgenda(app);
    // O medidor não tem lista de briefings: a casa dele é a agenda. Cair na
    // lista mostraria briefing que não é dele e telas que não pode usar.
    default: return souMedidor() ? renderAgenda(app) : renderLista(app);
  }
}

/* ══════════════════ Tela inicial ══════════════════ */

// Qual área cada perfil pode abrir
const AREAS = {
  comercial: { rotulo: 'Comercial', papeis: ['vendedor', 'admin'], destino: '#/lista' },
  designer:  { rotulo: 'Designer',  papeis: ['designer', 'admin'], destino: '#/lista' },
  // Quem vai à rua medir. A casa dele é a AGENDA (o que tem pra hoje), não a
  // lista de briefings -- ele pensa em compromisso, não em cadastro.
  // `vendedor` entra aqui de propósito: a etapa 3 oferece vendedores na lista de
  // quem vai medir (e é comum o próprio vendedor voltar pra medir). Sem isso, a
  // visita era direcionada a ele e ele não tinha porta nenhuma pra enxergar —
  // atribuição que não chega em ninguém é pior que atribuição nenhuma.
  medicao:   { rotulo: 'Medição',   papeis: ['medidor', 'vendedor', 'admin'], destino: '#/agenda' },
  admin:     { rotulo: 'Painel de controle', papeis: ['admin'],    destino: '#/admin' }
};

function souMedidor() { return SESSAO && SESSAO.papel === 'medidor'; }
function medidoresAtivos() {
  return ((STORE.getCFG() || {}).usuarios || [])
    .filter(u => (u.papel === 'medidor' || u.papel === 'vendedor') && u.ativo !== false)
    .map(u => ({ ...u, id: u.id || u.usuario }));
}
// Briefings direcionados a mim (a agenda do medidor).
function meusCompromissos() {
  const eu = norm(SESSAO && SESSAO.usuario);
  return STORE.getAllOS()
    .filter(b => b && !b.apagadoEm && !b.avulsa)
    .filter(b => b.medidorAtribuido && norm(b.medidorAtribuido.usuario) === eu);
}
// Só as que ainda faltam fazer — o crachá no menu não pode contar as concluídas,
// senão ele nunca zera e vira enfeite.
function contarCompromissos() {
  return meusCompromissos().filter(b => !b.visitaConcluida).length;
}

function renderInicio(app) {
  document.title = 'Impresilk · Brief de Medição';
  // Já logado neste aparelho: entra direto na área do perfil
  const atalho = SESSAO
    ? '<div class="aviso-sessao">Conectado como <b>' + esc(SESSAO.nome) + '</b> (' + esc(SESSAO.papel) + ')' +
      ' · <a href="#" id="ini-sair">trocar de usuário</a></div>'
    : '';
  app.innerHTML =
    '<div class="tela-inicio">' +
    '<div class="miolo-inicio">' +
    '<img class="logo-inicio" src="logo-impresilk.png" alt="Impresilk">' +
    '<h1 class="titulo-inicio">Brief de Medição</h1>' +
    '<p class="sub-inicio">Escolha por onde você entra</p>' +
    atalho +
    '<div class="portas">' +
    '<button class="porta" data-area="comercial">' +
    '<span class="icone-porta">📐</span>' +
    '<span class="nome-porta">COMERCIAL</span>' +
    '<span class="desc-porta">Fazer o briefing na visita ao cliente</span></button>' +
    '<button class="porta" data-area="designer">' +
    '<span class="icone-porta">🎨</span>' +
    '<span class="nome-porta">DESIGNER</span>' +
    '<span class="desc-porta">Receber briefings e gerar pranchas</span></button>' +
    '<button class="porta" data-area="medicao">' +
    '<span class="icone-porta">📍</span>' +
    '<span class="nome-porta">MEDIÇÃO</span>' +
    '<span class="desc-porta">Suas visitas do dia: medir e fotografar</span></button>' +
    '</div>' +
    '<a href="#" class="link-admin" id="ini-admin">Painel de controle</a>' +
    '</div></div>';

  $$('[data-area]').forEach(bt => bt.onclick = () => irParaArea(bt.dataset.area));
  $('#ini-admin').onclick = e => { e.preventDefault(); irParaArea('admin'); };
  const sair = $('#ini-sair');
  if (sair) sair.onclick = e => {
    e.preventDefault();
    STORE.setUser(null); AUTH.esquecer(); SESSAO = null; zerarEstadoDeTela(); renderApp();
  };
}

// Entra na área: se já há login válido pra ela, vai direto; senão pede o login.
function irParaArea(area) {
  const def = AREAS[area] || AREAS.comercial;
  if (SESSAO && def.papeis.includes(SESSAO.papel)) {
    location.hash = def.destino;
    return;
  }
  if (SESSAO) {
    toast('Seu usuário (' + SESSAO.papel + ') não abre a área ' + def.rotulo + '. Troque de usuário.', 'erro');
  }
  location.hash = '#/entrar/' + area;
}

/* ══════════════════ Login ══════════════════ */

function renderLogin(app) {
  const area = ROTA.area || 'comercial';
  const def = AREAS[area] || AREAS.comercial;
  document.title = 'Entrar · ' + def.rotulo;
  // Login lembrado no aparelho: só falta a senha
  const lembrado = STORE.getUsuarioLembrado ? STORE.getUsuarioLembrado() : '';
  app.innerHTML =
    '<div class="tela-login"><div class="cartao-login">' +
    '<img class="logo" src="logo-impresilk.png" alt="Impresilk">' +
    '<h1>' + esc(def.rotulo) + '</h1>' +
    '<div class="sub">Entre com seu usuário da equipe</div>' +
    '<div class="campo"><label>Usuário</label><input id="lg-usuario" type="text" autocomplete="username" autocapitalize="none" value="' + esc(lembrado) + '"></div>' +
    '<div class="campo"><label>Senha</label><input id="lg-senha" type="password" autocomplete="current-password"></div>' +
    '<label class="chip marcado" id="lg-lembrar" style="margin-bottom:12px; display:inline-flex">Lembrar neste aparelho</label>' +
    '<div id="lg-erro"></div>' +
    '<button class="botao largo" id="lg-entrar">Entrar</button>' +
    '<a href="#/" class="voltar-inicio">← voltar</a>' +
    '<p class="dica-campo" style="text-align:center; margin-top:12px">Entrar precisa de internet. Depois de entrar, o app funciona offline.</p>' +
    '</div></div>';
  let lembrar = true;
  $('#lg-lembrar').onclick = () => { lembrar = !lembrar; $('#lg-lembrar').classList.toggle('marcado', lembrar); };
  const erroLogin = html => { const el = $('#lg-erro'); if (el) el.innerHTML = '<div class="aviso vermelho">' + html + '</div>'; };
  let entrando = false;
  const entrar = async () => {
    // Enter não olha para o botão desabilitado: na rua, com rede lenta, o
    // vendedor apertava duas vezes e saíam dois logins.
    if (entrando) return;
    const usuario = $('#lg-usuario').value.trim();
    const senha = $('#lg-senha').value;
    if (!usuario || !senha) { erroLogin('Preencha usuário e senha.'); return; }
    entrando = true;
    const bt = $('#lg-entrar');
    bt.disabled = true; bt.textContent = 'Entrando…';
    let r;
    try {
      // A conferência acontece no servidor. A senha não mora mais no pacote de
      // configuração que todo aparelho baixa — era assim que ela vazava.
      r = await AUTH.login(usuario, senha);
    } catch (e) {
      entrando = false; bt.disabled = false; bt.textContent = 'Entrar';
      if (e.status === 401 || e.status === 403) { erroLogin(esc(e.erro || 'Usuário ou senha incorretos.')); return; }
      erroLogin('Não consegui falar com o servidor. <b>Entrar precisa de internet</b> — ' +
        'depois de entrar, o app trabalha offline normalmente.');
      return;
    }
    entrando = false; bt.disabled = false; bt.textContent = 'Entrar';
    if (!def.papeis.includes(r.papel)) {
      AUTH.esquecer();
      erroLogin('O usuário <b>' + esc(r.usuario) + '</b> é ' + esc(r.papel) +
        ' e não abre a área ' + esc(def.rotulo) + '.');
      return;
    }
    STORE.setUser({ usuario: r.usuario, nome: r.nome, papel: r.papel, trocarSenha: !!r.trocarSenha });
    STORE.setUsuarioLembrado(lembrar ? r.usuario : '');
    SESSAO = STORE.getUser();
    zerarEstadoDeTela(); // entra limpo: nada do usuário anterior atravessa
    // Senha criada por outra pessoa: a primeira coisa é trocar.
    if (r.trocarSenha) { location.hash = '#/trocar-senha'; return; }
    location.hash = def.destino;
  };
  $('#lg-entrar').onclick = entrar;
  $('#lg-senha').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
}

/* ══════════════════ Trocar a senha ══════════════════ */

// Senha criada por outra pessoa (gestão ou Central) nasce TEMPORÁRIA: a pessoa
// é obrigada a trocar antes de usar o app. Assim ninguém segue trabalhando com
// uma senha que um terceiro conhece.
function renderTrocarSenha(app) {
  const obrigado = !!(SESSAO && SESSAO.trocarSenha);
  document.title = 'Trocar a senha';
  app.innerHTML =
    '<div class="tela-login"><div class="cartao-login">' +
    '<img class="logo" src="logo-impresilk.png" alt="Impresilk">' +
    '<h1>' + (obrigado ? 'Crie a sua senha' : 'Trocar a senha') + '</h1>' +
    '<div class="sub">' + (obrigado
      ? 'A senha atual foi criada por outra pessoa. Escolha a sua para continuar.'
      : esc((SESSAO && SESSAO.nome) || '')) + '</div>' +
    (obrigado ? '' : '<div class="campo"><label>Senha atual</label><input id="sn-atual" type="password" autocomplete="current-password"></div>') +
    '<div class="campo"><label>Senha nova (mínimo 6)</label><input id="sn-nova" type="password" autocomplete="new-password"></div>' +
    '<div class="campo"><label>Repita a senha nova</label><input id="sn-rep" type="password" autocomplete="new-password"></div>' +
    '<div id="sn-erro"></div>' +
    '<button class="botao largo" id="sn-salvar">Salvar</button>' +
    (obrigado
      ? '<button class="botao fantasma largo" id="sn-outro" style="margin-top:10px">Entrar com outro usuário</button>'
      : '<a href="#/lista" class="voltar-inicio">← voltar</a>') +
    '</div></div>';
  // Sem esta saída, quem caísse aqui sem saber a senha ficava preso na tela.
  const outro = $('#sn-outro');
  if (outro) outro.onclick = () => {
    AUTH.esquecer(); STORE.setUser(null); SESSAO = null; location.hash = '#/';
  };
  const erro = html => { $('#sn-erro').innerHTML = '<div class="aviso vermelho">' + html + '</div>'; };
  $('#sn-salvar').onclick = async () => {
    const atual = obrigado ? '' : ($('#sn-atual').value || '');
    const nova = $('#sn-nova').value || '';
    if (nova.length < 6) { erro('A senha nova precisa de ao menos 6 caracteres.'); return; }
    if (nova !== ($('#sn-rep').value || '')) { erro('As duas senhas novas não são iguais.'); return; }
    const bt = $('#sn-salvar'); bt.disabled = true; bt.textContent = 'Salvando…';
    try {
      await AUTH.trocarMinhaSenha(atual, nova);
    } catch (e) {
      bt.disabled = false; bt.textContent = 'Salvar';
      erro(esc(e.erro || 'Não consegui trocar a senha agora. Tente de novo com internet.'));
      return;
    }
    STORE.setUser(Object.assign({}, SESSAO, { trocarSenha: false }));
    SESSAO = STORE.getUser();
    toast('Senha trocada ✓', 'sucesso');
    location.hash = '#/lista';
  };
}

/* ══════════════════ Gerador de layout (pranchas) ══════════════════ */

let LOTE = null; // lote de pranchas sendo montado na tela

function podeUsarLayout() {
  return SESSAO && (SESSAO.papel === 'designer' || SESSAO.papel === 'admin');
}

// Monta a prancha a partir de um briefing (ou dos dados avulsos do modo projeto)
function montarPrancha(base, extra) {
  const cfg = STORE.getCFG();
  const b = base || {};
  return Object.assign({
    id: STORE.uuid(),
    cliente: b.cliente || '',
    contato: b.responsavel || b.cliente || '',
    telefone: b.telefone || '',   // vai pra prancha da rua (instalação)
    vendedor: b.vendedor || '',
    designer: (SESSAO && SESSAO.nome) || '',
    osNumero: String(b.osNumero || '').trim(),
    endereco: b.endereco || '',
    data: new Date().toISOString(),
    dataEntrega: '',
    obs: '',
    seloServico: '',
    tituloServico: '',
    medidas: '',
    detalhe: '',
    // Urgência marcada pelo vendedor: o carimbo URGENTE já vem ligado na prévia
    // (o designer ainda pode desligar). É o padrão inteligente, não uma trava.
    urgente: !!(b.urgente),
    imagem: null,      // base64 só na hora de gerar (não vai pro registro)
    imagemId: null,    // referência da foto no store
    equipe: [], ferramentas: [], acessorios: [],
    numero: 1, total: 1,
    textoDireitos: cfg.textoDireitos || ''
  }, extra || {});
}

// Resumo das medidas do briefing pro corpo da prancha
function medidasDoBriefing(b) {
  return (b.itens || []).map((it, i) => {
    const med = (it.medidas || []).filter(m => m.largura || m.altura)
      .map(m => (m.largura || '?') + ' x ' + (m.altura || '?') + ' cm').join('  ·  ');
    const q = it.quantidade && String(it.quantidade) !== '1' ? ' (' + it.quantidade + 'x)' : '';
    return (nomeItem(it) || 'Item ' + (i + 1)) + q + (med ? ': ' + med : '');
  }).join('\n');
}

// Primeira foto útil do briefing, pro corpo da prancha
function fotoPrincipal(b) {
  for (const it of (b.itens || [])) {
    const f = (it.fotos || []).find(x => !x.arquivada);
    if (f) return f.id;
  }
  const c = (b.croquis || []).find(x => !x.arquivada);
  return c ? c.id : null;
}

function renderLayout(app) {
  if (!podeUsarLayout()) { toast('O gerador de layout é da área do designer', 'erro'); location.hash = '#/lista'; return; }
  const modo = ROTA.modo;
  // Só ENTRAR NO OUTRO modo encerra o rascunho (evita misturar dois trabalhos).
  // Passar pela tela de modos NÃO apaga mais: o designer ia conferir uma medida,
  // voltava, e o cliente/endereço/setores que ele tinha digitado sumiam.
  if (modo === 'projeto') PROD._aberto = false;
  if (modo === 'producao') PROJ._aberto = false;
  if (modo === 'producao') return renderLayoutProducao(app);
  if (modo === 'projeto') return renderLayoutProjeto(app);
  return renderLayoutInicio(app);
}

// Há rascunho aberto em algum modo? (pra avisar em vez de perder calado)
function rascunhoProducao() {
  return !!(PROD._aberto && (String(PROD.osNumero || '').trim() || String(PROD.cliente || '').trim() || PROD.setores.length));
}
function rascunhoProjeto() {
  return !!(PROJ._aberto && (PROJ.imagens.length ||
    String(PROJ.cliente || '').trim() || String(PROJ.osNumero || '').trim()));
}

function renderLayoutInicio(app) {
  document.title = 'Gerador de layout';
  const temProd = rascunhoProducao(), temProj = rascunhoProjeto();
  app.innerHTML =
    htmlTopo('Gerador de layout') +
    '<main class="miolo">' +
    '<p class="dica-campo" style="margin:4px 2px 16px">As duas opções usam o mesmo modelo de prancha, preenchido automático.</p>' +
    // O rascunho sobrevive a passar por aqui; o aviso deixa isso explícito e dá
    // o botão pra começar limpo quando é outro trabalho.
    (temProd || temProj
      ? '<div class="aviso indigo" style="margin-bottom:14px">Você tem um trabalho em andamento em <b>' +
        (temProd ? 'Produção' : 'Projeto') + '</b>. Entrar de novo continua de onde parou. ' +
        '<button class="botao mini fantasma" id="lay-zerar" style="margin-left:8px">Começar do zero</button></div>'
      : '') +
    '<div class="portas portas-layout">' +
    '<button class="porta" data-modo="producao">' +
    '<span class="icone-porta">🏭</span><span class="nome-porta">PRODUÇÃO</span>' +
    '<span class="desc-porta">Uma prancha por setor, a partir da O.S. ou de um briefing</span></button>' +
    '<button class="porta" data-modo="projeto">' +
    '<span class="icone-porta">🖼</span><span class="nome-porta">PROJETO</span>' +
    '<span class="desc-porta">Layout aprovado: solta os JPGs e sai o PDF</span></button>' +
    '</div></main>';
  ligarTopo();
  $$('[data-modo]').forEach(bt => bt.onclick = () => { location.hash = '#/layout/' + bt.dataset.modo; });
  const zerar = $('#lay-zerar');
  if (zerar) zerar.onclick = () => confirmar('Começar do zero?',
    'Vai apagar o que você já preencheu no gerador de layout.', 'Começar do zero', () => {
      PROD = prodVazio();
      PROJ = projVazio();
      renderApp();
    }, true);
}

/* ── Modo Produção ─────────────────────────────────────────────────────── */

// A prancha de produção nasce da O.S., não do briefing. O briefing é só um
// atalho opcional (traz foto e medidas já conferidas na visita): exigir um
// briefing enviado travava o designer em todo trabalho que não passou por
// visita -- que é a maioria.
// FUNÇÃO, não objeto: `Object.assign({}, PROD_VAZIO)` é cópia RASA, então o
// array `setores` era o MESMO em todos os "resets" -- marcar Router num job
// deixava Router marcado no próximo, e saía prancha de setor que ninguém pediu.
function prodVazio() {
  return {
    osNumero: '', os: null, erroOS: '', buscando: false,
    cliente: '', contato: '', vendedor: '', endereco: '',
    briefingId: '', busca: '', setores: [], urgente: false
  };
}
let PROD = prodVazio();

// Dados do cabeçalho, venham da O.S., do briefing ou da mão do designer.
function baseProducao() {
  const b = PROD.briefingId ? STORE.getOS(PROD.briefingId) : null;
  const os = PROD.os;
  return {
    cliente: PROD.cliente || (os && os.cliente) || (b && b.cliente) || '',
    responsavel: PROD.contato || (os && os.contato) || (b && b.responsavel) || '',
    telefone: (os && os.telefone) || (b && b.telefone) || '',
    vendedor: PROD.vendedor || (os && os.vendedor) || (b && b.vendedor) || '',
    endereco: PROD.endereco || (os && os.endereco) || (b && b.endereco) || '',
    osNumero: String(PROD.osNumero || (b && b.osNumero) || '').trim(),
    urgente: !!(b && b.urgente)   // urgência do vendedor → carimbo já marcado
  };
}

// Resumo das medidas vindo das linhas da O.S. (quando não há briefing)
function medidasDaOS(os) {
  return ((os && os.itens) || []).map(x => {
    const q = x.qtde && String(x.qtde) !== '1' ? ' (' + x.qtde + 'x)' : '';
    return (x.descricao || 'Item') + q + (x.medidas ? ': ' + x.medidas : '');
  }).join('\n');
}

function temDadosProducao() {
  const base = baseProducao();
  return !!(base.cliente || base.osNumero);
}

function renderLayoutProducao(app) {
  document.title = 'Pranchas de produção';
  if (!PROD._aberto) PROD = Object.assign(prodVazio(), { _aberto: true });
  const cfg = STORE.getCFG();
  const setores = cfg.setoresProducao || [];
  const b = PROD.briefingId ? STORE.getOS(PROD.briefingId) : null;
  const base = baseProducao();
  const pronto = temDadosProducao();

  const candidatos = STORE.getAllOS()
    .filter(x => x && !x.apagadoEm && !x.avulsa && x.situacao === 'enviado')
    .filter(x => {
      const t = norm(PROD.busca);
      if (!t) return true;
      return norm((x.cliente || '') + ' ' + (x.osNumero || '') + ' ' +
        (x.numeroBrief ? padBrief(x.numeroBrief) : '') + ' ' + fmtData(x.dataHora)).includes(t);
    })
    .sort((a, z) => String(z.dataHora || '').localeCompare(String(a.dataHora || '')))
    .slice(0, 40);

  app.innerHTML =
    htmlTopo('Pranchas de produção') +
    '<main class="miolo">' +
    '<a href="#/layout" class="dica-campo" style="display:inline-block; margin-bottom:10px">← modos</a>' +

    '<div class="card"><div class="sub-secao">1 · De onde vêm os dados</div>' +
    '<p class="dica-campo" style="margin-bottom:12px">Os dois caminhos valem e dá pra usar os dois juntos: a O.S. preenche o cabeçalho, o briefing traz as fotos e as medidas da visita.</p>' +

    // Os dois buscadores lado a lado. Nenhum é obrigatório: o cabeçalho embaixo
    // aceita ser preenchido na mão (e é o único caminho quando cai a internet).
    '<div class="duas-buscas">' +

    '<div class="busca-fonte">' +
    '<div class="titulo-fonte"><span>📄</span><span>Pela O.S.</span></div>' +
    '<div style="display:flex; gap:8px">' +
    '<input id="pr-os" type="text" inputmode="numeric" placeholder="Nº da O.S. — ex: 22416" value="' + esc(PROD.osNumero) + '" style="flex:1">' +
    '<button class="botao mini" id="pr-buscar"' + (PROD.buscando ? ' disabled' : '') + '>' +
    (PROD.buscando ? 'Buscando…' : 'Buscar') + '</button></div>' +
    (PROD.erroOS ? '<div class="aviso amarelo" style="margin-top:8px">' + esc(PROD.erroOS) + '</div>' : '') +
    (PROD.os
      ? '<div class="aviso verde" style="margin-top:8px"><b>' + esc(PROD.os.cliente || 'Sem nome') + '</b>' +
        (PROD.os.servico ? ' · ' + esc(PROD.os.servico) : '') +
        ((PROD.os.itens || []).length ? ' · ' + PROD.os.itens.length + ' item(ns) na O.S.' : '') +
        ' <button class="botao mini fantasma" id="pr-limpar-os" style="margin-left:8px">Trocar</button></div>'
      : '') +
    '</div>' +

    '<div class="busca-fonte">' +
    '<div class="titulo-fonte"><span>📋</span><span>Por um briefing</span></div>' +
    '<input id="pr-busca" type="text" placeholder="Cliente, O.S., Nº do brief ou data" value="' + esc(PROD.busca) + '">' +
    (b
      ? '<div class="aviso verde" style="margin-top:8px"><b>' + esc(b.cliente) + '</b>' +
        (b.numeroBrief ? ' · Nº ' + padBrief(b.numeroBrief) : '') +
        ' · ' + (b.itens || []).length + ' item(ns)' +
        (b.urgente ? ' · <b style="color:var(--perigo)">🔴 URGENTE</b>' : '') +
        // O prazo que o cliente pediu (o vendedor anotou no briefing): o designer
        // vê aqui na hora de gerar, sem precisar abrir o briefing inteiro.
        (b.obsGerais && String(b.obsGerais.prazo || '').trim()
          ? '<br><span class="dica-campo">⏱ Prazo pedido pelo cliente: <b>' + esc(b.obsGerais.prazo) + '</b></span>' : '') +
        ' <button class="botao mini fantasma" id="pr-trocar" style="margin-left:8px">Desvincular</button></div>'
      : (candidatos.length
        ? '<div class="lista-escolha rolagem-curta">' + candidatos.map(x =>
            '<button class="opcao-briefing" data-brief="' + x.id + '">' +
            '<b>' + esc(x.cliente || 'Sem nome') + '</b>' +
            '<span class="dica-campo">' + (x.numeroBrief ? 'Nº ' + padBrief(x.numeroBrief) + ' · ' : '') +
            (String(x.osNumero || '').trim() ? 'O.S. ' + esc(x.osNumero) : 'sem O.S.') +
            ' · ' + fmtData(x.dataHora) + '</span></button>').join('') + '</div>'
        : '<div class="vazio">Nenhum briefing enviado encontrado.</div>')) +
    '</div>' +

    '</div>' +

    // Sempre editável: as fontes trazem o que têm, o designer corrige o que faltar.
    '<div class="sub-secao" style="margin-top:16px">Cabeçalho da prancha</div>' +
    '<div class="linha-2">' +
    '<div class="campo"><label>Cliente</label><input id="pr-cliente" type="text" value="' + esc(base.cliente) + '"></div>' +
    '<div class="campo"><label>Contato</label><input id="pr-contato" type="text" value="' + esc(base.responsavel) + '"></div>' +
    '</div><div class="linha-2">' +
    '<div class="campo"><label>Vendedor</label><input id="pr-vendedor" type="text" value="' + esc(base.vendedor) + '"></div>' +
    '<div class="campo"><label>Endereço</label><input id="pr-endereco" type="text" value="' + esc(base.endereco) + '"></div>' +
    '</div>' +
    // Urgência de todas as pranchas deste lote. Vem ligada quando o briefing é
    // urgente; sem briefing, o designer marca aqui uma vez pra todas.
    '<div class="campo" style="margin-top:6px"><label>Prioridade</label>' +
    '<button class="chip chip-urgente ' + (PROD.urgente ? 'marcado' : '') + '" id="pr-urgente">🔴 URGENTE (carimbo em todas)</button></div>' +
    '</div>' +

    '<div class="card"><div class="sub-secao">2 · Setores envolvidos</div>' +
    '<p class="dica-campo" style="margin-bottom:10px">Cada setor marcado vira uma prancha, numerada em sequência.</p>' +
    '<div class="chips">' +
    setores.map(s => '<button class="chip ' + (PROD.setores.includes(s) ? 'marcado' : '') + '" data-setor="' + esc(s) + '">' + esc(s) + '</button>').join('') +
    '</div></div>' +

    '<button class="botao largo" id="pr-gerar"' + (pronto && PROD.setores.length ? '' : ' disabled') + '>' +
    '⚙️ Gerar ' + (PROD.setores.length || '') + ' prancha' + (PROD.setores.length === 1 ? '' : 's') + '</button>' +
    (!pronto ? '<p class="dica-campo" style="text-align:center; margin-top:8px">Informe a O.S. ou pelo menos o cliente.</p>'
      : (!PROD.setores.length ? '<p class="dica-campo" style="text-align:center; margin-top:8px">Marque pelo menos um setor.</p>' : '')) +
    '</main>';

  ligarTopo();

  // Campos do cabeçalho: gravam no estado sem re-renderizar (senão apaga o que
  // está sendo digitado a cada tecla).
  [['pr-os', 'osNumero'], ['pr-cliente', 'cliente'], ['pr-contato', 'contato'],
   ['pr-vendedor', 'vendedor'], ['pr-endereco', 'endereco']].forEach(([id, campo]) => {
    const el = $('#' + id);
    if (el) el.oninput = () => { PROD[campo] = el.value; };
  });
  const bt = $('#pr-buscar');
  if (bt) bt.onclick = () => buscarOSProducao();
  const osInput = $('#pr-os');
  if (osInput) osInput.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); buscarOSProducao(); } };
  const lim = $('#pr-limpar-os');
  if (lim) lim.onclick = () => {
    Object.assign(PROD, { os: null, osNumero: '', erroOS: '', cliente: '', contato: '', vendedor: '', endereco: '', osPreenchida: '' });
    renderApp();
  };
  const busca = $('#pr-busca');
  if (busca) busca.oninput = debounce(e => { PROD.busca = e.target.value; renderApp(); }, 300);
  $$('[data-brief]').forEach(x => x.onclick = () => {
    PROD.briefingId = x.dataset.brief;
    // Vincular um briefing urgente já liga a prioridade do lote (o designer
    // ainda pode desligar no toggle).
    const bb = STORE.getOS(x.dataset.brief);
    if (bb && bb.urgente) PROD.urgente = true;
    renderApp();
  });
  const tr = $('#pr-trocar'); if (tr) tr.onclick = () => { PROD.briefingId = ''; renderApp(); };
  const urg = $('#pr-urgente');
  if (urg) urg.onclick = () => { PROD.urgente = !PROD.urgente; urg.classList.toggle('marcado', PROD.urgente); };
  $$('[data-setor]').forEach(ch => ch.onclick = () => {
    const s = ch.dataset.setor;
    const i = PROD.setores.indexOf(s);
    if (i >= 0) PROD.setores.splice(i, 1); else PROD.setores.push(s);
    renderApp();
  });
  const g = $('#pr-gerar');
  if (g) g.onclick = () => gerarLoteProducao();
}

// Buscou OUTRO número e não achou (ou caiu a conexão): o cabeçalho que está na
// tela pertence à O.S. ANTERIOR -- deixá-lo ali fazia a prancha sair com o
// cliente errado e o aviso "preencha à mão" mentia. Rebuscar a MESMA O.S.
// preserva tudo, inclusive correção feita à mão.
function limparCabecalhoSeTrocou(g, numero) {
  if (!g.osPreenchida || g.osPreenchida === numero) return;
  Object.assign(g, { cliente: '', contato: '', vendedor: '', endereco: '', osPreenchida: '' });
}

async function buscarOSProducao() {
  const numero = String(PROD.osNumero || '').trim();
  if (!numero) { PROD.erroOS = 'Digite o número da O.S. — ou preencha o cabeçalho à mão logo abaixo.'; renderApp(); return; }
  PROD.buscando = true; PROD.erroOS = ''; renderApp();
  try {
    const res = await STORE.apiFn('mubisys', { action: 'buscarOS', numero });
    if (res && res.encontrado && res.os) {
      PROD.os = res.os;
      // Só preenche o que o designer ainda não digitou: nunca sobrescreve
      // correção feita à mão. MAS se ele trocou de O.S. (buscou outro número),
      // é outro trabalho: aí o cabeçalho inteiro vem da O.S. nova, senão o
      // cliente anterior gruda e a prancha sai com o nome errado.
      const outroTrabalho = PROD.osPreenchida && PROD.osPreenchida !== numero;
      const por = (campo, valor) => {
        if (outroTrabalho || !PROD[campo]) PROD[campo] = valor || '';
      };
      por('cliente', res.os.cliente);
      por('contato', res.os.contato);
      por('vendedor', res.os.vendedor);
      por('endereco', res.os.endereco);
      PROD.osPreenchida = numero;
      toast('O.S. ' + numero + ' encontrada ✓', 'sucesso');
    } else {
      PROD.os = null;
      limparCabecalhoSeTrocou(PROD, numero);
      PROD.erroOS = 'O.S. não encontrada' +
        (res && res.fontes && !res.fontes.mubisys && !res.fontes.pcp ? ' (integração ainda não configurada)' : '') +
        '. Preencha o cabeçalho à mão — a prancha sai igual.';
    }
  } catch {
    limparCabecalhoSeTrocou(PROD, numero);
    PROD.erroOS = 'Sem conexão agora. Preencha o cabeçalho à mão — a prancha sai igual.';
  } finally {
    PROD.buscando = false;
    renderApp();
  }
}

async function gerarLoteProducao() {
  if (!PROD.setores.length || !temDadosProducao()) return;
  toast('Montando as pranchas…');
  const cfg = STORE.getCFG();
  const b = PROD.briefingId ? STORE.getOS(PROD.briefingId) : null;
  const base = baseProducao();
  // Foto e medidas só existem quando há briefing; da O.S. vêm as linhas do pedido.
  const fotoId = b ? fotoPrincipal(b) : null;
  const imagem = fotoId ? await STORE.pullPhoto(fotoId) : null;
  const medidas = b ? medidasDoBriefing(b) : medidasDaOS(PROD.os);
  const total = PROD.setores.length;
  const itens = PROD.setores.map((setor, i) => montarPrancha(base, {
    seloServico: setor,
    setor,
    tituloServico: setor.toUpperCase(),
    medidas,
    imagem, imagemId: fotoId,
    urgente: !!PROD.urgente, // o toggle do gerador vale pra todas as pranchas
    numero: i + 1, total
  }));
  LOTE = { modo: 'producao', origem: 'gerador', briefingId: b ? b.id : '', itens, cfg };
  // A prévia mostra a ficha do setor, que vem do modelo em prancha.js.
  try { await ensureModelos(); } catch { /* sem ficha, o resto da prévia funciona */ }
  abrirPreviaLote();
}

/* ── Modo Projeto ──────────────────────────────────────────────────────── */

// Fábrica (não objeto solto): cada reset precisa de arrays próprios, senão as
// artes de um cliente vazam pro lote do próximo -- mesma armadilha do PROD.
function projVazio() {
  return {
    briefingId: '', busca: '', cliente: '', contato: '', osNumero: '',
    os: null, erroOS: '', buscando: false,
    vendedor: '', endereco: '', setor: 'Projeto', urgente: false,
    imagens: []
  };
}
let PROJ = projVazio();

// Cabeçalho do modo Projeto: vem da O.S., do briefing ou da mão do designer.
function baseProjeto() {
  const b = PROJ.briefingId ? STORE.getOS(PROJ.briefingId) : null;
  const os = PROJ.os;
  return {
    cliente: PROJ.cliente || (os && os.cliente) || (b && b.cliente) || '',
    responsavel: PROJ.contato || (os && os.contato) || (b && b.responsavel) || '',
    telefone: (os && os.telefone) || (b && b.telefone) || '',
    vendedor: PROJ.vendedor || (os && os.vendedor) || (b && b.vendedor) || '',
    endereco: PROJ.endereco || (os && os.endereco) || (b && b.endereco) || '',
    osNumero: String(PROJ.osNumero || (b && b.osNumero) || '').trim(),
    urgente: !!(PROJ.urgente || (b && b.urgente))
  };
}

function renderLayoutProjeto(app) {
  document.title = 'Prancha de projeto';
  if (!PROJ._aberto) { PROJ = projVazio(); PROJ._aberto = true; }
  const cfg = STORE.getCFG();
  const b = PROJ.briefingId ? STORE.getOS(PROJ.briefingId) : null;
  const base = baseProjeto();
  // Setores disponíveis pro selo da prancha (permite fazer um layout de
  // Instalação — ou de qualquer setor — também aqui, não só na Produção).
  const setores = cfg.setoresProducao || [];
  const candidatos = STORE.getAllOS()
    .filter(x => x && !x.apagadoEm && !x.avulsa && x.situacao === 'enviado')
    .filter(x => {
      const t = norm(PROJ.busca);
      if (!t) return true;
      return norm((x.cliente || '') + ' ' + (x.osNumero || '') + ' ' +
        (x.numeroBrief ? padBrief(x.numeroBrief) : '')).includes(t);
    })
    .sort((a, z) => String(z.dataHora || '').localeCompare(String(a.dataHora || '')))
    .slice(0, 25);

  app.innerHTML =
    htmlTopo('Prancha de projeto') +
    '<main class="miolo">' +
    '<a href="#/layout" class="dica-campo" style="display:inline-block; margin-bottom:10px">← modos</a>' +

    '<div class="card"><div class="sub-secao">1 · Arte final (JPG)</div>' +
    '<p class="dica-campo" style="margin-bottom:10px">Pode soltar vários de uma vez: cada imagem vira uma prancha, numerada sozinha.</p>' +
    '<button class="botao largo suave" id="pj-add">🖼 Escolher imagens</button>' +
    '<input type="file" accept="image/*" multiple id="pj-input" hidden>' +
    (PROJ.imagens.length
      ? '<div class="grade-galeria" style="margin-top:12px">' + PROJ.imagens.map((im, i) =>
          '<figure><img src="' + im.base64 + '" alt="Arte ' + (i + 1) + '">' +
          '<figcaption>' + p2n(i + 1) + '/' + p2n(PROJ.imagens.length) + ' · ' +
          '<button class="link-remover" data-rem-img="' + i + '">remover</button></figcaption></figure>').join('') + '</div>'
      : '') +
    '</div>' +

    // Mesmas DUAS fontes da Produção: a O.S. preenche o cabeçalho sozinha (antes
    // este modo só buscava briefing e o resto era digitado à mão).
    '<div class="card"><div class="sub-secao">2 · De onde vêm os dados</div>' +
    '<p class="dica-campo" style="margin-bottom:12px">Os dois caminhos valem e dá pra usar os dois juntos: a O.S. preenche o cabeçalho, o briefing traz as medidas da visita.</p>' +
    '<div class="duas-buscas">' +

    '<div class="busca-fonte">' +
    '<div class="titulo-fonte"><span>📄</span><span>Pela O.S.</span></div>' +
    '<div style="display:flex; gap:8px">' +
    '<input id="pj-os-num" type="text" inputmode="numeric" placeholder="Nº da O.S. — ex: 22416" value="' + esc(PROJ.osNumero) + '" style="flex:1">' +
    '<button class="botao mini" id="pj-buscar"' + (PROJ.buscando ? ' disabled' : '') + '>' +
    (PROJ.buscando ? 'Buscando…' : 'Buscar') + '</button></div>' +
    (PROJ.erroOS ? '<div class="aviso amarelo" style="margin-top:8px">' + esc(PROJ.erroOS) + '</div>' : '') +
    (PROJ.os
      ? '<div class="aviso verde" style="margin-top:8px"><b>' + esc(PROJ.os.cliente || 'Sem nome') + '</b>' +
        (PROJ.os.servico ? ' · ' + esc(PROJ.os.servico) : '') +
        ' <button class="botao mini fantasma" id="pj-limpar-os" style="margin-left:8px">Trocar</button></div>'
      : '') +
    '</div>' +

    '<div class="busca-fonte">' +
    '<div class="titulo-fonte"><span>📋</span><span>Por um briefing</span></div>' +
    '<input id="pj-busca" type="text" placeholder="Cliente, O.S. ou Nº do brief" value="' + esc(PROJ.busca) + '">' +
    (b
      ? '<div class="aviso verde" style="margin-top:8px"><b>' + esc(b.cliente) + '</b>' +
        (b.numeroBrief ? ' · Nº ' + padBrief(b.numeroBrief) : '') +
        (b.urgente ? ' · <b style="color:var(--perigo)">🔴 URGENTE</b>' : '') +
        ' <button class="botao mini fantasma" id="pj-trocar" style="margin-left:8px">Desvincular</button></div>'
      : (candidatos.length
        ? '<div class="lista-escolha rolagem-curta">' + candidatos.map(x =>
            '<button class="opcao-briefing" data-pjbrief="' + x.id + '"><b>' + esc(x.cliente || 'Sem nome') + '</b>' +
            '<span class="dica-campo">' + (x.numeroBrief ? 'Nº ' + padBrief(x.numeroBrief) + ' · ' : '') +
            (String(x.osNumero || '').trim() ? 'O.S. ' + esc(x.osNumero) : 'sem O.S.') + ' · ' + fmtData(x.dataHora) + '</span></button>').join('') + '</div>'
        : '<div class="vazio">Nenhum briefing enviado encontrado.</div>')) +
    '</div>' +

    '</div>' +

    '<div class="sub-secao" style="margin-top:16px">Cabeçalho da prancha</div>' +
    '<div class="linha-2">' +
    '<div class="campo"><label>Cliente</label><input id="pj-cliente" type="text" value="' + esc(base.cliente) + '"></div>' +
    '<div class="campo"><label>Contato</label><input id="pj-contato" type="text" value="' + esc(base.responsavel) + '"></div>' +
    '</div><div class="linha-2">' +
    '<div class="campo"><label>Vendedor</label><input id="pj-vendedor" type="text" value="' + esc(base.vendedor) + '"></div>' +
    '<div class="campo"><label>Endereço</label><input id="pj-endereco" type="text" value="' + esc(base.endereco) + '"></div>' +
    '</div>' +
    '<div class="campo" style="margin-top:6px"><label>Prioridade</label>' +
    '<button class="chip chip-urgente ' + (base.urgente ? 'marcado' : '') + '" id="pj-urgente">🔴 URGENTE (carimbo em todas)</button></div>' +
    '</div>' +

    // Escolha do selo: dá pra fazer um layout de Instalação (ou de qualquer
    // setor) neste modo, com a ficha daquele setor na prancha.
    '<div class="card"><div class="sub-secao">3 · Tipo da prancha</div>' +
    '<p class="dica-campo" style="margin-bottom:10px">"Projeto" é o layout aprovado. Escolhendo um setor, a prancha sai com o selo e a ficha dele (ex.: Instalação).</p>' +
    '<div class="chips">' +
    '<button class="chip ' + (PROJ.setor === 'Projeto' ? 'marcado' : '') + '" data-pjsetor="Projeto">🖼 Projeto</button>' +
    setores.map(s => '<button class="chip ' + (PROJ.setor === s ? 'marcado' : '') + '" data-pjsetor="' + esc(s) + '">' + esc(s) + '</button>').join('') +
    '</div></div>' +

    '<button class="botao largo" id="pj-gerar"' + (PROJ.imagens.length ? '' : ' disabled') + '>' +
    '⚙️ Montar ' + (PROJ.imagens.length || '') + ' prancha' + (PROJ.imagens.length === 1 ? '' : 's') + '</button>' +
    (!PROJ.imagens.length ? '<p class="dica-campo" style="text-align:center; margin-top:8px">Escolha pelo menos uma imagem.</p>' : '') +
    '</main>';

  ligarTopo();
  const inp = $('#pj-input');
  $('#pj-add').onclick = () => inp.click();
  inp.onchange = async () => {
    const arquivos = Array.from(inp.files || []);
    if (!arquivos.length) return;
    toast('Preparando ' + arquivos.length + ' imagem(ns)…');
    for (const f of arquivos) {
      const base64 = await STORE.compressImage(f);
      if (base64) PROJ.imagens.push({ base64, nome: f.name });
    }
    inp.value = '';
    renderApp();
  };
  $$('[data-rem-img]').forEach(bt => bt.onclick = () => {
    PROJ.imagens.splice(Number(bt.dataset.remImg), 1);
    renderApp();
  });

  // Busca de O.S. (igual à da Produção)
  const bt = $('#pj-buscar');
  if (bt) bt.onclick = () => buscarOSProjeto();
  const osInp = $('#pj-os-num');
  if (osInp) {
    osInp.oninput = () => { PROJ.osNumero = osInp.value; };
    osInp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); buscarOSProjeto(); } };
  }
  const lim = $('#pj-limpar-os');
  if (lim) lim.onclick = () => {
    Object.assign(PROJ, { os: null, osNumero: '', erroOS: '', cliente: '', contato: '', vendedor: '', endereco: '', osPreenchida: '' });
    renderApp();
  };

  $('#pj-busca').oninput = debounce(e => { PROJ.busca = e.target.value; renderApp(); }, 300);
  $$('[data-pjbrief]').forEach(x => x.onclick = () => {
    PROJ.briefingId = x.dataset.pjbrief;
    const bb = STORE.getOS(x.dataset.pjbrief);
    if (bb && bb.urgente) PROJ.urgente = true;
    renderApp();
  });
  const tr = $('#pj-trocar'); if (tr) tr.onclick = () => { PROJ.briefingId = ''; renderApp(); };

  // Cabeçalho editável — grava sem redesenhar (não rouba o foco).
  [['pj-cliente', 'cliente'], ['pj-contato', 'contato'],
   ['pj-vendedor', 'vendedor'], ['pj-endereco', 'endereco']].forEach(([id, campo]) => {
    const el = $('#' + id);
    if (el) el.oninput = () => { PROJ[campo] = el.value; };
  });
  const urg = $('#pj-urgente');
  if (urg) urg.onclick = () => { PROJ.urgente = !PROJ.urgente; urg.classList.toggle('marcado', PROJ.urgente); };
  $$('[data-pjsetor]').forEach(ch => ch.onclick = () => { PROJ.setor = ch.dataset.pjsetor; renderApp(); });
  $('#pj-gerar').onclick = () => gerarLoteProjeto(b);
}

async function buscarOSProjeto() {
  const numero = String(PROJ.osNumero || '').trim();
  if (!numero) { PROJ.erroOS = 'Digite o número da O.S. — ou preencha o cabeçalho à mão logo abaixo.'; renderApp(); return; }
  PROJ.buscando = true; PROJ.erroOS = ''; renderApp();
  try {
    const res = await STORE.apiFn('mubisys', { action: 'buscarOS', numero });
    if (res && res.encontrado && res.os) {
      PROJ.os = res.os;
      // Só preenche o que ainda não foi digitado à mão -- mas trocando de O.S.
      // o cabeçalho inteiro é substituído (ver buscarOSProducao).
      const outroTrabalho = PROJ.osPreenchida && PROJ.osPreenchida !== numero;
      const por = (campo, valor) => {
        if (outroTrabalho || !PROJ[campo]) PROJ[campo] = valor || '';
      };
      por('cliente', res.os.cliente);
      por('contato', res.os.contato);
      por('vendedor', res.os.vendedor);
      por('endereco', res.os.endereco);
      PROJ.osPreenchida = numero;
      toast('O.S. ' + numero + ' encontrada ✓', 'sucesso');
    } else {
      PROJ.os = null;
      limparCabecalhoSeTrocou(PROJ, numero);
      PROJ.erroOS = 'O.S. não encontrada' +
        (res && res.fontes && !res.fontes.mubisys && !res.fontes.pcp ? ' (integração ainda não configurada)' : '') +
        '. Preencha o cabeçalho à mão — a prancha sai igual.';
    }
  } catch {
    limparCabecalhoSeTrocou(PROJ, numero);
    PROJ.erroOS = 'Sem conexão agora. Preencha o cabeçalho à mão — a prancha sai igual.';
  } finally {
    PROJ.buscando = false;
    renderApp();
  }
}

function p2n(n) { return String(n).padStart(2, '0'); }

async function gerarLoteProjeto(b) {
  if (!PROJ.imagens.length) return;
  const cfg = STORE.getCFG();
  const base = baseProjeto();          // O.S. + briefing + o que foi digitado
  const setor = PROJ.setor || 'Projeto';
  const ehProjeto = setor === 'Projeto';
  // Medidas: do briefing quando há; senão das linhas da O.S.
  const medidas = b ? medidasDoBriefing(b) : medidasDaOS(PROJ.os);
  const total = PROJ.imagens.length;
  const itens = PROJ.imagens.map((im, i) => montarPrancha(base, {
    seloServico: setor,
    // Setor de verdade (ex.: Instalação) leva a ficha e o cabeçalho dele;
    // "Projeto" continua sem setor, como era.
    setor: ehProjeto ? '' : setor,
    tituloServico: ehProjeto ? '' : setor.toUpperCase(),
    imagem: im.base64,
    medidas,
    urgente: !!base.urgente,
    numero: i + 1, total
  }));
  LOTE = { modo: 'projeto', origem: 'gerador', briefingId: b ? b.id : '', itens, cfg };
  try { await ensureModelos(); } catch { /* sem ficha, o resto da prévia funciona */ }
  abrirPreviaLote();
}

/* ── Pré-visualização e edição do lote ─────────────────────────────────── */

// Modelo do setor (tabelas e caixas) — só existe depois que prancha.js carrega.
function modeloDaPrancha(p) {
  if (typeof PRANCHA === 'undefined') return null;
  return PRANCHA.modeloDe(p.seloServico || p.setor, STORE.getCFG());
}

// Estrutura onde ficam as marcas da ficha. Criada sob demanda pra não inchar
// pranchas que ninguém preencheu.
function fichaDe(p) {
  if (!p.ficha) p.ficha = { tabelas: {}, soltas: {} };
  return p.ficha;
}
// A ficha é guardada por CHAVE DO TÍTULO, não pela posição da tabela. Com
// posição, mexer nas fichas no admin (reordenar/remover uma tabela) fazia a
// marcação de uma prancha antiga reaparecer na tabela ERRADA ou sumir calada
// ao regerar. `chaveTabela` é a mesma no app e no prancha.js.
function chaveTabela(modelo, ti) {
  const tab = modelo && (modelo.tabelas || [])[ti];
  const t = tab && String(tab.titulo || '').trim();
  return t ? 't:' + norm(t) : String(ti);
}
function fichaTab(p, ti) {
  const f = fichaDe(p);
  const k = chaveTabela(modeloDaPrancha(p), ti);
  // Migra o que foi gravado por posição antes desta mudança.
  if (!f.tabelas[k] && f.tabelas[ti]) { f.tabelas[k] = f.tabelas[ti]; delete f.tabelas[ti]; }
  if (!f.tabelas[k]) f.tabelas[k] = { marcas: {}, rotulos: {}, valores: {} };
  return f.tabelas[k];
}
// Leitura (sem criar): tenta a chave nova e cai pra posição nas pranchas velhas.
function fichaTabLer(p, modelo, ti) {
  const f = p.ficha || { tabelas: {} };
  return (f.tabelas || {})[chaveTabela(modelo, ti)] || (f.tabelas || {})[ti] || {};
}

// A ficha do setor, clicável. Cada linha do modelo vira uma linha de verdade:
// caixa pra marcar, campo pra escrever quando a linha é livre ("Outros:" ou em
// branco) e um campo por coluna extra (ESPESSURA, COR...).
function htmlFichaSetor(p, i) {
  const modelo = modeloDaPrancha(p);
  if (!modelo) return '';
  const tabelas = modelo.tabelas || [];
  const soltas = modelo.caixasSoltas || [];
  if (!tabelas.length && !soltas.length) {
    return '<p class="dica-campo">Este setor não tem ficha própria — a prancha sai só com o cabeçalho e o desenho.</p>';
  }
  const f = p.ficha || { tabelas: {}, soltas: {} };
  // Lê pela chave do título (com queda pra posição nas pranchas antigas).
  const tb = (ti) => fichaTabLer(p, modelo, ti);
  const marcado = (ti, li) => !!((tb(ti).marcas) || {})[li];
  const escrito = (ti, li) => String(((tb(ti).rotulos) || {})[li] || '');
  const valor = (ti, li, ci) => String((((tb(ti).valores) || {})[li] || {})[ci] || '');
  const outros = (ti) => String(tb(ti).outros || '');

  return (
    soltas.map((rot, si) =>
      '<label class="linha-check solta">' +
      '<input type="checkbox" data-solta="' + si + '" data-srot="' + esc(rot) + '" data-pi="' + i + '"' + ((f.soltas['s:' + norm(rot)] !== undefined ? f.soltas['s:' + norm(rot)] : f.soltas[si]) ? ' checked' : '') + '>' +
      '<span class="rotulo-check">' + esc(rot) + '</span></label>').join('') +
    tabelas.map((tab, ti) =>
      '<div class="ficha-tabela">' +
      '<div class="ficha-titulo">' + esc(tab.titulo) +
      ((tab.colunas || []).length ? '<span class="ficha-cols">' + (tab.colunas || []).filter(Boolean).map(esc).join(' · ') + '</span>' : '') +
      '</div>' +
      (tab.itens || []).map((item, li) => {
        const livre = !item || /:$/.test(item);
        // Linha com rótulo fixo vira <label>: dá pra marcar tocando em qualquer
        // ponto dela, que é o alvo que o dedo acerta. Linha livre fica <div>
        // (o toque ali precisa ir pro campo de texto, não pra caixa).
        const tag = livre ? 'div' : 'label';
        return '<' + tag + ' class="linha-check">' +
          (tab.semCheck ? '<span class="sem-check"></span>'
            : '<input type="checkbox" data-marca="' + ti + '_' + li + '" data-pi="' + i + '"' + (marcado(ti, li) ? ' checked' : '') + '>') +
          (livre
            // Linha "Outros:" mantém o rótulo à vista: com o campo preenchido,
            // só o texto digitado não diz de qual pergunta ele é a resposta.
            ? (item ? '<span class="rotulo-check curto">' + esc(item) + '</span>' : '') +
              '<input class="campo-livre" type="text" data-rotulo="' + ti + '_' + li + '" data-pi="' + i + '"' +
              ' placeholder="' + esc(item ? 'escrever qual…' : 'escrever…') + '" value="' + esc(escrito(ti, li)) + '">'
            : '<span class="rotulo-check">' + esc(item) + '</span>') +
          (tab.colunas || []).map((c, ci) =>
            '<input class="campo-col" type="text" data-valor="' + ti + '_' + li + '_' + ci + '" data-pi="' + i + '"' +
            ' placeholder="' + esc(c || '—') + '" value="' + esc(valor(ti, li, ci)) + '">').join('') +
          '</' + tag + '>';
      }).join('') +
      // "Outros" universal: qualquer tabela aceita algo particular. Não repete
      // onde já existe um "Outros:" nativo (ex.: SUPERFÍCIES da Instalação).
      ((tab.itens || []).some(x => /^outros:?$/i.test(String(x || '').trim()))
        ? ''
        : '<div class="linha-check outros-linha">' +
          '<span class="rotulo-check curto">+ Outros:</span>' +
          '<input class="campo-livre" type="text" data-outros="' + ti + '" data-pi="' + i + '"' +
          ' placeholder="algo particular deste trabalho…" value="' + esc(outros(ti)) + '">' +
          '</div>') +
      '</div>').join('')
  );
}

// Liga os cliques da ficha. `raiz` é onde procurar os campos (o modal inteiro
// no começo, só o bloco da ficha quando o setor troca); `m` é o modal, usado
// pra achar a caixa de marcar da mesma linha.
// Tudo grava direto no item do lote, sem re-renderizar: redesenhar o modal a
// cada clique roubaria o foco de quem está digitando na coluna do lado.
function ligarFicha(raiz, m) {
  $$('[data-solta]', raiz).forEach(cb => cb.onchange = () => {
    // Grava pela CHAVE do rótulo (não pela posição): reordenar/inserir caixa
    // no admin trocava as marcas ao regerar prancha antiga. A marca antiga por
    // índice é apagada junto (migração no primeiro toque).
    const f = fichaDe(LOTE.itens[Number(cb.dataset.pi)]);
    f.soltas['s:' + norm(cb.dataset.srot || '')] = cb.checked;
    delete f.soltas[Number(cb.dataset.solta)];
  });
  $$('[data-marca]', raiz).forEach(cb => cb.onchange = () => {
    const [ti, li] = cb.dataset.marca.split('_').map(Number);
    fichaTab(LOTE.itens[Number(cb.dataset.pi)], ti).marcas[li] = cb.checked;
  });
  $$('[data-rotulo]', raiz).forEach(el => el.oninput = () => {
    const [ti, li] = el.dataset.rotulo.split('_').map(Number);
    fichaTab(LOTE.itens[Number(el.dataset.pi)], ti).rotulos[li] = el.value;
  });
  $$('[data-valor]', raiz).forEach(el => el.oninput = () => {
    const [ti, li, ci] = el.dataset.valor.split('_').map(Number);
    const t = fichaTab(LOTE.itens[Number(el.dataset.pi)], ti);
    if (!t.valores[li]) t.valores[li] = {};
    t.valores[li][ci] = el.value;
    // Escrever numa coluna é dizer que a linha vale: marca sozinho, senão a
    // produção recebe "ESPESSURA 3mm" numa linha sem visto e ignora.
    const cb = $('[data-marca="' + ti + '_' + li + '"][data-pi="' + el.dataset.pi + '"]', m || raiz);
    if (el.value.trim() && cb && !cb.checked) { cb.checked = true; t.marcas[li] = true; }
  });
  $$('[data-outros]', raiz).forEach(el => el.oninput = () => {
    fichaTab(LOTE.itens[Number(el.dataset.pi)], Number(el.dataset.outros)).outros = el.value;
  });
}

// A ficha de UMA prancha tem algo marcado/escrito?
function loteFichaMarcada(p) {
  const f = p && p.ficha;
  if (!f) return false;
  if (Object.values(f.soltas || {}).some(Boolean)) return true;
  return Object.values(f.tabelas || {}).some(t =>
    String(t.outros || '').trim() ||
    Object.values(t.marcas || {}).some(Boolean) ||
    Object.values(t.rotulos || {}).some(v => String(v || '').trim()) ||
    Object.values(t.valores || {}).some(col => Object.values(col || {}).some(v => String(v || '').trim())));
}
// O lote inteiro tem trabalho que se perde ao cancelar? (ficha + carimbos + obs)
function loteTemMarcacao() {
  if (!LOTE) return false;
  return LOTE.itens.some(p =>
    p.urgente || p.espelhado || p.dataEntrega || String(p.obs || '').trim() ||
    String(p.tituloServico || '').trim() || loteFichaMarcada(p));
}

// Escolhe uma foto do briefing (ou pede um arquivo do computador).
function escolherFotoDoBriefing(fotos, aoEscolher) {
  const m = abrirModal(
    '<h3>Qual foto vai na prancha?</h3>' +
    '<p class="dica-campo">Fotos deste briefing. Toque numa pra usar.</p>' +
    '<div class="grade-galeria" id="esc-fotos" style="margin-top:12px">' +
    fotos.map(f => '<figure><img data-escolher="' + esc(f.id) + '" alt="' + esc(f.legenda) + '">' +
      '<figcaption>' + esc(f.legenda) + '</figcaption></figure>').join('') +
    '</div>' +
    '<div class="acoes-modal">' +
    '<button class="botao fantasma btn-cancelar">Cancelar</button>' +
    '<button class="botao suave btn-arquivo">🖼 Escolher do computador</button></div>'
  );
  const imgs = $$('img[data-escolher]', m);
  carregarThumbsEmFila(imgs.map(i => { i.dataset.fotoId = i.dataset.escolher; return i; }));
  imgs.forEach(img => img.onclick = () => { m.remove(); aoEscolher(img.dataset.escolher); });
  $('.btn-cancelar', m).onclick = () => m.remove();
  $('.btn-arquivo', m).onclick = () => { m.remove(); aoEscolher('__arquivo__'); };
}

function abrirPreviaLote() {
  if (!LOTE || !LOTE.itens.length) return;
  const cfg = LOTE.cfg || STORE.getCFG();
  const tiposServico = cfg.tiposServico || [];
  const cab = LOTE.itens[0] || {};
  const m = abrirModal(
    '<h3>' + LOTE.itens.length + ' prancha(s) prontas</h3>' +
    '<p class="dica-campo">Confira e ajuste antes de exportar. O que ficar em branco sai em branco pra preencher à mão.</p>' +
    // Cabeçalho comum a todas as pranchas, visível e editável -- antes, no modo
    // Projeto, dava pra exportar com o cabeçalho em branco sem perceber.
    '<div class="card" style="margin-bottom:12px"><div class="sub-secao">Cabeçalho (vale pra todas)</div>' +
    '<div class="linha-2">' +
    '<div class="campo"><label>Cliente</label><input id="lote-cliente" type="text" value="' + esc(cab.cliente || '') + '"></div>' +
    '<div class="campo"><label>Contato</label><input id="lote-contato" type="text" value="' + esc(cab.contato || '') + '"></div>' +
    '</div>' +
    '<div class="linha-2">' +
    '<div class="campo"><label>Vendedor</label><input id="lote-vendedor" type="text" value="' + esc(cab.vendedor || '') + '"></div>' +
    '<div class="campo"><label>O.S. (se tiver)</label><input id="lote-os" type="text" inputmode="numeric" value="' + esc(cab.osNumero || '') + '"></div>' +
    '</div>' +
    // Endereço sai impresso nas pranchas de Instalação/Serralheria: se a O.S.
    // trouxer o endereço de cobrança em vez do da obra, dá pra corrigir aqui.
    '<div class="campo"><label>Endereço</label><input id="lote-endereco" type="text" value="' + esc(cab.endereco || '') + '"></div>' +
    '</div>' +
    '<div id="lote-lista" style="margin-top:12px">' +
    LOTE.itens.map((p, i) =>
      '<div class="card-prancha" data-pi="' + i + '">' +
      '<div class="cabeca-prancha"><b>' + p2n(p.numero) + '/' + p2n(p.total) + '</b>' +
      '<span class="selo-mini">' + esc(p.seloServico || 'sem selo') + '</span></div>' +
      '<div class="campo"><label>Título do serviço</label>' +
      '<input type="text" data-pcampo="tituloServico" data-pi="' + i + '" value="' + esc(p.tituloServico) + '" placeholder="Ex: RETIRADA DE PLACA"></div>' +
      '<div class="linha-2">' +
      '<div class="campo"><label>Selo</label><select data-pcampo="seloServico" data-pi="' + i + '">' +
      '<option value="">Sem selo</option>' +
      tiposServico.map(t => '<option ' + (p.seloServico === t ? 'selected' : '') + '>' + esc(t) + '</option>').join('') +
      (p.seloServico && !tiposServico.includes(p.seloServico) ? '<option selected>' + esc(p.seloServico) + '</option>' : '') +
      '</select></div>' +
      '<div class="campo"><label>Entrega</label>' +
      '<input type="text" inputmode="numeric" maxlength="10" placeholder="dd/mm/aaaa" data-pdata="' + i + '" value="' + esc(p.dataEntrega ? isoParaDataBr(p.dataEntrega) : '') + '"></div>' +
      '</div>' +
      '<div class="campo"><label>Obs</label>' +
      '<textarea rows="2" data-pcampo="obs" data-pi="' + i + '" placeholder="Vai impressa na prancha (até 3 linhas)">' + esc(p.obs) + '</textarea></div>' +
      '<div class="chips" style="margin-bottom:10px">' +
      '<button class="chip ' + (p.urgente ? 'marcado' : '') + '" data-carimbo="urgente" data-pi="' + i + '">🔴 Carimbo URGENTE</button>' +
      '<button class="chip ' + (p.espelhado ? 'marcado' : '') + '" data-carimbo="espelhado" data-pi="' + i + '">🔵 Arquivo espelhado</button>' +
      '</div>' +
      // A ficha do setor: o que antes só dava pra marcar de caneta no papel.
      '<details class="ficha-setor"><summary>📋 Ficha do setor — marcar aqui</summary>' +
      '<div class="ficha-corpo">' + htmlFichaSetor(p, i) + '</div></details>' +
      '<div class="acoes-prancha">' +
      (p.imagem ? '<img class="thumb-prancha" src="' + p.imagem + '" alt="">' : '<span class="dica-campo">sem imagem</span>') +
      '<button class="botao mini suave" data-troca-img="' + i + '">Trocar foto</button>' +
      '<input type="file" accept="image/*" hidden data-input-img="' + i + '">' +
      '</div></div>'
    ).join('') +
    '</div>' +
    '<div class="acoes-modal">' +
    '<button class="botao fantasma btn-cancelar">Cancelar</button>' +
    '<button class="botao suave btn-separados">PDFs separados</button>' +
    '<button class="botao btn-unico">📄 PDF único</button>' +
    '</div>',
    { persistente: true } // não fecha no toque fora: guarda a ficha marcada
  );

  // Cabeçalho comum: escreve em TODAS as pranchas do lote.
  const setCab = (campo, val) => LOTE.itens.forEach(p => { p[campo] = val; });
  $('#lote-cliente', m).oninput = e => setCab('cliente', e.target.value);
  $('#lote-contato', m).oninput = e => setCab('contato', e.target.value);
  $('#lote-vendedor', m).oninput = e => setCab('vendedor', e.target.value);
  $('#lote-endereco', m).oninput = e => setCab('endereco', e.target.value);
  $('#lote-os', m).oninput = e => setCab('osNumero', e.target.value.trim());

  // Guarda o selo anterior de cada select, pra confirmar antes de trocar a ficha.
  const seloAnterior = {};
  $$('[data-pcampo]', m).forEach(el => {
    if (el.dataset.pcampo === 'seloServico') seloAnterior[el.dataset.pi] = el.value;
    const ev = el.tagName === 'SELECT' ? 'onchange' : 'oninput';
    el[ev] = () => {
      const i = Number(el.dataset.pi);
      if (el.dataset.pcampo === 'seloServico') {
        const card = $('.card-prancha[data-pi="' + i + '"]', m);
        const corpo = $('.ficha-corpo', card);
        // Guarda o valor escolhido AGORA. `confirmar` é assíncrono: sem esta
        // cópia, o `el.value = seloAnterior` logo abaixo revertia o campo antes
        // do callback rodar, e a troca regravava o selo ANTIGO apagando a ficha.
        const novoSelo = el.value;
        const jaMarcada = corpo && loteFichaMarcada(LOTE.itens[i]);
        const aplicar = () => {
          LOTE.itens[i].seloServico = novoSelo;
          // `setor` também: o modelo e o carimbo usam `seloServico || setor`,
          // então deixar o setor antigo fazia "Sem selo" não ter efeito nenhum.
          LOTE.itens[i].setor = novoSelo;
          el.value = novoSelo;
          const chip = $('.selo-mini', card); if (chip) chip.textContent = novoSelo || 'sem selo';
          if (corpo) {
            LOTE.itens[i].ficha = { tabelas: {}, soltas: {} };
            corpo.innerHTML = htmlFichaSetor(LOTE.itens[i], i);
            ligarFicha(corpo, m);
          }
          seloAnterior[i] = novoSelo;
        };
        if (jaMarcada) {
          confirmar('Trocar o setor?', 'A ficha que você marcou nesta prancha vai ser apagada (cada setor tem a sua). Trocar mesmo assim?',
            'Trocar', aplicar, true);
          el.value = seloAnterior[i]; // volta ao anterior até a confirmação
        } else aplicar();
        return;
      }
      LOTE.itens[i][el.dataset.pcampo] = el.value;
    };
  });
  $$('[data-carimbo]', m).forEach(ch => ch.onclick = () => {
    const i = Number(ch.dataset.pi), campo = ch.dataset.carimbo;
    LOTE.itens[i][campo] = !LOTE.itens[i][campo];
    ch.classList.toggle('marcado', LOTE.itens[i][campo]);
  });

  ligarFicha(m, m);
  $$('[data-pdata]', m).forEach(el => el.oninput = () => {
    el.value = mascaraData(el.value);
    const iso = dataBrParaISO(el.value, '12:00');
    LOTE.itens[Number(el.dataset.pdata)].dataEntrega = iso || '';
  });
  // "Trocar foto": quando o lote veio de um briefing, oferece PRIMEIRO as fotos
  // dele. Antes só abria o disco do computador -- e a prancha ficava sempre com
  // a primeira foto (muitas vezes a de contexto, não a que interessa).
  $$('[data-troca-img]', m).forEach(bt => bt.onclick = () => {
    const i = bt.dataset.trocaImg;
    const brief = LOTE.briefingId ? STORE.getOS(LOTE.briefingId) : null;
    const fotos = brief ? fotosDoBriefing(brief) : [];
    if (!fotos.length) { $('[data-input-img="' + i + '"]', m).click(); return; }
    escolherFotoDoBriefing(fotos, async (escolha) => {
      if (escolha === '__arquivo__') { $('[data-input-img="' + i + '"]', m).click(); return; }
      const b64 = await STORE.pullPhoto(escolha);
      if (!b64) { toast('Essa foto ainda não sincronizou neste aparelho', 'erro'); return; }
      const k = Number(i);
      LOTE.itens[k].imagem = b64;
      LOTE.itens[k].imagemId = escolha;
      const card = $('.card-prancha[data-pi="' + k + '"]', m);
      const img = $('.thumb-prancha', card);
      if (img) img.src = b64;
      else card.querySelector('.acoes-prancha').insertAdjacentHTML('afterbegin', '<img class="thumb-prancha" src="' + b64 + '" alt="">');
    });
  });
  $$('[data-input-img]', m).forEach(inp => inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const base64 = await STORE.compressImage(f);
    if (!base64) { toast('Não consegui ler a imagem', 'erro'); return; }
    const i = Number(inp.dataset.inputImg);
    LOTE.itens[i].imagem = base64;
    LOTE.itens[i].imagemId = null;
    const card = $('.card-prancha[data-pi="' + i + '"]', m);
    const img = $('.thumb-prancha', card);
    if (img) img.src = base64;
    else card.querySelector('.acoes-prancha').insertAdjacentHTML('afterbegin', '<img class="thumb-prancha" src="' + base64 + '" alt="">');
  });

  // Cancelar confirma quando há ficha/carimbo marcados (não dá pra reabrir).
  $('.btn-cancelar', m).onclick = () => {
    if (loteTemMarcacao()) {
      confirmar('Descartar as pranchas?', 'Você marcou fichas ou carimbos. Fechar agora perde tudo isso -- não dá pra reabrir depois.',
        'Descartar', () => m.remove(), true);
    } else m.remove();
  };
  // Só fecha a prévia DEPOIS do PDF sair. Antes fechava na hora e, se a geração
  // falhava, a ficha marcada já tinha ido embora.
  const exportar = async (separados, btn) => {
    // Não exporta sem cliente: o cabeçalho sairia em branco na produção.
    if (!String((LOTE.itens[0] || {}).cliente || '').trim()) {
      toast('Preencha o Cliente no cabeçalho antes de exportar.', 'erro');
      const c = $('#lote-cliente', m); if (c) c.focus();
      return;
    }
    const outros = $$('.acoes-modal .botao', m);
    outros.forEach(b => b.disabled = true);
    const txt = btn.textContent; btn.textContent = 'Gerando…';
    try {
      const ok = await exportarLote(separados);
      if (ok !== false) {
        // Exportou: a mesa do gerador volta pro zero. Sem isto o designer que
        // continuava na tela e digitava OUTRA O.S. levava junto o cabeçalho
        // (cliente, contato, vendedor, endereço) e as artes do trabalho
        // anterior -- e a prancha saía com o nome do cliente errado.
        // SÓ o modo que gerou o lote: zerar os dois apagava o rascunho do outro
        // modo, e o fluxo "Corrigir versão" (que não usa a mesa) apagava um
        // rascunho em andamento sem aviso nenhum.
        if (LOTE.origem === 'gerador') {
          if (LOTE.modo === 'projeto') PROJ = Object.assign(projVazio(), { _aberto: PROJ._aberto });
          else PROD = Object.assign(prodVazio(), { _aberto: PROD._aberto });
        }
        m.remove(); // fechou só porque deu certo
        // Redesenha sempre: a tela de layout nasce coerente com a mesa zerada
        // (o botão "Montar pranchas" volta a viver) e o detalhe mostra a
        // versão de prancha recém-gravada no histórico.
        renderApp();
      } else { outros.forEach(b => b.disabled = false); btn.textContent = txt; }
    } catch (e) {
      outros.forEach(b => b.disabled = false); btn.textContent = txt;
    }
  };
  $('.btn-unico', m).onclick = (e) => exportar(false, e.currentTarget);
  $('.btn-separados', m).onclick = (e) => exportar(true, e.currentTarget);
}

// prancha.js declara `const PRANCHA`: carregar duas vezes quebra a página
// inteira ("PRANCHA already declared"). Este é o ÚNICO ponto que carrega o
// arquivo, e ele é reaproveitado tanto pela prévia quanto pela exportação.
let _pranchaScript = null;
function ensureModelos() {
  if (!_pranchaScript) _pranchaScript = carregarScript('prancha.js');
  return _pranchaScript;
}

let _pranchaCarregada = null;
function ensurePrancha() {
  if (!_pranchaCarregada) {
    // A prévia já pode ter carregado prancha.js sozinha; ensureModelos
    // devolve a mesma promessa em vez de baixar de novo.
    _pranchaCarregada = ensurePdfLibs().then(() => ensureModelos());
  }
  return _pranchaCarregada;
}

async function exportarLote(separados) {
  if (!LOTE || !LOTE.itens.length) return false;
  // Congela o lote agora: a exportação demora (downloads em fila) e o designer
  // pode montar outro lote no meio. Sem esta cópia, o segundo lote era gravado
  // no lugar do primeiro.
  const lote = LOTE;
  toast('Gerando o PDF…');
  try {
    await ensurePrancha();
    const cfg = lote.cfg || STORE.getCFG();
    const base = arquivoSeguro((lote.itens[0] && lote.itens[0].cliente) || 'prancha');
    if (separados) {
      for (const p of lote.itens) {
        const doc = await PRANCHA.gerarPdf([p], cfg);
        doc.save('prancha-' + p2n(p.numero) + '-' + arquivoSeguro(p.seloServico || 'layout') + '-' + base + '.pdf');
        await new Promise(r => setTimeout(r, 350)); // o navegador engasga com downloads em rajada
      }
    } else {
      const doc = await PRANCHA.gerarPdf(lote.itens, cfg);
      doc.save('pranchas-' + base + '.pdf');
    }
    toast('PDF pronto ✓', 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Não consegui gerar o PDF: ' + e.message, 'erro');
    return false; // deu erro: a prévia NÃO deve fechar (a ficha continua lá)
  }
  // Guardar no histórico é uma etapa separada: se ela falhar, o PDF já foi
  // baixado e o usuário precisa saber disso, não que "não conseguiu gerar".
  try {
    await salvarLoteNoBriefing(lote);
  } catch (e) {
    console.error(e);
    toast('PDF baixado, mas a versão NÃO foi guardada: ' + e.message + '. Libere espaço e exporte de novo.', 'erro');
    // false = a prévia fica aberta com a ficha marcada; fechar aqui zerava a
    // mesa e a ficha se perdia junto com a versão que não entrou no histórico.
    return false;
  }
  return true;
}

// Guarda a prancha no briefing (ou num registro avulso), com histórico de versões.
// Só os DADOS são gravados; o PDF é remontado na hora de baixar ou regerar.
async function salvarLoteNoBriefing(loteRecebido) {
  const LOTE = loteRecebido || window.LOTE;
  if (!LOTE) return;
  const enxuto = p => ({
    id: p.id, numero: p.numero, total: p.total,
    seloServico: p.seloServico, setor: p.setor || '', tituloServico: p.tituloServico,
    medidas: p.medidas, detalhe: p.detalhe || '', obs: p.obs,
    dataEntrega: p.dataEntrega || '', urgente: !!p.urgente, espelhado: !!p.espelhado,
    // A ficha marcada faz parte da prancha: sem ela, regerar o PDF do histórico
    // devolvia a folha em branco e perdia o que o designer preencheu.
    ficha: p.ficha || null,
    imagemId: p.imagemId || null,
    cliente: p.cliente, contato: p.contato, telefone: p.telefone || '', vendedor: p.vendedor, designer: p.designer,
    osNumero: p.osNumero, endereco: p.endereco, data: p.data,
    equipe: p.equipe || [], ferramentas: p.ferramentas || [], acessorios: p.acessorios || []
  });

  // Imagens que ainda não estão no store (modo projeto / trocadas na prévia).
  // Passa pela fila offline: sem isso, upload que falhava sumia e a versão
  // salva ficava apontando pra uma imagem que nunca existiu no servidor.
  for (const p of LOTE.itens) {
    if (!p.imagemId && p.imagem) {
      p.imagemId = await STORE.salvarFotoBase64(p.imagem, 'image/jpeg', 'prancha_' + STORE.uuid().slice(0, 12));
      p._bytes = Math.round(p.imagem.length * 0.75);
    }
  }

  let alvo = LOTE.briefingId ? STORE.getOS(LOTE.briefingId) : null;
  if (!alvo) {
    // Prancha sem briefing: registro próprio, fora da lista de briefings, mas
    // dentro da mesma nuvem (entra em lixeira, limpeza e armazenamento).
    const agora = new Date().toISOString();
    // situacao 'prancha' (não 'enviado'): registro avulso não é briefing, então
    // não pode consumir número de brief nem disparar o webhook de briefing novo.
    alvo = {
      id: STORE.uuid(), avulsa: true, situacao: 'prancha', status: '',
      cliente: LOTE.itens[0].cliente || 'Prancha avulsa',
      responsavel: LOTE.itens[0].contato || '',
      osNumero: LOTE.itens[0].osNumero || '',
      vendedor: '', vendedorUsuario: '', telefone: '', itens: [], croquis: [],
      dataHora: agora, criadoEm: agora, criadoPor: SESSAO.nome,
      atualizadoEm: agora, atualizadoPor: SESSAO.nome, pranchas: []
    };
    LOTE.briefingId = alvo.id;
  }
  alvo.pranchas = alvo.pranchas || [];
  alvo.pranchas.push({
    versao: alvo.pranchas.length + 1,
    modo: LOTE.modo,
    criadoEm: new Date().toISOString(),
    criadoPor: SESSAO.nome,
    itens: LOTE.itens.map(enxuto),
    bytes: LOTE.itens.reduce((s, p) => s + (p._bytes || 0), 0)
  });
  alvo.atualizadoEm = new Date().toISOString();
  alvo.atualizadoPor = SESSAO.nome;
  if (!STORE.saveOS(JSON.parse(JSON.stringify(alvo)))) {
    throw new Error('memória do aparelho cheia');
  }
}

// Regera o PDF de uma versão já salva (busca as imagens pelo id)
async function regerarVersao(b, versao) {
  toast('Remontando as pranchas…');
  try {
    await ensurePrancha();
    const cfg = STORE.getCFG();
    const itens = [];
    let semFoto = 0;
    for (const p of versao.itens) {
      const imagem = p.imagemId ? await STORE.pullPhoto(p.imagemId) : null;
      // A foto pode ter sido apagada na limpeza em lote, ou não ter sincronizado.
      // Sem este aviso, saía "PDF pronto ✓" com o quadro do desenho VAZIO e a
      // prancha ia pra produção sem imagem.
      if (p.imagemId && !imagem) semFoto++;
      itens.push(Object.assign({}, p, { imagem, textoDireitos: cfg.textoDireitos || '' }));
    }
    const gerar = async () => {
      const doc = await PRANCHA.gerarPdf(itens, cfg);
      const marca = semFoto ? '-SEM-IMAGEM' : '';
      doc.save('pranchas-v' + versao.versao + marca + '-' + arquivoSeguro(b.cliente) + '.pdf');
      toast(semFoto ? 'PDF gerado, mas ' + semFoto + ' prancha(s) saíram SEM imagem' : 'PDF pronto ✓', semFoto ? 'erro' : 'sucesso');
    };
    if (semFoto) {
      confirmar(semFoto + ' prancha(s) sem imagem',
        'A imagem de ' + semFoto + ' prancha(s) não está mais neste aparelho (limpeza de fotos ou ainda não sincronizou). ' +
        'O PDF sai com o quadro do desenho <b>em branco</b>. Gerar assim mesmo?',
        'Gerar assim', () => { gerar().catch(e => toast('Não consegui remontar: ' + e.message, 'erro')); });
      return;
    }
    await gerar();
  } catch (e) {
    console.error(e);
    toast('Não consegui remontar: ' + e.message, 'erro');
  }
}

/* ══════════════════ Modelo do briefing ══════════════════ */

function novoBriefing() {
  const agora = new Date().toISOString();
  return {
    id: STORE.uuid(),
    numeroBrief: null,
    situacao: 'rascunho',
    status: '',
    vendedor: SESSAO.nome,
    vendedorUsuario: SESSAO.usuario,
    osNumero: '', semOS: false, osOrigem: '', osServico: '',
    cliente: '', responsavel: '', telefone: '',
    dataHora: agora,
    dataMedicao: agora,
    tipoMedicao: '', naturezaServico: '', ambientes: [],
    quemMediu: SESSAO.nome,
    // Carimbo de conclusão da visita: quem fechou e quando (data/hora automáticas)
    visitaConcluida: null,
    endereco: '', estabelecimento: '', pontoReferencia: '', geo: null,
    itens: [],
    croquis: [],
    obsGerais: {
      energia: '', energiaOnde: '', voltagem: '',
      obstaculos: [], obstaculoOutro: '',
      equipamento: '', equipamentoDetalhe: '',
      servicosExtras: [], prazo: '', briefingCliente: '',
      equipeInstalacao: '', tempoExecucao: '', pontoTipo: ''
    },
    enviadoEm: null, apagadoEm: null, apagadoPor: '',
    criadoEm: agora, criadoPor: SESSAO.nome,
    atualizadoEm: agora, atualizadoPor: SESSAO.nome
  };
}

function novoItem() {
  return {
    id: STORE.uuid(), tipo: '', tipoOutro: '', detalheServico: '', quantidade: '1',
    medidas: [{ largura: '', altura: '' }], alturaInstalacao: '',
    superficies: [], superficieOutra: '', fotos: [], obs: ''
  };
}

// Quais fotos são obrigatórias NESTE item: varia por tipo (adesivo de parede
// pede só a foto da parede; letreiro pede o conjunto todo). Configurável no
// painel do admin; tipo sem regra própria usa o padrão.
function fotosObrigatoriasDo(item, cfg) {
  const c = cfg || STORE.getCFG();
  const porTipo = c.fotosPorTipo || {};
  const tipo = item && item.tipo;
  const lista = (tipo && porTipo[tipo]) || c.fotosPadrao || ['fachada', 'close', 'escala'];
  return FOTOS_ITEM.filter(f => lista.includes(f.tipo)).map(f => f.tipo);
}

// Item 100% pronto: nome, medida e as fotos exigidas pelo tipo dele.
function itemCompleto(item, cfg) {
  if (!nomeItem(item) || !temMedida(item)) return false;
  return fotosObrigatoriasDo(item, cfg)
    .every(t => (item.fotos || []).some(x => x.tipo === t && !x.arquivada));
}
function progressoItem(item, cfg) {
  const exigidas = fotosObrigatoriasDo(item, cfg);
  const fotosOk = exigidas.filter(t => (item.fotos || []).some(x => x.tipo === t && !x.arquivada)).length;
  return { fotosOk, fotosTotal: exigidas.length, medidaOk: temMedida(item), nomeOk: !!nomeItem(item) };
}

// Dados essenciais do cliente: enquanto faltarem, a etapa de itens fica travada
// (medir sem saber de quem é a medida já gerou briefing órfão no papel).
function faltaCliente(b) {
  const f = [];
  if (!String(b.cliente || '').trim()) f.push('nome do cliente');
  if (!String(b.telefone || '').trim()) f.push('telefone');
  if (!b.tipoMedicao) f.push('tipo de medição');
  return f;
}

function criarNovo() {
  if (!podeCriar()) { location.hash = '#/lista'; return; }
  const b = novoBriefing();
  STORE.saveOS(JSON.parse(JSON.stringify(b)));
  location.hash = '#/editar/' + b.id;
}

let _timerSalvar = null;
let _salvarPendente = false;
function salvarRascunho(imediato) {
  if (!BRIEF) return;
  BRIEF.atualizadoEm = new Date().toISOString();
  BRIEF.atualizadoPor = SESSAO.nome;
  clearTimeout(_timerSalvar);
  const gravar = () => {
    _salvarPendente = false;
    if (!BRIEF) return true;
    // Não ressuscita um briefing que outro aparelho mandou pra lixeira.
    const armazenado = STORE.getOS(BRIEF.id);
    if (armazenado && armazenado.apagadoEm && !BRIEF.apagadoEm) {
      BRIEF = null;
      toast('Este briefing foi movido pra lixeira em outro aparelho. Não dá pra salvar por cima.', 'erro');
      if (ROTA.nome === 'editor') location.hash = '#/lista';
      return false;
    }
    const ok = STORE.saveOS(JSON.parse(JSON.stringify(BRIEF)));
    const hora = new Date();
    const hhmm = pad2(hora.getHours()) + ':' + pad2(hora.getMinutes());
    const s = $('#salvo-info');
    const r = $('#salvo-rodape');
    if (ok) {
      if (s) s.textContent = 'Salvo automaticamente · ' + hhmm;
      if (r) { r.textContent = '✓ Salvo às ' + hhmm; r.classList.remove('erro'); }
    } else {
      // Memória do aparelho cheia: NÃO mente que salvou. Avisa e pede espaço.
      if (s) s.textContent = '⚠ Não salvou — memória cheia';
      if (r) { r.textContent = '⚠ Não salvou — memória cheia'; r.classList.add('erro'); }
      toast('Memória do aparelho cheia — este briefing NÃO foi salvo. Sincronize e apague briefings antigos antes de continuar.', 'erro');
    }
    return ok;
  };
  if (imediato) return gravar();
  _salvarPendente = true; _timerSalvar = setTimeout(gravar, 600);
  return true;
}

// Grava AGORA o que estiver esperando o tempinho do autosave. Chamado antes de
// qualquer redesenho da tela: o redesenho refaz os campos a partir do BRIEF, e
// sem isso o que o vendedor digitou nos últimos instantes sumiria da tela.
function flushSalvar() {
  if (!_salvarPendente || !BRIEF) return;
  clearTimeout(_timerSalvar);
  _salvarPendente = false;
  STORE.saveOS(JSON.parse(JSON.stringify(BRIEF)));
}

// Cada pendência sabe pra QUAL etapa (e item) ela leva, pra virar um atalho na
// etapa 6. `.texto` mantém a compatibilidade com quem só quer a frase.
function pendencias(b) {
  const p = [];
  const add = (texto, etapa, itemId) => p.push({ texto, etapa, itemId: itemId || null });
  if (!String(b.cliente || '').trim()) add('Nome do cliente', 2);
  if (!String(b.telefone || '').trim()) add('Telefone do cliente', 2);
  if (!b.tipoMedicao) add('Tipo de medição (Orçamento ou Execução)', 2);
  if (!(b.itens || []).length) add('Pelo menos um item medido', 4);
  if (!b.visitaConcluida) add('Marcar "Visita concluída" na etapa ' + (souMedidor() ? '1' : '4'), 4);
  const cfg = STORE.getCFG();
  (b.itens || []).forEach((it, i) => {
    const n = 'Item ' + (i + 1) + (nomeItem(it) ? ' (' + nomeItem(it) + ')' : '');
    if (!nomeItem(it)) add(n + ': nome do item', 4, it.id);
    if (!temMedida(it)) add(n + ': largura e altura', 4, it.id);
    fotosObrigatoriasDo(it, cfg).forEach(t => {
      if (!(it.fotos || []).some(x => x.tipo === t && !x.arquivada)) {
        const def = FOTOS_ITEM.find(f => f.tipo === t);
        add(n + ': foto ' + (def ? def.rotulo.toLowerCase() : t), 4, it.id);
      }
    });
  });
  // O medidor não abre as etapas 1 a 3. Listar "falta o telefone do cliente"
  // pra ele é cobrar uma coisa que ele não tem como resolver — e o atalho "Ir →"
  // apontaria pra uma etapa que nem existe na tela dele.
  return souMedidor() ? p.filter(x => x.etapa >= 4) : p;
}
// Só as frases, pros lugares que não vão pular pra etapa nenhuma.
function pendenciasTexto(b) { return pendencias(b).map(x => x.texto); }

/* ══════════════════ Lista ══════════════════ */

function visiveisPraSessao() {
  // Pranchas avulsas (modo projeto sem briefing) moram no mesmo store, mas não
  // são briefings: ficam fora desta lista.
  let lista = STORE.getAllOS().filter(b => b && !b.apagadoEm && !b.avulsa);
  if (SESSAO.papel === 'vendedor') {
    lista = lista.filter(b => norm(b.vendedorUsuario) === norm(SESSAO.usuario) || b.criadoPor === SESSAO.nome);
  } else if (SESSAO.papel === 'designer') {
    lista = lista.filter(b => b.situacao === 'enviado');
  }
  return lista;
}

function filtrarLista(lista) {
  const t = norm(FILTROS.texto);
  const os = FILTROS.os.trim();
  return lista.filter(b => {
    const alvoBusca = (b.cliente || '') + ' ' + (b.estabelecimento || '') + ' ' + (b.responsavel || '') +
      (b.numeroBrief ? ' ' + b.numeroBrief + ' ' + padBrief(b.numeroBrief) : '');
    if (t && !norm(alvoBusca).includes(t)) return false;
    if (os && !String(b.osNumero || '').includes(os)) return false;
    const dia = diaLocal(b.dataHora || b.criadoEm);
    if (FILTROS.de && dia < FILTROS.de) return false;
    if (FILTROS.ate && dia > FILTROS.ate) return false;
    if (FILTROS.status === '__rascunho__') { if (b.situacao === 'enviado') return false; }
    else if (FILTROS.status && b.status !== FILTROS.status) return false;
    if (FILTROS.vendedor && b.vendedor !== FILTROS.vendedor) return false;
    // "Sem designer": enviado e ainda sem ninguém direcionado
    if (FILTROS.semDesigner && !(b.situacao === 'enviado' && !b.designerAtribuido)) return false;
    if (FILTROS.tipo && b.tipoMedicao !== FILTROS.tipo) return false;
    if (FILTROS.semOS && String(b.osNumero || '').trim()) return false;
    // "Só os meus": o designer vê o que foi direcionado pra ele
    if (FILTROS.meus && !(b.designerAtribuido && norm(b.designerAtribuido.usuario) === norm(SESSAO.usuario))) return false;
    return true;
  });
}

/* ══════════════════ Agenda do medidor (compromissos) ══════════════════ */
// A casa de quem vai à rua. Ele não pensa em "briefing", pensa em "o que eu
// tenho pra hoje" — por isso a tela é uma AGENDA, agrupada por dia, com o
// endereço e o telefone virando botão (mapa e WhatsApp), que é o que ele
// precisa no momento em que está no carro.
// A data E a hora da visita moram no MESMO campo (`dataHora`) — é ele que a
// etapa 2 preenche. Inventar `dataVisita` deixaria a agenda lendo um campo que
// o app nunca grava, e tudo cairia em "sem data".
//
// Mas `dataHora` é o dia em que o COMERCIAL esteve no cliente, e quase sempre já
// passou. O dia em que o medidor tem que ir à rua é a "Data da medida"
// (`dataMedicao`). Lendo só `dataHora`, a visita marcada pra semana que vem
// aparecia em "Hoje" e no dia seguinte virava "⚠️ Atrasada" sem nunca ter
// atrasado — e a agenda perdia a única coisa que ela promete.
function diaDe(b) {
  const bruto = b.dataMedicao || b.dataHora;
  const d = bruto ? new Date(bruto) : null;
  return d && !isNaN(d) ? d : null;
}
// A hora só existe no campo da visita. `dataMedicao` é gravada com 12:00 fixo
// (etapa 2 só pede o dia), então mostrá-la seria anunciar hora marcada que
// ninguém combinou — o medidor chegaria meio-dia num serviço das 8h.
function horaDe(b) {
  if (b.dataMedicao && b.dataHora && diaLocal(b.dataMedicao) !== diaLocal(b.dataHora)) return '';
  const d = b.dataHora ? new Date(b.dataHora) : null;
  return d && !isNaN(d) ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
}
function grupoDoDia(d, concluida) {
  if (!d) return { k: 'sem', rot: 'Sem data marcada', ordem: 5 };
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  const dif = Math.round((dia - hoje) / 86400000);
  if (dif < 0) return concluida
    ? { k: 'feitas', rot: 'Já concluídas', ordem: 4 }
    : { k: 'atraso', rot: '⚠️ Atrasadas', ordem: 0 };
  if (dif === 0) return { k: 'hoje', rot: 'Hoje', ordem: 1 };
  if (dif === 1) return { k: 'amanha', rot: 'Amanhã', ordem: 2 };
  return { k: 'proximas', rot: 'Próximos dias', ordem: 3 };
}

function renderAgenda(app) {
  document.title = 'Minhas visitas';
  const meus = meusCompromissos();
  const grupos = {};
  meus.forEach(b => {
    const d = diaDe(b);
    const g = grupoDoDia(d, !!b.visitaConcluida);
    (grupos[g.k] = grupos[g.k] || { ...g, itens: [] }).itens.push({ b, d });
  });
  const ordenados = Object.values(grupos).sort((x, y) => x.ordem - y.ordem);
  ordenados.forEach(g => g.itens.sort((a, z) => (a.d || 0) - (z.d || 0)));
  const pendentes = meus.filter(b => !b.visitaConcluida).length;

  app.innerHTML = htmlTopo('Minhas visitas') +
    '<div class="conteudo">' +
    '<div class="card"><div class="sub-secao">Olá, ' + esc((SESSAO.nome || '').split(' ')[0]) + '</div>' +
    (meus.length
      ? '<p class="dica-campo" style="margin:0">' + (pendentes
          ? 'Você tem <b>' + pendentes + '</b> visita(s) pra fazer.'
          : 'Tudo em dia por aqui ✓') + '</p>'
      : '<p class="dica-campo" style="margin:0">Nenhuma visita direcionada a você ainda. Quando o comercial marcar seu nome numa visita, ela aparece aqui.</p>') +
    '</div>' +
    ordenados.map(g =>
      '<div class="card"><div class="sub-secao">' + esc(g.rot) + ' · ' + g.itens.length + '</div>' +
      g.itens.map(({ b, d }) => {
        const hora = horaDe(b);
        const tel = String(b.telefone || '').replace(/\D/g, '');
        const end = String(b.endereco || '').trim();
        return '<div class="cartao-visita">' +
          '<div class="cv-topo">' +
          '<div><b>' + esc(b.cliente || 'Cliente') + '</b>' +
          (b.numeroBrief ? ' <span class="dica-campo">Nº ' + esc(b.numeroBrief) + '</span>' : '') +
          '<div class="dica-campo">' +
          (d ? fmtData(d.toISOString()) : 'sem data') + (hora ? ' · ' + esc(hora) : '') +
          (b.tipoMedicao ? ' · ' + esc(b.tipoMedicao) : '') + '</div></div>' +
          (b.visitaConcluida
            ? '<span class="selo-ok">✓ feita</span>'
            : (b.urgente ? '<span class="selo-urgente">URGENTE</span>' : '')) +
          '</div>' +
          (end ? '<div class="cv-end">📍 ' + esc(end) + '</div>' : '') +
          '<div class="cv-acoes">' +
          '<button class="botao mini" data-abrir="' + esc(b.id) + '">' +
          (b.visitaConcluida ? 'Ver o que medi' : '📐 Medir agora') + '</button>' +
          (end ? '<a class="botao mini suave" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
            encodeURIComponent(end) + '">🗺 Como chegar</a>' : '') +
          (tel ? '<a class="botao mini suave" target="_blank" rel="noopener" href="https://wa.me/55' + tel + '">💬 Avisar</a>' : '') +
          '</div></div>';
      }).join('') + '</div>').join('') +
    '</div>';
  ligarTopo();
  $$('[data-abrir]').forEach(bt => bt.onclick = () => { location.hash = '#/editar/' + bt.dataset.abrir; });
}

function renderLista(app) {
  document.title = 'Briefings · Brief de Medição';
  const todos = visiveisPraSessao();
  const vendedores = [...new Set(STORE.getAllOS().filter(b => !b.apagadoEm).map(b => b.vendedor).filter(Boolean))].sort();
  const filtrados = filtrarLista(todos).sort((a, z) => String(z.dataHora || z.criadoEm).localeCompare(String(a.dataHora || a.criadoEm)));

  app.innerHTML =
    htmlTopo('Briefings') +
    '<main class="miolo">' +
    // "Buscar cliente" fica sempre à vista; o resto se recolhe no celular atrás
    // de "Mais filtros", pra lista não abrir escondida atrás de 8 campos.
    // No desktop o CSS mantém tudo aberto.
    '<div class="card"><div class="campo" style="margin:0 0 10px"><label>Buscar cliente</label>' +
    '<input id="f-texto" type="search" placeholder="Parte do nome já encontra" value="' + esc(FILTROS.texto) + '"></div>' +
    '<details class="filtros-extra"' + (filtrosExtraAtivos() ? ' open' : '') + '>' +
    '<summary>Mais filtros' + (filtrosExtraAtivos() ? ' · ativos' : '') + '</summary>' +
    '<div class="filtros">' +
    '<div class="campo" style="margin:0"><label>Número da O.S.</label><input id="f-os" type="text" inputmode="numeric" value="' + esc(FILTROS.os) + '"></div>' +
    '<div class="campo" style="margin:0"><label>De</label><input id="f-de" type="text" inputmode="numeric" maxlength="10" placeholder="dd/mm/aaaa" value="' + esc(FILTROS.deBr || '') + '"></div>' +
    '<div class="campo" style="margin:0"><label>Até</label><input id="f-ate" type="text" inputmode="numeric" maxlength="10" placeholder="dd/mm/aaaa" value="' + esc(FILTROS.ateBr || '') + '"></div>' +
    '<div class="linha-filtros">' +
    '<div class="campo" style="margin:0"><label>Status</label><select id="f-status"><option value="">Todos</option>' +
    '<option value="__rascunho__"' + (FILTROS.status === '__rascunho__' ? ' selected' : '') + '>Rascunho (não enviado)</option>' +
    STATUS_LISTA.map(s => '<option ' + (FILTROS.status === s ? 'selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></div>' +
    (SESSAO.papel !== 'vendedor'
      ? '<div class="campo" style="margin:0"><label>Vendedor</label><select id="f-vendedor"><option value="">Todos</option>' +
        vendedores.map(v => '<option ' + (FILTROS.vendedor === v ? 'selected' : '') + '>' + esc(v) + '</option>').join('') + '</select></div>'
      : '') +
    '<div class="campo" style="margin:0"><label>Tipo de medição</label><select id="f-tipo"><option value="">Todos</option>' +
    ['Orçamento', 'Execução'].map(v => '<option ' + (FILTROS.tipo === v ? 'selected' : '') + '>' + v + '</option>').join('') + '</select></div>' +
    '<div class="campo" style="margin:0"><label>&nbsp;</label>' +
    '<button id="f-semos" class="chip ' + (FILTROS.semOS ? 'marcado' : '') + '" style="width:100%; min-height:48px">Só sem O.S.</button></div>' +
    (SESSAO.papel === 'designer'
      ? '<div class="campo" style="margin:0"><label>&nbsp;</label>' +
        '<button id="f-semdesigner" class="chip ' + (FILTROS.semDesigner ? 'marcado' : '') + '" style="width:100%; min-height:48px">🙋 Sem designer</button></div>' +
        '<div class="campo" style="margin:0"><label>&nbsp;</label>' +
        '<button id="f-meus" class="chip ' + (FILTROS.meus ? 'marcado' : '') + '" style="width:100%; min-height:48px">🎨 Só os meus</button></div>'
      : '') +
    '</div></details>' +
    '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">' +
    '<button class="botao suave mini" id="f-limpar">Limpar filtros</button>' +
    '<button class="botao fantasma mini" id="btn-ficha-branco">🖨 Ficha de visita em branco</button>' +
    '<span class="salvo-info" id="lista-contagem" style="margin-left:auto; align-self:center">' + filtrados.length + ' de ' + todos.length + '</span>' +
    '</div>' +
    '</div>' +
    '<div id="lista-cards">' + htmlCards(filtrados) + '</div>' +
    '</main>' +
    (podeCriar() ? '<button class="fab" id="fab-novo">➕ Novo briefing</button>' : '');

  ligarTopo();
  const rerenderCards = () => {
    const todosAgora = visiveisPraSessao();
    const filt = filtrarLista(todosAgora).sort((a, z) => String(z.dataHora || z.criadoEm).localeCompare(String(a.dataHora || a.criadoEm)));
    $('#lista-cards').innerHTML = htmlCards(filt);
    // A contagem acompanha o filtro (antes ficava "48 de 48" fixo).
    const cont = $('#lista-contagem'); if (cont) cont.textContent = filt.length + ' de ' + todosAgora.length;
    ligarCards();
  };
  _refreshCards = rerenderCards; // pra sincronização de fundo atualizar só os cartões
  $('#f-texto').oninput = debounce(e => { FILTROS.texto = e.target.value; rerenderCards(); }, 250);
  $('#f-os').oninput = debounce(e => { FILTROS.os = e.target.value; rerenderCards(); }, 250);
  $('#f-de').oninput = e => {
    e.target.value = mascaraData(e.target.value);
    FILTROS.deBr = e.target.value;
    FILTROS.de = dataBrParaYmd(e.target.value); // vazio enquanto incompleta = filtro inativo
    rerenderCards();
  };
  $('#f-ate').oninput = e => {
    e.target.value = mascaraData(e.target.value);
    FILTROS.ateBr = e.target.value;
    FILTROS.ate = dataBrParaYmd(e.target.value);
    rerenderCards();
  };
  $('#f-status').onchange = e => { FILTROS.status = e.target.value; rerenderCards(); };
  const fv = $('#f-vendedor'); if (fv) fv.onchange = e => { FILTROS.vendedor = e.target.value; rerenderCards(); };
  $('#f-tipo').onchange = e => { FILTROS.tipo = e.target.value; rerenderCards(); };
  $('#f-semos').onclick = e => { FILTROS.semOS = !FILTROS.semOS; e.target.classList.toggle('marcado', FILTROS.semOS); rerenderCards(); };
  const fm = $('#f-meus'); if (fm) fm.onclick = e => { FILTROS.meus = !FILTROS.meus; e.target.classList.toggle('marcado', FILTROS.meus); rerenderCards(); };
  const fsd = $('#f-semdesigner'); if (fsd) fsd.onclick = e => { FILTROS.semDesigner = !FILTROS.semDesigner; e.target.classList.toggle('marcado', FILTROS.semDesigner); rerenderCards(); };
  $('#f-limpar').onclick = () => { FILTROS = filtrosZerados(); renderApp(); };
  $('#btn-ficha-branco').onclick = () => exportarFichaVisita(null);
  const fab = $('#fab-novo'); if (fab) fab.onclick = () => { location.hash = '#/novo'; };
  // No desktop os filtros ficam sempre abertos (o resumo só existe no celular).
  const fx = $('.filtros-extra'); if (fx && ehDesktop()) fx.open = true;
  ligarCards();
}

function htmlCards(lista) {
  if (!lista.length) {
    // Distingue "você não tem nenhum" de "o filtro escondeu tudo".
    const temFiltro = FILTROS.texto || filtrosExtraAtivos();
    if (temFiltro) {
      return '<div class="vazio"><div class="icone">🔍</div>Nenhum briefing com esse recorte.' +
        '<br><button class="botao suave mini" id="vazio-limpar" style="margin-top:12px">Limpar filtros</button></div>';
    }
    return '<div class="vazio"><div class="icone">📭</div>Nenhum briefing por aqui ainda.' +
      (podeCriar() ? '<br>Toque em "Novo briefing" pra começar.' : '') + '</div>';
  }
  const naFila = STORE.idsNaFila();
  return lista.map(b => {
    const rascunho = b.situacao !== 'enviado';
    // Enviado mas ainda não confirmado pelo servidor: ou está na fila (subindo),
    // ou o envio foi descartado após muitas falhas (_syncFalhou). O vendedor
    // precisa ver isso -- antes o cartão ficava igual aos que já chegaram.
    const naoSubiu = !rascunho && b._syncFalhou;
    const subindo = !rascunho && !b._syncFalhou && naFila.has(b.id);
    return (
      '<button class="cartao-brief" data-id="' + b.id + '" data-rascunho="' + (rascunho ? '1' : '') + '">' +
      '<div><div class="nome">' + esc(b.cliente || 'Cliente sem nome') + (b.estabelecimento ? ' · ' + esc(b.estabelecimento) : '') + '</div>' +
      '<div class="meta">' + fmtDataHora(b.dataHora || b.criadoEm) + ' · ' + esc(b.vendedor || '') +
      ' · ' + (b.itens || []).length + ' item(ns)</div>' +
      '<div class="badges">' +
      (b.urgente ? '<span class="badge urgente-badge">🔴 URGENTE</span>' : '') +
      (b.numeroBrief ? '<span class="badge neutro">Nº ' + padBrief(b.numeroBrief) + '</span>' : '') +
      (naoSubiu ? '<span class="badge nao-subiu">⚠ NÃO SUBIU — toque</span>'
        : subindo ? '<span class="badge subindo">⏳ subindo…</span>'
        // Devolvido pelo design: destaca, senão vira um "RASCUNHO" qualquer no
        // meio da lista e o vendedor não sabe que tem correção esperando.
        : (rascunho && b.devolucao) ? '<span class="badge devolvido">↩️ DEVOLVIDO — corrigir</span>'
        : rascunho ? '<span class="badge rascunho">RASCUNHO</span>' : badgeStatus(b.status)) +
      (b.tipoMedicao ? '<span class="badge ' + (b.tipoMedicao === 'Execução' ? 'tipo-execucao' : 'tipo-orcamento') + '">' + esc(b.tipoMedicao) + '</span>' : '') +
      (String(b.osNumero || '').trim() ? '<span class="badge neutro">O.S. ' + esc(b.osNumero) + '</span>' : '<span class="badge sem-os">SEM O.S.</span>') +
      (!rascunho && b.designerAtribuido ? '<span class="badge designer">🎨 ' + esc(b.designerAtribuido.nome) + '</span>' : '') +
      // Quem está com a visita na rua: sem isto, o comercial direciona e depois
      // não lembra pra quem, nem sabe se já foi medida.
      (b.medidorAtribuido ? '<span class="badge medidor">📍 ' + esc(b.medidorAtribuido.nome) +
        (b.visitaConcluida ? ' ✓' : '') + '</span>' : '') +
      '</div></div>' +
      '</button>'
    );
  }).join('');
}

function ligarCards() {
  $$('.cartao-brief').forEach(c => {
    c.onclick = () => {
      const id = c.dataset.id;
      const b = STORE.getOS(id);
      if (!b) return;
      // Briefing que não subiu: tocar tenta enviar de novo, ali mesmo.
      if (b._syncFalhou) {
        delete b._syncFalhou; delete b._syncMotivo;
        const ok = STORE.saveOS(b); // re-enfileira e tenta sincronizar
        toast(ok ? 'Tentando enviar de novo…' : 'Memória cheia — apague briefings antigos primeiro', ok ? 'sucesso' : 'erro');
        if (typeof _refreshCards === 'function') _refreshCards(); // tira o selo na hora
        return;
      }
      const meu = norm(b.vendedorUsuario) === norm(SESSAO.usuario);
      if (b.situacao !== 'enviado' && (meu || SESSAO.papel === 'admin')) location.hash = '#/editar/' + id;
      else location.hash = '#/b/' + id;
    };
  });
  // Botão do estado vazio "com filtro": limpa e redesenha.
  const vl = $('#vazio-limpar');
  if (vl) vl.onclick = () => { FILTROS = filtrosZerados(); renderApp(); };
}

/* ══════════════════ Editor (wizard) ══════════════════ */

const ETAPAS_DEF = [
  { n: 1, nome: 'Vendedor' },
  { n: 2, nome: 'O.S. e cliente' },
  { n: 3, nome: 'Local' },
  { n: 4, nome: 'Itens e fotos' },
  { n: 5, nome: 'Observações' },
  { n: 6, nome: 'Revisão e envio' }
];
// Pro medidor a etapa 6 não é "revisão e envio" — ele não envia nada: é o
// fechamento da visita dele. Um só lugar decide o rótulo, senão o cabeçalho e a
// barra lateral discordam (foi o que aconteceu na primeira tentativa).
function nomeEtapa(n) {
  return (souMedidor() && n === 6) ? 'Fechar a visita' : ETAPAS_DEF[n - 1].nome;
}

function renderEditor(app) {
  const b = STORE.getOS(ROTA.id);
  if (!b) { toast('Briefing não encontrado neste aparelho', 'erro'); location.hash = '#/lista'; return; }
  if (b.situacao === 'enviado' && SESSAO.papel !== 'admin') { location.hash = '#/b/' + b.id; return; }
  // Troca de briefing: estado de tela do anterior não vale mais. Zera a ETAPA
  // tambem -- senao o briefing NOVO abria na etapa em que o anterior parou
  // (sempre a 6, a tela de erros de envio), obrigando a voltar 5 vezes.
  // Medidor só abre o que foi direcionado a ele -- sem isto, um id na barra de
  // endereço daria acesso ao briefing de qualquer cliente.
  if (souMedidor() && !(b.medidorAtribuido && norm(b.medidorAtribuido.usuario) === norm(SESSAO.usuario))) {
    toast('Esta visita não está direcionada a você.', 'erro');
    location.hash = '#/agenda';
    return;
  }
  if (!BRIEF || BRIEF.id !== b.id) {
    ITENS_RECOLHIDOS.clear(); OS_ITENS_DESMARCADOS.clear();
    // A rua começa na etapa 4: o medidor não mexe em vendedor, O.S. e cliente.
    ETAPA = souMedidor() ? 4 : 1;
  }
  if (souMedidor() && ETAPA < 4) ETAPA = 4;
  // Guarda a rolagem: no celular, quase todo toque do editor (marcar superficie,
  // tirar foto, adicionar ponto) redesenha a tela inteira. Se sempre subisse pro
  // topo, o vendedor perdia o lugar dezenas de vezes por visita. Guardamos a
  // posicao e so subimos quando a ETAPA realmente muda.
  const rolagemAntes = window.scrollY;
  const mesmaEtapa = _ultimaEtapaRender === ETAPA && _ultimoBriefRender === b.id;
  _ultimaEtapaRender = ETAPA; _ultimoBriefRender = b.id;
  BRIEF = b;
  if (!BRIEF.obsGerais) BRIEF.obsGerais = novoBriefing().obsGerais;
  if (!BRIEF.croquis) BRIEF.croquis = [];
  document.title = 'Briefing · ' + (BRIEF.cliente || 'novo');
  const cfg = STORE.getCFG();

  app.innerHTML =
    htmlTopo((BRIEF.numeroBrief ? 'Nº ' + padBrief(BRIEF.numeroBrief) + ' · ' : '') + (BRIEF.cliente || 'Novo briefing')) +
    '<main class="miolo"><div class="editor-grade">' +
    '<aside class="sidebar-etapas">' +
    ETAPAS_DEF.filter(e => !souMedidor() || e.n >= 4)
      // A numeração acompanha o cabeçalho: pro medidor a etapa 4 é a "1 de 3".
      .map(e => '<a href="#" data-etapa="' + e.n + '" class="' + (e.n === ETAPA ? 'ativa' : '') + '">' +
        (souMedidor() ? e.n - 3 : e.n) + '. ' + nomeEtapa(e.n) + '</a>').join('') +
    '<div style="padding:12px 14px"><span id="salvo-info" class="salvo-info"></span></div>' +
    '</aside>' +
    '<div>' +
    // O design devolveu pedindo correção: o vendedor precisa VER o motivo ao
    // reabrir. Antes o recado só existia na tela do detalhe, que ele não abre.
    (BRIEF.devolucao
      ? '<div class="aviso vermelho" style="margin-bottom:12px">↩️ <b>Devolvido pra correção</b> por ' +
        esc(BRIEF.devolucao.por) + ' em ' + fmtDataHora(BRIEF.devolucao.em) +
        (BRIEF.devolucao.motivo ? ':<br>“' + esc(BRIEF.devolucao.motivo) + '”' : '') +
        '<br><span class="dica-campo">Corrija e envie de novo na etapa 6.</span></div>'
      : '') +
    // Cabeçalho da rua: o medidor não abre as etapas 1-3, mas PRECISA do que
    // está nelas para chegar e para ligar. Então o essencial vem para cima.
    (souMedidor()
      ? '<div class="card cabeca-rua">' +
        '<div class="sub-secao" style="margin-top:0">A visita</div>' +
        '<div class="dupla-dado"><dt>Cliente</dt><dd><b>' + esc(BRIEF.cliente || '—') + '</b></dd></div>' +
        (BRIEF.responsavel ? '<div class="dupla-dado"><dt>Contato</dt><dd>' + esc(BRIEF.responsavel) + '</dd></div>' : '') +
        (BRIEF.endereco ? '<div class="dupla-dado"><dt>Endereço</dt><dd>' + esc(BRIEF.endereco) + '</dd></div>' : '') +
        (BRIEF.pontoReferencia ? '<div class="dupla-dado"><dt>Referência</dt><dd>' + esc(BRIEF.pontoReferencia) + '</dd></div>' : '') +
        (BRIEF.tipoMedicao ? '<div class="dupla-dado"><dt>Tipo</dt><dd>' + esc(BRIEF.tipoMedicao) +
          (BRIEF.urgente ? ' · <b style="color:var(--perigo)">URGENTE</b>' : '') + '</dd></div>' : '') +
        '<div class="cv-acoes" style="margin-top:10px">' +
        (BRIEF.endereco ? '<a class="botao mini suave" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent(BRIEF.endereco) + '">🗺 Como chegar</a>' : '') +
        (BRIEF.telefone ? '<a class="botao mini suave" target="_blank" rel="noopener" href="https://wa.me/55' +
          String(BRIEF.telefone).replace(/\D/g, '') + '">💬 Falar com o cliente</a>' : '') +
        '<a class="botao mini fantasma" href="#/agenda">← Minhas visitas</a>' +
        '</div></div>'
      : '') +
    (souMedidor()
      ? '<div class="progresso"><div class="passos"><span>Etapa ' + (ETAPA - 3) + ' de 3</span><span>' + esc(nomeEtapa(ETAPA)) + '</span></div>' +
        '<div class="trilho"><div class="barra" style="width:' + ((ETAPA - 3) / 3 * 100) + '%"></div></div></div>'
      : '<div class="progresso"><div class="passos"><span>Etapa ' + ETAPA + ' de 6</span><span>' + esc(nomeEtapa(ETAPA)) + '</span></div>' +
        '<div class="trilho"><div class="barra" style="width:' + (ETAPA / 6 * 100) + '%"></div></div></div>') +
    (souMedidor() ? '' : htmlEtapa1() + htmlEtapa2(cfg) + htmlEtapa3()) +
    htmlEtapa4(cfg) + htmlEtapa5() + htmlEtapa6() +
    '</div></div></main>' +
    '<div class="rodape-wizard">' +
    '<button class="botao fantasma so-mobile" id="btn-voltar"' + (ETAPA === (souMedidor() ? 4 : 1) ? ' disabled' : '') + '>← Voltar</button>' +
    // Sem sinal o vendedor não tinha nenhuma confirmação de que gravou; agora a
    // barra de baixo mostra "Salvo às HH:MM" (o desktop já mostrava na lateral).
    '<span class="salvo-rodape" id="salvo-rodape"></span>' +
    (ETAPA < 6
      ? '<button class="botao so-mobile" id="btn-avancar">Avançar →</button>'
      : '') +
    '</div>';

  // Ativa a etapa atual no mobile
  $$('.etapa').forEach(sec => sec.classList.toggle('ativa', Number(sec.dataset.etapa) === ETAPA));

  ligarTopo();
  ligarEditor(cfg);
  carregarThumbs();
  // So sobe pro topo quando a etapa mudou; senao devolve a rolagem que o
  // usuario tinha, pra ele nao perder o lugar a cada chip marcado.
  if (!ehDesktop()) {
    if (mesmaEtapa) window.scrollTo(0, rolagemAntes);
    else window.scrollTo(0, 0);
  }
}

function mudarEtapa(n) {
  ETAPA = Math.min(6, Math.max(1, n));
  renderApp();
}

function htmlEtapa1() {
  return (
    '<section class="etapa" data-etapa="1"><div class="card">' +
    '<div class="sub-secao">Etapa 1 · Vendedor</div>' +
    '<div class="linha-2">' +
    '<div class="campo"><label>Vendedor (preenchido pelo login)</label>' +
    '<input type="text" value="' + esc(BRIEF.vendedor) + '" disabled></div>' +
    '<div class="campo"><label>Número do brief (automático)</label>' +
    '<input type="text" id="num-brief-campo" value="' + esc(rotuloBrief(BRIEF)) + '" disabled></div>' +
    '</div>' +
    '<p class="dica-campo">Se quem mediu for outra pessoa, informe na etapa 2.</p>' +
    '</div></section>'
  );
}

function htmlEtapa2(cfg) {
  const exec = BRIEF.tipoMedicao === 'Execução';
  return (
    '<section class="etapa" data-etapa="2"><div class="card">' +
    '<div class="sub-secao">Etapa 2 · O.S. e cliente</div>' +

    '<div class="campo"><label>Número da O.S. (opcional)</label>' +
    '<div style="display:flex; gap:8px"><input id="c-osnumero" type="text" inputmode="numeric" placeholder="Ex: 22416" value="' + esc(BRIEF.osNumero) + '" style="flex:1">' +
    '<button class="botao suave" id="btn-buscar-os" style="min-width:110px">Buscar</button></div>' +
    '<div id="os-resultado">' +
    (BRIEF.osOrigem && BRIEF.osNumero ? '<div class="aviso verde">O.S. ' + esc(BRIEF.osNumero) + ' vinculada' + (BRIEF.osServico ? ': ' + esc(BRIEF.osServico) : '') + '</div>' : '') +
    (BRIEF._avisoClienteOS ? '<div class="aviso amarelo">⚠ Essa O.S. está no nome de <b>' + esc(BRIEF._avisoClienteOS) + '</b> — confira se é a O.S. certa deste cliente.</div>' : '') +
    '</div>' +
    '<label class="chip ' + (BRIEF.semOS ? 'marcado' : '') + '" id="chip-semos" style="margin-top:8px; display:inline-flex">Sem O.S. por enquanto</label>' +
    '<div class="dica-campo">Sem número agora? Sem problema, o briefing segue e recebe a O.S. depois.</div></div>' +

    '<div class="campo"><label>Nome do cliente / empresa <span class="obrig">*</span></label>' +
    '<input id="c-cliente" type="text" value="' + esc(BRIEF.cliente) + '"></div>' +
    '<div class="linha-2">' +
    '<div class="campo"><label>Responsável (contato)</label><input id="c-responsavel" type="text" value="' + esc(BRIEF.responsavel) + '"></div>' +
    '<div class="campo"><label>Telefone <span class="obrig">*</span></label><input id="c-telefone" type="tel" inputmode="tel" placeholder="(38) 99999-9999" value="' + esc(BRIEF.telefone) + '"></div>' +
    '</div>' +
    '<div class="linha-3">' +
    '<div class="campo"><label>Data da visita</label>' +
    '<input id="c-data" type="text" inputmode="numeric" placeholder="dd/mm/aaaa" maxlength="10" value="' + esc(isoParaDataBr(BRIEF.dataHora)) + '">' +
    '<div class="dica-campo erro-campo" id="aviso-data"></div></div>' +
    '<div class="campo"><label>Hora</label>' +
    '<input id="c-hora" type="text" inputmode="numeric" placeholder="hh:mm" maxlength="5" value="' + esc(isoParaHoraBr(BRIEF.dataHora)) + '"></div>' +
    '<div class="campo"><label>Data da medida</label>' +
    '<input id="c-datamedicao" type="text" inputmode="numeric" placeholder="dd/mm/aaaa" maxlength="10" value="' + esc(isoParaDataBr(BRIEF.dataMedicao || BRIEF.dataHora)) + '">' +
    '<div class="dica-campo erro-campo" id="aviso-medida"></div></div>' +
    '</div>' +

    '<div class="campo"><label>Tipo de medição <span class="obrig">*</span></label>' +
    '<div class="opcoes duas">' +
    '<div class="opcao ' + (BRIEF.tipoMedicao === 'Orçamento' ? 'marcada' : '') + '" data-tipomed="Orçamento">📄 Orçamento</div>' +
    '<div class="opcao ' + (exec ? 'marcada' : '') + '" data-tipomed="Execução">⚠️ Execução</div>' +
    '</div>' +
    (exec ? '<div class="aviso vermelho">Estas medidas vão pra produção. Confira duas vezes.</div>' : '') +
    '</div>' +

    // Urgência marcada pelo vendedor no cliente: a prancha da produção já sai com
    // o carimbo URGENTE, sem precisar avisar o designer à parte.
    '<div class="campo"><label>Prioridade</label>' +
    '<button class="chip chip-urgente ' + (BRIEF.urgente ? 'marcado' : '') + '" id="c-urgente">🔴 Marcar como URGENTE</button>' +
    '<div class="dica-campo">Só marque se for pressa de verdade — a produção prioriza.</div></div>' +

    '<div class="campo"><label>Natureza do serviço</label><select id="c-natureza"><option value="">Escolher…</option>' +
    ['Serviço novo', 'Restauração ou troca', 'Remoção'].map(o => '<option ' + (BRIEF.naturezaServico === o ? 'selected' : '') + '>' + o + '</option>').join('') + '</select></div>' +

    '<div class="campo"><label>Ambiente (pode marcar os dois)</label><div class="chips">' +
    AMBIENTES.map(a => '<button class="chip ' + (ambientesDe(BRIEF).includes(a) ? 'marcado' : '') + '" data-ambiente="' + esc(a) + '">' + esc(a) + '</button>').join('') +
    '</div></div>' +

    '<div class="campo"><label>Quem mediu</label><input id="c-quemmediu" type="text" value="' + esc(BRIEF.quemMediu) + '">' +
    '<div class="dica-campo">Pode ser diferente do vendedor.</div></div>' +
    '</div></section>'
  );
}

function htmlEtapa3() {
  return (
    '<section class="etapa" data-etapa="3"><div class="card">' +
    '<div class="sub-secao">Etapa 3 · Local</div>' +
    '<div class="campo"><label>Endereço completo</label>' +
    '<textarea id="c-endereco" rows="2">' + esc(BRIEF.endereco) + '</textarea>' +
    '<button class="botao suave mini" id="btn-gps" style="margin-top:8px">📍 Usar minha localização</button>' +
    '<span id="gps-status" class="dica-campo" style="margin-left:8px"></span></div>' +
    '<div class="linha-2">' +
    '<div class="campo"><label>Nome do estabelecimento (opcional)</label><input id="c-estab" type="text" value="' + esc(BRIEF.estabelecimento) + '"></div>' +
    '<div class="campo"><label>Ponto de referência</label><input id="c-ref" type="text" value="' + esc(BRIEF.pontoReferencia) + '"></div>' +
    '</div>' +
    // Quem vai medir sai daqui: local definido, pessoa definida. É este campo
    // que faz o briefing aparecer na agenda dela.
    '<div class="campo"><label>Quem vai medir</label>' +
    '<button class="botao suave largo" id="btn-medidor" style="text-align:left">' +
    (BRIEF.medidorAtribuido ? '📍 ' + esc(BRIEF.medidorAtribuido.nome) : '👤 Escolher quem vai à rua') +
    '</button>' +
    '<div class="dica-campo" style="margin-top:6px">' +
    (BRIEF.medidorAtribuido
      ? 'Aparece na agenda de ' + esc(BRIEF.medidorAtribuido.nome) + ' com a data e o endereço.'
      : 'Sem escolher, a visita não entra na agenda de ninguém — quem mede é você mesmo.') +
    '</div></div>' +
    '<button class="botao fantasma mini" id="btn-ficha-visita">🖨 Ficha de visita desta visita (PDF)</button>' +
    '<div class="dica-campo" style="margin-top:6px">Imprima antes de sair: a ficha tem espaço quadriculado pro desenho a mão. Depois fotografe o desenho na etapa 4.</div>' +
    '</div></section>'
  );
}

function htmlEtapa4(cfg) {
  // Faltando os dados do cliente, avisamos e travamos só o que ADICIONA item —
  // esconder a etapa inteira faria o vendedor achar que perdeu o que já mediu.
  const falta = faltaCliente(BRIEF);
  const travado = falta.length > 0;
  const prontos = BRIEF.itens.filter(it => itemCompleto(it, cfg)).length;
  const concl = BRIEF.visitaConcluida;
  return (
    '<section class="etapa" data-etapa="4">' +
    '<div class="card" style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap">' +
    '<div><div class="sub-secao" style="margin:0">' + (souMedidor() ? 'Itens medidos' : 'Etapa 4 · Itens medidos') + '</div>' +
    '<span class="dica-campo">' + BRIEF.itens.length + ' item(ns) · ' + prontos + ' completo(s)</span></div>' +
    '<div style="display:flex; gap:6px">' +
    (BRIEF.itens.length > 1 ? '<button class="botao mini fantasma" id="btn-recolher-todos">Recolher todos</button>' : '') +
    '<button class="botao mini fantasma" id="btn-manual-4">❓ Manual</button></div></div>' +

    (travado
      ? '<div class="card"><div class="aviso amarelo" style="margin-top:0">🔒 Para adicionar itens, preencha antes: <b>' +
        esc(falta.join(', ')) + '</b>. Assim a medida nunca fica sem dono.</div>' +
        // O que dá pra resolver AQUI resolve aqui: na rua, mandar o vendedor
        // de volta pra etapa 2 na frente do cliente é vaivém à toa. O tipo de
        // medição vira dois toques no próprio aviso.
        (!BRIEF.tipoMedicao
          ? '<div class="escolha-tipo" style="display:flex; gap:8px; margin-bottom:10px">' +
            '<div class="opcao" data-tipomed4="Orçamento">📄 Orçamento</div>' +
            '<div class="opcao" data-tipomed4="Execução">⚠️ Execução</div></div>'
          : '') +
        (falta.some(f => f !== 'tipo de medição')
          ? '<button class="botao largo suave" id="btn-ir-etapa2">Ir para a etapa 2</button>'
          : '') +
        '</div>'
      : '') +

    // Itens que vieram na O.S.: adianta o serviço, o vendedor só confere
    '<div id="painel-os-itens">' + (travado ? '' : htmlItensDaOS()) + '</div>' +

    '<div id="lista-itens">' + BRIEF.itens.map((it, i) => htmlItem(it, i, cfg)).join('') + '</div>' +
    '<button class="botao largo suave" id="btn-add-item" style="margin-bottom:14px"' + (travado ? ' disabled' : '') + '>➕ Adicionar item</button>' +

    // Fecho da visita: carimba quem concluiu e a data/hora automaticamente
    '<div class="card">' +
    (concl
      ? '<div class="aviso verde"><b>✓ Visita concluída</b><br>' + esc(concl.por) + ' · ' + fmtDataHora(concl.em) + '</div>' +
        '<button class="botao mini fantasma" id="btn-reabrir-visita">Reabrir visita</button>'
      : '<div class="sub-secao">Fim da visita</div>' +
        '<p class="dica-campo" style="margin-bottom:10px">Terminou de medir e fotografar? Conclua a visita: o app grava quem concluiu e carimba a data e a hora sozinho. O envio pro design libera depois disso.</p>' +
        (BRIEF.itens.length
          ? '<button class="botao largo" id="btn-concluir-visita">✅ Visita concluída</button>'
          : '<div class="aviso amarelo" style="margin:0">Adicione pelo menos um item medido antes de concluir a visita.</div>')) +
    '</div>' +

    '<div class="card"><div class="sub-secao">Desenhos da visita (croquis)</div>' +
    '<p class="dica-campo" style="margin-bottom:10px">Fotografe a ficha de visita desenhada a mão. Os desenhos entram no PDF final pro designer.</p>' +
    '<div class="grade-fotos" id="grade-croquis">' +
    BRIEF.croquis.map((c, i) =>
      '<div class="slot-foto cheio"><div class="rotulo">Desenho ' + (i + 1) + '</div>' +
      '<img class="thumb" data-foto-id="' + esc(c.id) + '" data-galeria="croquis" data-indice="' + i + '" alt="Desenho ' + (i + 1) + '">' +
      '<div class="acoes"><button class="botao mini perigo" data-remover-croqui="' + i + '">Remover</button></div></div>'
    ).join('') +
    '<div class="slot-foto"><div class="rotulo">Novo desenho</div>' +
    '<button class="botao-foto" id="btn-add-croqui"><span class="icone">📷</span>Fotografar ficha</button>' +
    '<input type="file" accept="image/*" id="input-croqui" hidden></div>' +
    '</div></div>' +
    '</section>'
  );
}

function htmlItem(item, idx, cfg) {
  const tipos = (cfg.tiposItem || []);
  const superficies = (cfg.superficies || []);
  const dicas = cfg.dicas || {};
  const marcadas = item.superficies || [];
  const area = areaItem(item);
  const completo = itemCompleto(item, cfg);
  const recolhido = ITENS_RECOLHIDOS.has(item.id);
  const p = progressoItem(item, cfg);
  const exigidas = fotosObrigatoriasDo(item, cfg);
  const resumo = completo
    ? 'Completo · ' + (area > 0 ? fmtM2(area) : '')
    : [p.nomeOk ? '' : 'falta nome', p.medidaOk ? '' : 'falta medida',
       p.fotosOk < p.fotosTotal ? (p.fotosOk + '/' + p.fotosTotal + ' fotos') : ''].filter(Boolean).join(' · ');
  return (
    '<div class="card-item' + (completo ? ' completo' : '') + (recolhido ? ' recolhido' : '') + '" data-item="' + item.id + '">' +
    '<div class="cabeca">' +
    '<button class="alternar-item" data-alternar="' + item.id + '" aria-expanded="' + (!recolhido) + '">' +
    '<span class="seta">' + (recolhido ? '▸' : '▾') + '</span>' +
    '<span class="info-item">' +
    '<span class="titulo-item">' + (completo ? '✅ ' : '') + 'Item ' + (idx + 1) +
    (nomeItem(item) ? ' · ' + esc(nomeItem(item)) : '') + '</span>' +
    (resumo ? '<span class="resumo-chip">' + esc(resumo) + '</span>' : '') +
    '</span></button>' +
    '<button class="botao mini perigo botao-remover" data-remover-item="' + item.id + '" title="Remover item">' +
    '🗑<span class="rotulo-remover"> Remover</span></button></div>' +

    '<div class="corpo-item">' +
    (item.origemOS ? '<div class="aviso indigo" style="margin-top:0">Veio da O.S. ' + esc(item.osNum || BRIEF.osNumero || '') + '. Confira as medidas no local.</div>' : '') +

    '<div class="linha-2">' +
    '<div class="campo"><label>Nome do item <span class="obrig">*</span></label>' +
    '<select data-icampo="tipo"><option value="">Escolher…</option>' +
    tipos.map(t => '<option ' + (item.tipo === t ? 'selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></div>' +
    (item.tipo === 'Outro'
      ? '<div class="campo"><label>Qual?</label><input type="text" data-icampo="tipoOutro" value="' + esc(item.tipoOutro) + '"></div>'
      : '<div class="campo"><label>Detalhe do serviço/material</label><input type="text" data-icampo="detalheServico" placeholder="Ex: ACM com letra caixa iluminada" value="' + esc(item.detalheServico) + '"></div>') +
    '</div>' +
    (item.tipo === 'Outro' ? '<div class="campo"><label>Detalhe do serviço/material</label><input type="text" data-icampo="detalheServico" value="' + esc(item.detalheServico) + '"></div>' : '') +
    '<div class="campo"><label>Quantidade</label>' +
    '<input type="text" inputmode="numeric" data-icampo="quantidade" style="max-width:140px" value="' + esc(item.quantidade || '1') + '"></div>' +

    '<div class="campo"><label>Medidas (cm) <span class="obrig">*</span> <button class="botao mini fantasma" data-manual="medir" style="min-height:32px; padding:4px 10px; margin-left:6px">?</button></label>' +
    (item.medidas || []).map((p, pi) =>
      '<div class="par-medida">' +
      '<input type="text" inputmode="decimal" placeholder="Largura" data-medida="largura" data-par="' + pi + '" value="' + esc(p.largura) + '">' +
      '<span class="x">×</span>' +
      '<input type="text" inputmode="decimal" placeholder="Altura" data-medida="altura" data-par="' + pi + '" value="' + esc(p.altura) + '">' +
      ((item.medidas.length > 1) ? '<button class="acao-par" data-remover-par="' + pi + '" title="Remover este ponto">✕</button>' : '<span></span>') +
      '</div>'
    ).join('') +
    '<div class="area-info" data-area-item>' + (area > 0 ? 'Área: ' + fmtM2(area) + (item.medidas.length > 1 ? ' (soma de ' + item.medidas.length + ' pontos)' : '') : 'Área calculada automática') + '</div>' +
    '<button class="botao mini suave" data-add-par>➕ Adicionar ponto de medição (superfície irregular)</button></div>' +

    '<div class="campo"><label>Altura de instalação (cm, do chão até a base da peça)</label>' +
    '<input type="text" inputmode="decimal" data-icampo="alturaInstalacao" value="' + esc(item.alturaInstalacao) + '"></div>' +

    '<div class="campo"><label>Superfície (marque todas que valem)</label>' +
    '<div class="chips">' +
    superficies.map(s => '<button class="chip ' + (marcadas.includes(s) ? 'marcado' : '') + '" data-superficie="' + esc(s) + '">' + esc(s) + '</button>').join('') +
    '</div>' +
    (marcadas.includes('Outro') ? '<div class="campo" style="margin-top:10px"><label>Qual superfície?</label><input type="text" data-icampo="superficieOutra" value="' + esc(item.superficieOutra) + '"></div>' : '') +
    (marcadas.filter(s => dicas[s]).length
      ? '<div class="box-dicas">' + marcadas.filter(s => dicas[s]).map(s => '<div class="uma-dica"><b>' + esc(s) + ':</b><span>' + esc(dicas[s]) + '</span></div>').join('') + '</div>'
      : '') +
    '</div>' +

    '<div class="campo"><label>Fotos ' +
    '<span class="dica-campo" style="font-weight:400">' +
    (exigidas.length === 1 ? '(1 obrigatória neste tipo)' : '(' + exigidas.length + ' obrigatórias neste tipo)') + '</span>' +
    '<button class="botao mini fantasma" data-manual="foto" style="min-height:32px; padding:4px 10px; margin-left:6px">?</button></label>' +
    '<div class="grade-fotos">' +
    FOTOS_ITEM.map(def => {
      const f = (item.fotos || []).find(x => x.tipo === def.tipo && !x.arquivada);
      const obrig = exigidas.includes(def.tipo);
      return (
        '<div class="slot-foto ' + (f ? 'cheio' : '') + (obrig ? '' : ' opcional') + '">' +
        '<div class="rotulo">' + esc(def.rotulo) + (obrig ? ' <span class="obrig">*</span>' : '') + '</div>' +
        (f
          ? '<img class="thumb" data-foto-id="' + esc(f.id) + '" data-galeria="item:' + item.id + '" alt="' + esc(def.rotulo) + '">' +
            '<div class="acoes"><button class="botao mini suave" data-trocar-foto="' + def.tipo + '">Trocar</button>' +
            '<button class="botao mini perigo" data-remover-foto="' + def.tipo + '">✕</button></div>'
          : '<button class="botao-foto" data-tirar-foto="' + def.tipo + '"><span class="icone">📷</span>Tirar ou enviar</button>') +
        // Sem capture: o celular pergunta "Câmera ou Galeria" -- que é o que o
        // botão promete. Com capture, ia direto pra câmera e a foto que o
        // cliente mandou no WhatsApp não tinha como entrar.
        '<input type="file" accept="image/*" data-input-foto="' + def.tipo + '" hidden>' +
        '</div>'
      );
    }).join('') +
    '</div></div>' +

    '<div class="campo" style="margin-bottom:0"><label>Observação do item (opcional)</label>' +
    '<textarea data-icampo="obs" rows="2">' + esc(item.obs) + '</textarea></div>' +
    '</div>' + // fecha .corpo-item
    '</div>'
  );
}

// Painel dos itens que vieram na O.S., ainda não trazidos pro briefing.
function htmlItensDaOS() {
  const osItens = BRIEF.osItens || [];
  const pendentes = osItens.map((it, i) => ({ it, i })).filter(x => !x.it.importado);
  if (!pendentes.length) return '';
  return (
    '<div class="card" style="border:1.5px solid var(--indigo)">' +
    '<div class="sub-secao" style="margin-bottom:4px">Itens da O.S. ' + esc(BRIEF.osNumero || '') + '</div>' +
    '<p class="dica-campo" style="margin-bottom:10px">Vieram do sistema. Marque os que você vai medir e traga pro briefing: já entram com medida e quantidade preenchidas, é só conferir no local.</p>' +
    pendentes.map(({ it, i }) =>
      '<label class="linha-os-item">' +
      '<input type="checkbox" data-osidx="' + i + '"' + (OS_ITENS_DESMARCADOS.has(i) ? '' : ' checked') + '>' +
      '<span><b>' + esc(String(it.descricao || 'Item').slice(0, 70)) + '</b>' +
      '<span class="dica-campo">' + (it.medidas ? esc(it.medidas) + ' m' : 'sem medida') +
      ' · qtde ' + esc(it.qtde || '1') + '</span></span>' +
      '</label>'
    ).join('') +
    '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px">' +
    '<button class="botao mini" id="btn-importar-os">Trazer selecionados</button>' +
    '<button class="botao mini fantasma" id="btn-descartar-os">Não usar estes</button>' +
    '</div></div>'
  );
}

// Converte um item da O.S. num item do briefing (medidas da O.S. vêm em METROS).
function itemDaOS(osItem, cfg) {
  const it = novoItem();
  const desc = String(osItem.descricao || '').trim();
  // O casamento do tipo olha só o começo da descrição (o produto). Depois de
  // "Modelo:"/"Variação:" vem o material, e "MDF Modelo: … C/ Adesivo" acabava
  // classificado como Adesivo.
  const produto = desc.split(/Modelo:|Varia[çc][ãa]o:/i)[0] || desc;
  const tipos = (cfg.tiposItem || []).filter(t => t !== 'Outro')
    .slice().sort((a, z) => z.length - a.length); // mais específico primeiro
  const achado = tipos.find(t => norm(produto).includes(norm(t)));
  if (achado) it.tipo = achado;
  else { it.tipo = 'Outro'; it.tipoOutro = desc.slice(0, 40) || 'Item da O.S.'; }
  it.detalheServico = desc;
  it.osNum = osItem.osNum || ''; // de qual O.S. veio (o aviso usa isto)
  it.quantidade = String(osItem.qtde || '1').trim() || '1';
  const m = String(osItem.medidas || '').match(/([\d.,]+)\s*[xX×]\s*([\d.,]+)/);
  if (m) {
    // Metros → centímetros com 1 casa: 0,905 m tem de virar 90,5 cm, não 91.
    const cm = v => { const n = Math.round(numBr(v) * 1000) / 10; return n > 0 ? String(n).replace('.', ',') : ''; };
    const larg = cm(m[1]), alt = cm(m[2]);
    if (larg || alt) it.medidas = [{ largura: larg, altura: alt }];
  }
  it.origemOS = true;
  it.osKey = (osItem.descricao || '') + '|' + (osItem.medidas || ''); // liga o item à linha da O.S.
  return it;
}

function htmlEtapa5() {
  const o = BRIEF.obsGerais;
  const chip = (marcado, attr, valor, rotulo) =>
    '<button class="chip ' + (marcado ? 'marcado' : '') + '" data-' + attr + '="' + esc(valor) + '">' + esc(rotulo || valor) + '</button>';
  return (
    '<section class="etapa" data-etapa="5"><div class="card">' +
    '<div class="sub-secao">' + (souMedidor() ? 'Observações gerais' : 'Etapa 5 · Observações gerais') + '</div>' +

    '<div class="campo"><label>Tem ponto de energia próximo?</label>' +
    '<div class="opcoes duas">' +
    '<div class="opcao ' + (o.energia === 'sim' ? 'marcada' : '') + '" data-energia="sim">Sim</div>' +
    '<div class="opcao ' + (o.energia === 'nao' ? 'marcada' : '') + '" data-energia="nao">Não</div></div>' +
    (o.energia === 'sim'
      ? '<div class="linha-2" style="margin-top:10px">' +
        '<div class="campo" style="margin:0"><label>Onde?</label><input type="text" id="o-energiaonde" value="' + esc(o.energiaOnde) + '"></div>' +
        '<div class="campo" style="margin:0"><label>Voltagem</label><select id="o-voltagem"><option value="">Não sei</option>' +
        ['127v', '220v'].map(v => '<option ' + (o.voltagem === v ? 'selected' : '') + '>' + v + '</option>').join('') + '</select></div></div>'
      : '') +
    '</div>' +

    '<div class="campo"><label>Obstáculos no local</label><div class="chips">' +
    OBSTACULOS.map(x => chip((o.obstaculos || []).includes(x), 'obstaculo', x)).join('') + '</div>' +
    ((o.obstaculos || []).includes('Outro') ? '<div class="campo" style="margin-top:10px"><label>Qual obstáculo?</label><input type="text" id="o-obstoutro" value="' + esc(o.obstaculoOutro) + '"></div>' : '') +
    '</div>' +

    '<div class="campo"><label>Precisa de equipamento pra instalar?</label>' +
    '<div class="chips">' +
    ['Não precisa', 'Escada', 'Andaime', 'Munk'].map(x => chip(o.equipamento === x, 'equipamento', x)).join('') +
    '</div>' +
    (o.equipamento === 'Escada'
      ? '<div class="campo" style="margin-top:10px"><label>Porte da escada</label><select id="o-equipdetalhe"><option value="">Escolher…</option>' +
        ['Pequena', 'Média', 'Grande'].map(v => '<option ' + (o.equipamentoDetalhe === v ? 'selected' : '') + '>' + v + '</option>').join('') + '</select></div>'
      : '') +
    (o.equipamento === 'Andaime' || o.equipamento === 'Munk'
      ? '<div class="campo" style="margin-top:10px"><label>' + (o.equipamento === 'Andaime' ? 'Altura e base (sapata ou rodinha)' : 'Detalhe do munk (altura, acesso)') + '</label>' +
        '<input type="text" id="o-equipdetalhe-txt" value="' + esc(o.equipamentoDetalhe) + '"></div>'
      : '') +
    '</div>' +

    '<div class="campo"><label>Ponto</label><div class="opcoes duas">' +
    '<div class="opcao ' + (o.pontoTipo === 'Ponto novo' ? 'marcada' : '') + '" data-ponto="Ponto novo">Ponto novo</div>' +
    '<div class="opcao ' + (o.pontoTipo === 'Ponto antigo' ? 'marcada' : '') + '" data-ponto="Ponto antigo">Ponto antigo</div></div></div>' +

    '<div class="campo"><label>Serviços extras (da ficha de visita)</label><div class="chips">' +
    SERVICOS_EXTRAS.map(x => chip((o.servicosExtras || []).includes(x), 'servico', x)).join('') + '</div></div>' +

    '<div class="campo"><label>Prazo desejado pelo cliente</label><input type="text" id="o-prazo" placeholder="Ex: até 15/08, antes da inauguração" value="' + esc(o.prazo) + '"></div>' +

    '<div class="campo"><label>Briefing do cliente (o que ele contou, referências, expectativa)</label>' +
    '<textarea id="o-briefcliente" rows="3">' + esc(o.briefingCliente) + '</textarea></div>' +

    '<div class="linha-2">' +
    '<div class="campo"><label>Equipe estimada pra instalação</label><input type="text" inputmode="numeric" id="o-equipe" placeholder="Nº de pessoas" value="' + esc(o.equipeInstalacao) + '"></div>' +
    '<div class="campo"><label>Tempo estimado de execução</label><input type="text" id="o-tempo" placeholder="Ex: meio dia, 2 dias" value="' + esc(o.tempoExecucao) + '"></div>' +
    '</div>' +
    '</div></section>'
  );
}

function htmlEtapa6() {
  const p = pendencias(BRIEF);
  const semOS = !String(BRIEF.osNumero || '').trim();
  return (
    '<section class="etapa" data-etapa="6"><div class="card">' +
    '<div class="sub-secao">' + (souMedidor() ? 'Fechar a visita' : 'Etapa 6 · Revisão e envio') + '</div>' +
    '<dl>' +
    '<div class="dupla-dado"><dt>Número do brief</dt><dd>' + esc(rotuloBrief(BRIEF)) + '</dd></div>' +
    '<div class="dupla-dado"><dt>Cliente</dt><dd>' + esc(BRIEF.cliente || '') + '</dd></div>' +
    '<div class="dupla-dado"><dt>Telefone</dt><dd>' + esc(BRIEF.telefone || '') + '</dd></div>' +
    '<div class="dupla-dado"><dt>Tipo de medição</dt><dd>' + esc(BRIEF.tipoMedicao || '') + (BRIEF.urgente ? ' · <b style="color:var(--perigo)">🔴 URGENTE</b>' : '') + '</dd></div>' +
    '<div class="dupla-dado"><dt>O.S.</dt><dd>' + (semOS ? 'Sem O.S. por enquanto' : esc(BRIEF.osNumero)) + '</dd></div>' +
    '<div class="dupla-dado"><dt>Local</dt><dd>' + esc(BRIEF.endereco || 'não informado') + '</dd></div>' +
    '<div class="dupla-dado"><dt>Quem mediu</dt><dd>' + esc(BRIEF.quemMediu || '') + '</dd></div>' +
    '<div class="dupla-dado"><dt>Data da medida</dt><dd>' + esc(fmtData(BRIEF.dataMedicao || BRIEF.dataHora)) + '</dd></div>' +
    '<div class="dupla-dado"><dt>Visita concluída</dt><dd>' +
    (BRIEF.visitaConcluida ? esc(BRIEF.visitaConcluida.por) + ' · ' + fmtDataHora(BRIEF.visitaConcluida.em) : 'ainda não') + '</dd></div>' +
    '</dl>' +
    '<div style="margin-top:12px">' +
    BRIEF.itens.map((it, i) =>
      '<div class="resumo-item"><b class="fonte-titulo">Item ' + (i + 1) + ': ' + esc(nomeItem(it) || 'sem nome') + '</b>' +
      '<div class="dica-campo">' + (it.medidas || []).map(m => esc(m.largura || '?') + '×' + esc(m.altura || '?') + ' cm').join(' · ') +
      (areaItem(it) > 0 ? ' · ' + fmtM2(areaItem(it)) : '') +
      (it.superficies && it.superficies.length ? ' · ' + esc(it.superficies.join(', ')) : '') + '</div>' +
      '<div class="mini-thumbs">' + (it.fotos || []).filter(f => !f.arquivada).map(f => '<img data-foto-id="' + esc(f.id) + '" alt="">').join('') + '</div>' +
      '</div>'
    ).join('') +
    (BRIEF.croquis.length
      ? '<div class="resumo-item"><b class="fonte-titulo">Desenhos da visita</b><div class="mini-thumbs">' +
        BRIEF.croquis.map(c => '<img data-foto-id="' + esc(c.id) + '" alt="">').join('') + '</div></div>'
      : '') +
    '</div>' +
    (semOS ? '<div class="aviso amarelo">Este briefing vai SEM número de O.S. Dá pra vincular depois, não trava o envio.</div>' : '') +
    (BRIEF.tipoMedicao === 'Execução' ? '<div class="aviso vermelho">Medição de EXECUÇÃO: estas medidas vão pra produção. Confira duas vezes.</div>' : '') +
    (p.length
      ? '<div class="aviso vermelho" style="font-weight:400"><b>Falta resolver' +
        (souMedidor() ? ' na medição' : ' antes de enviar') + ':</b>' +
        '<div class="pendencias">' + p.map((x, i) =>
          '<button class="pend-atalho" data-pend="' + i + '" data-etapa="' + x.etapa + '"' +
          (x.itemId ? ' data-item="' + esc(x.itemId) + '"' : '') + '>' +
          '<span>' + esc(x.texto) + '</span><span class="ir">Ir →</span></button>').join('') + '</div></div>'
      : souMedidor() ? '' : '<div class="aviso verde">Tudo certo pra enviar.</div>') +
    // O briefing é do comercial: ele abriu, ele conhece o combinado com o
    // cliente e é ele que decide quando o design assume. O medidor entrega a
    // medição e sai — se ele enviasse, mandaria pro design um briefing cujas
    // etapas 1 a 3 ele nem enxerga; se ele descartasse, jogaria fora trabalho
    // de outra pessoa (recuperável na lixeira, mas o comercial só descobre
    // quando o cliente cobra).
    (souMedidor()
      ? (BRIEF.visitaConcluida
          ? '<div class="aviso verde">Medição entregue ✓ O comercial recebe e envia pro design. ' +
            'Se lembrar de algo, dá pra reabrir e completar até ele enviar.</div>'
          : '<div class="aviso amarelo">Quando terminar, marque <b>Visita concluída</b> na etapa 1. ' +
            'O comercial só vê que a medição ficou pronta depois disso.</div>') +
        '<a class="botao largo" href="#/agenda">📍 Voltar pras minhas visitas</a>'
      // O botão NUNCA fica só apagado sem resposta: quando falta algo, ele leva
      // ao primeiro pendente em vez de não fazer nada ao toque.
      : '<button class="botao largo" id="btn-enviar">📨 Enviar pro design</button>' +
        '<button class="botao largo fantasma" id="btn-descartar" style="margin-top:10px">Descartar rascunho</button>') +
    '</div></section>'
  );
}

function ligarEditor(cfg) {
  // Navegação
  $$('.sidebar-etapas a[data-etapa]').forEach(a => a.onclick = e => {
    e.preventDefault();
    const alvo = $('.etapa[data-etapa="' + a.dataset.etapa + '"]');
    if (ehDesktop() && alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else mudarEtapa(Number(a.dataset.etapa));
  });
  const bv = $('#btn-voltar'); if (bv) bv.onclick = () => mudarEtapa(ETAPA - 1);
  const ba = $('#btn-avancar'); if (ba) ba.onclick = () => mudarEtapa(ETAPA + 1);

  // Etapa 2
  const bind = (sel, campo, transf) => {
    const el = $(sel); if (!el) return;
    el.oninput = () => { BRIEF[campo] = transf ? transf(el.value, el) : el.value; salvarRascunho(); };
  };
  // No desktop as etapas ficam todas na tela: ao completar os dados do cliente,
  // a etapa 4 precisa destravar na hora (sem isso, o cadeado ficava lá parado).
  const travaAntes = faltaCliente(BRIEF).length > 0;
  const redesenharSeDestravou = () => {
    if (travaAntes && !faltaCliente(BRIEF).length) renderApp();
  };
  const cli = $('#c-cliente');
  if (cli) cli.oninput = () => { BRIEF.cliente = cli.value; salvarRascunho(); redesenharSeDestravou(); };
  bind('#c-responsavel', 'responsavel');
  const tel = $('#c-telefone');
  if (tel) tel.oninput = () => {
    tel.value = mascaraTel(tel.value); BRIEF.telefone = tel.value;
    salvarRascunho(); redesenharSeDestravou();
  };
  // Data e hora digitadas só com números. A hora só é aplicada quando está
  // completa: sem isso, cada tecla no campo Hora ("1", "10"…) fazia a data ser
  // gravada à meia-noite e a hora do vendedor se perdia.
  const cData = $('#c-data'), cHora = $('#c-hora');
  const avisar = (campo, invalida) => {
    const alvo = $('#aviso-' + campo);
    if (alvo) alvo.textContent = invalida ? 'Data inválida, confira' : '';
  };
  const aplicarDataHora = () => {
    if (!cData) return;
    const completa = /^\d{2}\/\d{2}\/\d{4}$/.test(cData.value);
    if (!completa) { avisar('data', false); return; }
    const horaDigitada = cHora ? cHora.value : '';
    const hora = /^\d{1,2}:\d{2}$/.test(horaDigitada) ? horaDigitada : isoParaHoraBr(BRIEF.dataHora);
    const iso = dataBrParaISO(cData.value, hora);
    avisar('data', !iso);
    if (iso) { BRIEF.dataHora = iso; salvarRascunho(); }
  };
  if (cData) cData.oninput = () => { cData.value = mascaraData(cData.value); aplicarDataHora(); };
  if (cHora) cHora.oninput = () => { cHora.value = mascaraHora(cHora.value); aplicarDataHora(); };
  const cMed = $('#c-datamedicao');
  if (cMed) cMed.oninput = () => {
    cMed.value = mascaraData(cMed.value);
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(cMed.value)) { avisar('medida', false); return; }
    const iso = dataBrParaISO(cMed.value, '12:00');
    avisar('medida', !iso);
    if (iso) { BRIEF.dataMedicao = iso; salvarRascunho(); }
  };
  const nat = $('#c-natureza'); if (nat) nat.onchange = () => { BRIEF.naturezaServico = nat.value; salvarRascunho(); };
  $$('[data-ambiente]').forEach(ch => ch.onclick = () => {
    const v = ch.dataset.ambiente;
    if (!Array.isArray(BRIEF.ambientes)) BRIEF.ambientes = ambientesDe(BRIEF); // migra o formato antigo
    const arr = BRIEF.ambientes;
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
    salvarRascunho(true); renderApp();
  });
  bind('#c-quemmediu', 'quemMediu');
  const osn = $('#c-osnumero');
  if (osn) osn.oninput = () => {
    const novo = osn.value.trim();
    // Mudou o número: o serviço da O.S. antiga não vale mais. Antes ele ficava
    // colado e saía errado na ficha e no PDF.
    if (novo !== BRIEF.osNumero) {
      BRIEF.osServico = ''; BRIEF.osOrigem = '';
      // Os itens ainda não importados vieram da O.S. ANTERIOR: sob o número
      // novo eles apareceriam misturados, pré-marcados pra importar. Os já
      // importados ficam (viraram itens do briefing de verdade).
      BRIEF.osItens = (BRIEF.osItens || []).filter(x => x.importado);
      BRIEF.osItensDe = '';
    }
    BRIEF.osNumero = novo;
    if (BRIEF.osNumero) BRIEF.semOS = false;
    salvarRascunho();
  };
  const chipSem = $('#chip-semos');
  if (chipSem) chipSem.onclick = () => {
    BRIEF.semOS = !BRIEF.semOS;
    if (BRIEF.semOS) { BRIEF.osNumero = ''; }
    salvarRascunho(true); renderApp();
  };
  const btnBuscar = $('#btn-buscar-os');
  if (btnBuscar) btnBuscar.onclick = () => buscarOS(btnBuscar);
  $$('[data-tipomed]').forEach(op => op.onclick = () => {
    BRIEF.tipoMedicao = op.dataset.tipomed;
    salvarRascunho(true); renderApp();
  });
  const urg = $('#c-urgente');
  if (urg) urg.onclick = () => {
    BRIEF.urgente = !BRIEF.urgente;
    urg.classList.toggle('marcado', BRIEF.urgente);
    salvarRascunho();
  };

  // Etapa 3
  bind('#c-endereco', 'endereco');
  bind('#c-estab', 'estabelecimento');
  bind('#c-ref', 'pontoReferencia');
  const gps = $('#btn-gps'); if (gps) gps.onclick = usarLocalizacao;
  const btMed = $('#btn-medidor');
  if (btMed) btMed.onclick = () => abrirEscolhaMedidor(BRIEF.medidorAtribuido, (u) => {
    BRIEF.medidorAtribuido = u ? { usuario: u.usuario, nome: u.nome, em: new Date().toISOString(), por: SESSAO.nome } : null;
    // "Quem mediu" nasce com o nome do vendedor (etapa 2). Direcionar a visita
    // pra outra pessoa e deixar esse campo parado faz o PDF que vai pro design
    // dizer que o comercial mediu — o designer liga pra pessoa errada quando
    // tem dúvida na cota. Só mexe se ainda estiver com o valor padrão: se o
    // vendedor digitou um nome à mão, ele mandou.
    const padrao = !BRIEF.quemMediu || norm(BRIEF.quemMediu) === norm(BRIEF.vendedor || '') ||
      (BRIEF.medidorAnterior && norm(BRIEF.quemMediu) === norm(BRIEF.medidorAnterior));
    if (padrao) BRIEF.quemMediu = u ? u.nome : (BRIEF.vendedor || '');
    BRIEF.medidorAnterior = u ? u.nome : '';
    salvarRascunho(true);
    renderApp();
    toast(u ? 'Visita direcionada para ' + u.nome + ' ✓' : 'Direcionamento removido', 'sucesso');
  });
  const ficha = $('#btn-ficha-visita'); if (ficha) ficha.onclick = () => exportarFichaVisita(BRIEF);

  // Etapa 4
  $$('[data-tipomed4]').forEach(op => op.onclick = () => {
    BRIEF.tipoMedicao = op.dataset.tipomed4;
    salvarRascunho(true);
    renderApp();
    toast('Tipo de medição: ' + BRIEF.tipoMedicao + ' ✓', 'sucesso');
  });
  const irE2 = $('#btn-ir-etapa2');
  if (irE2) irE2.onclick = () => {
    if (ehDesktop()) { const alvo = $('.etapa[data-etapa="2"]'); if (alvo) alvo.scrollIntoView({ behavior: 'smooth' }); }
    else mudarEtapa(2);
  };
  const badd = $('#btn-add-item');
  if (badd) badd.onclick = () => {
    const novo = novoItem();
    BRIEF.itens.push(novo);
    ITENS_RECOLHIDOS.delete(novo.id); // item novo nasce aberto
    salvarRascunho(true); renderApp();
  };
  const bman = $('#btn-manual-4'); if (bman) bman.onclick = () => abrirManual();

  // Recolher/expandir: mexe só na classe do card. Redesenhar a tela inteira aqui
  // faria a página pular pro topo, recarregar as fotos e atropelar o que o
  // vendedor estivesse digitando.
  const pintarCard = (cardEl, id) => {
    const recolhido = ITENS_RECOLHIDOS.has(id);
    cardEl.classList.toggle('recolhido', recolhido);
    const bt = $('[data-alternar]', cardEl);
    if (bt) {
      bt.setAttribute('aria-expanded', String(!recolhido));
      const seta = $('.seta', bt);
      if (seta) seta.textContent = recolhido ? '▸' : '▾';
    }
  };
  $$('[data-alternar]').forEach(bt => bt.onclick = () => {
    const id = bt.dataset.alternar;
    if (ITENS_RECOLHIDOS.has(id)) ITENS_RECOLHIDOS.delete(id); else ITENS_RECOLHIDOS.add(id);
    const cardEl = bt.closest('.card-item');
    if (cardEl) pintarCard(cardEl, id);
    atualizarRotuloRecolher();
  });
  function atualizarRotuloRecolher() {
    const bt = $('#btn-recolher-todos');
    if (!bt) return;
    const todos = BRIEF.itens.length && BRIEF.itens.every(i => ITENS_RECOLHIDOS.has(i.id));
    bt.textContent = todos ? 'Expandir todos' : 'Recolher todos';
  }
  const recolherTodos = $('#btn-recolher-todos');
  if (recolherTodos) {
    atualizarRotuloRecolher();
    recolherTodos.onclick = () => {
      const todosRecolhidos = BRIEF.itens.every(i => ITENS_RECOLHIDOS.has(i.id));
      BRIEF.itens.forEach(i => { if (todosRecolhidos) ITENS_RECOLHIDOS.delete(i.id); else ITENS_RECOLHIDOS.add(i.id); });
      $$('.card-item').forEach(el => pintarCard(el, el.dataset.item));
      atualizarRotuloRecolher();
    };
  }

  // Itens vindos da O.S.
  $$('#painel-os-itens input[type="checkbox"]').forEach(cb => cb.onchange = () => {
    const i = Number(cb.dataset.osidx);
    if (cb.checked) OS_ITENS_DESMARCADOS.delete(i); else OS_ITENS_DESMARCADOS.add(i);
  });
  const btnImportar = $('#btn-importar-os');
  if (btnImportar) btnImportar.onclick = () => {
    const marcados = $$('#painel-os-itens input[type="checkbox"]').filter(c => c.checked).map(c => Number(c.dataset.osidx));
    if (!marcados.length) { toast('Marque pelo menos um item', 'erro'); return; }
    let trazidos = 0;
    marcados.forEach(i => {
      const osIt = (BRIEF.osItens || [])[i];
      if (!osIt || osIt.importado) return;
      BRIEF.itens.push(itemDaOS(osIt, cfg));
      osIt.importado = true;
      trazidos++;
    });
    OS_ITENS_DESMARCADOS.clear();
    salvarRascunho(true); renderApp();
    toast(trazidos + ' item(ns) trazidos da O.S. Confira as medidas no local.', 'sucesso');
  };
  const btnDescartar = $('#btn-descartar-os');
  if (btnDescartar) btnDescartar.onclick = () => confirmar('Não usar os itens da O.S.',
    'A lista some desta tela. Você pode trazê-la de volta buscando a O.S. de novo na etapa 2.', 'Não usar', () => {
      (BRIEF.osItens || []).forEach(x => { x.importado = true; });
      salvarRascunho(true); renderApp();
    });

  // Visita concluída: nome de quem fechou + carimbo automático de data e hora
  const btnConcluir = $('#btn-concluir-visita');
  if (btnConcluir) btnConcluir.onclick = () => abrirConcluirVisita();
  const btnReabrir = $('#btn-reabrir-visita');
  if (btnReabrir) btnReabrir.onclick = () => {
    const idNaHora = BRIEF.id;
    confirmar('Reabrir visita',
      'A marcação de conclusão será apagada e o envio volta a ficar bloqueado.', 'Reabrir', () => {
        // O modal sobrevive à troca de tela: confere se ainda é o mesmo briefing
        if (!BRIEF || BRIEF.id !== idNaHora) return;
        if (BRIEF.situacao === 'enviado') { toast('Briefing já enviado, não dá pra reabrir a visita', 'erro'); return; }
        BRIEF.visitaConcluida = null;
        salvarRascunho(true); renderApp();
      });
  };

  $$('.card-item').forEach(cardEl => ligarItem(cardEl, cfg));
  const btnCroqui = $('#btn-add-croqui');
  const inputCroqui = $('#input-croqui');
  if (btnCroqui && inputCroqui) {
    btnCroqui.onclick = () => inputCroqui.click();
    inputCroqui.onchange = () => {
      if (inputCroqui.files && inputCroqui.files[0]) anexarFoto(inputCroqui.files[0], BRIEF.id, '@croqui', 'croqui');
      inputCroqui.value = '';
    };
  }
  $$('[data-remover-croqui]').forEach(bt => bt.onclick = () => {
    const i = Number(bt.dataset.removerCroqui);
    confirmar('Remover desenho', 'Remover este desenho do briefing?', 'Remover', () => {
      const c = BRIEF.croquis[i];
      if (c) STORE.delFotoSync(c.id);
      BRIEF.croquis.splice(i, 1);
      salvarRascunho(true); renderApp();
    }, true);
  });

  // Etapa 5
  $$('[data-energia]').forEach(op => op.onclick = () => { BRIEF.obsGerais.energia = op.dataset.energia; salvarRascunho(true); renderApp(); });
  const eo = $('#o-energiaonde'); if (eo) eo.oninput = () => { BRIEF.obsGerais.energiaOnde = eo.value; salvarRascunho(); };
  const vo = $('#o-voltagem'); if (vo) vo.onchange = () => { BRIEF.obsGerais.voltagem = vo.value; salvarRascunho(); };
  $$('[data-obstaculo]').forEach(ch => ch.onclick = () => {
    const v = ch.dataset.obstaculo;
    const arr = BRIEF.obsGerais.obstaculos || (BRIEF.obsGerais.obstaculos = []);
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
    salvarRascunho(true); renderApp();
  });
  const oo = $('#o-obstoutro'); if (oo) oo.oninput = () => { BRIEF.obsGerais.obstaculoOutro = oo.value; salvarRascunho(); };
  $$('[data-equipamento]').forEach(ch => ch.onclick = () => {
    BRIEF.obsGerais.equipamento = ch.dataset.equipamento;
    BRIEF.obsGerais.equipamentoDetalhe = '';
    salvarRascunho(true); renderApp();
  });
  const ed = $('#o-equipdetalhe'); if (ed) ed.onchange = () => { BRIEF.obsGerais.equipamentoDetalhe = ed.value; salvarRascunho(); };
  const edt = $('#o-equipdetalhe-txt'); if (edt) edt.oninput = () => { BRIEF.obsGerais.equipamentoDetalhe = edt.value; salvarRascunho(); };
  $$('[data-ponto]').forEach(op => op.onclick = () => {
    BRIEF.obsGerais.pontoTipo = BRIEF.obsGerais.pontoTipo === op.dataset.ponto ? '' : op.dataset.ponto;
    salvarRascunho(true); renderApp();
  });
  $$('[data-servico]').forEach(ch => ch.onclick = () => {
    const v = ch.dataset.servico;
    const arr = BRIEF.obsGerais.servicosExtras || (BRIEF.obsGerais.servicosExtras = []);
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
    salvarRascunho(true); renderApp();
  });
  [['#o-prazo', 'prazo'], ['#o-briefcliente', 'briefingCliente'], ['#o-equipe', 'equipeInstalacao'], ['#o-tempo', 'tempoExecucao']].forEach(([sel, campo]) => {
    const el = $(sel); if (el) el.oninput = () => { BRIEF.obsGerais[campo] = el.value; salvarRascunho(); };
  });

  // Etapa 6
  const be = $('#btn-enviar');
  if (be) be.onclick = enviarBriefing;
  // Cada pendência leva à etapa (e ao item) que falta, em vez de ser só texto.
  $$('.pend-atalho').forEach(bt => bt.onclick = () => {
    const etapa = Number(bt.dataset.etapa), itemId = bt.dataset.item;
    if (itemId) ITENS_RECOLHIDOS.delete(itemId); // abre o item pra ele aparecer
    ETAPA = etapa;
    _ultimaEtapaRender = 0; // força subir/rolar no próximo desenho
    renderApp();
    if (itemId) setTimeout(() => {
      const alvo = $('[data-item="' + (window.CSS && CSS.escape ? CSS.escape(itemId) : itemId) + '"]');
      if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  });
  const bd = $('#btn-descartar');
  if (bd) bd.onclick = () => confirmar('Descartar rascunho',
    'O rascunho vai pra lixeira do admin e some da sua lista. Dá pra recuperar em até 30 dias.', 'Descartar', () => {
      BRIEF.apagadoEm = new Date().toISOString();
      BRIEF.apagadoPor = SESSAO.nome;
      salvarRascunho(true);
      BRIEF = null;
      location.hash = '#/lista';
    }, true);

  // Manuais contextuais
  $$('[data-manual]').forEach(bt => bt.onclick = e => { e.preventDefault(); abrirManual(bt.dataset.manual === 'foto' ? 'foto' : 'medir'); });
}

function ligarItem(cardEl, cfg) {
  const itemId = cardEl.dataset.item;
  const item = BRIEF.itens.find(i => i.id === itemId);
  if (!item) return;

  $$('[data-icampo]', cardEl).forEach(inp => {
    const campo = inp.dataset.icampo;
    const evento = inp.tagName === 'SELECT' ? 'onchange' : 'oninput';
    inp[evento === 'onchange' ? 'onchange' : 'oninput'] = () => {
      item[campo] = inp.value;
      if (campo === 'tipo') { salvarRascunho(true); renderApp(); return; }
      salvarRascunho();
    };
  });

  $$('[data-medida]', cardEl).forEach(inp => {
    inp.oninput = () => {
      const par = item.medidas[Number(inp.dataset.par)];
      if (!par) return;
      par[inp.dataset.medida] = inp.value;
      const area = areaItem(item);
      const alvo = $('[data-area-item]', cardEl);
      if (alvo) alvo.textContent = area > 0
        ? 'Área: ' + fmtM2(area) + (item.medidas.length > 1 ? ' (soma de ' + item.medidas.length + ' pontos)' : '')
        : 'Área calculada automática';
      salvarRascunho();
    };
  });
  const addPar = $('[data-add-par]', cardEl);
  if (addPar) addPar.onclick = () => { item.medidas.push({ largura: '', altura: '' }); salvarRascunho(true); renderApp(); };
  $$('[data-remover-par]', cardEl).forEach(bt => bt.onclick = () => {
    const i = Number(bt.dataset.removerPar);
    const par = item.medidas[i] || {};
    const remover = () => { item.medidas.splice(i, 1); salvarRascunho(true); renderApp(); };
    // So confirma quando ha medida escrita (polegar encosta no ✕ ao corrigir a
    // altura). Ponto vazio some direto -- pedir confirmacao ali so atrapalha.
    if (String(par.largura || '').trim() || String(par.altura || '').trim()) {
      confirmar('Apagar este ponto?',
        'Vai remover a medida <b>' + esc((par.largura || '?') + ' × ' + (par.altura || '?') + ' cm') + '</b>. Não dá pra desfazer.',
        'Apagar', remover, true);
    } else remover();
  });

  $$('[data-superficie]', cardEl).forEach(ch => ch.onclick = () => {
    const v = ch.dataset.superficie;
    const arr = item.superficies || (item.superficies = []);
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
    salvarRascunho(true); renderApp();
  });

  const remover = $('[data-remover-item]', cardEl);
  if (remover) remover.onclick = () => confirmar('Remover item',
    'Remover este item e as fotos dele do briefing?', 'Remover', () => {
      (item.fotos || []).forEach(f => STORE.delFotoSync(f.id));
      // Se veio da O.S., devolve a linha para a lista (dá pra trazer de novo)
      if (item.osKey) {
        const osIt = (BRIEF.osItens || []).find(x => (x.descricao || '') + '|' + (x.medidas || '') === item.osKey);
        if (osIt) osIt.importado = false;
      }
      ITENS_RECOLHIDOS.delete(itemId);
      BRIEF.itens = BRIEF.itens.filter(i => i.id !== itemId);
      salvarRascunho(true); renderApp();
    }, true);

  FOTOS_ITEM.forEach(def => {
    const input = $('[data-input-foto="' + def.tipo + '"]', cardEl);
    const tirar = $('[data-tirar-foto="' + def.tipo + '"]', cardEl);
    const trocar = $('[data-trocar-foto="' + def.tipo + '"]', cardEl);
    const rem = $('[data-remover-foto="' + def.tipo + '"]', cardEl);
    if (input) input.onchange = () => {
      if (input.files && input.files[0]) anexarFoto(input.files[0], BRIEF.id, itemId, def.tipo);
      input.value = '';
    };
    if (tirar) tirar.onclick = () => input && input.click();
    if (trocar) trocar.onclick = () => input && input.click();
    if (rem) rem.onclick = () => confirmar('Remover foto', 'Remover a foto "' + def.rotulo + '"?', 'Remover', () => {
      const i = (item.fotos || []).findIndex(f => f.tipo === def.tipo && !f.arquivada);
      if (i >= 0) { STORE.delFotoSync(item.fotos[i].id); item.fotos.splice(i, 1); salvarRascunho(true); renderApp(); }
    }, true);
  });
}

// Regra do kit: captura a referência do draft ANTES do await e revalida depois
// (upload lento × usuário fechando a tela).
async function anexarFoto(file, briefId, itemId, tipoFoto) {
  toast('Comprimindo e salvando a foto…');
  const fileId = await STORE.pushPhoto(file);
  if (!fileId) { toast('Não consegui ler essa foto. Tente de novo.', 'erro'); return; }
  if (!BRIEF || BRIEF.id !== briefId) return; // a tela mudou durante o upload
  const salva = await STORE.getFoto(fileId);
  const bytes = salva && salva.base64 ? Math.round(salva.base64.length * 0.75) : 0;
  if (itemId === '@croqui') {
    BRIEF.croquis.push({ id: fileId, bytes });
  } else {
    const item = BRIEF.itens.find(i => i.id === itemId);
    if (!item) return;
    const jaTem = (item.fotos || []).findIndex(f => f.tipo === tipoFoto && !f.arquivada);
    if (jaTem >= 0) { STORE.delFotoSync(item.fotos[jaTem].id); item.fotos.splice(jaTem, 1); }
    item.fotos.push({ id: fileId, tipo: tipoFoto, bytes });
  }
  salvarRascunho(true);
  renderApp();
}

function carregarThumbs() {
  $$('img[data-foto-id]').forEach(async img => {
    const b64 = await STORE.pullPhoto(img.dataset.fotoId);
    if (b64) img.src = b64;
    if (!img._ligadoLightbox) {
      img._ligadoLightbox = true;
      img.style.cursor = 'zoom-in';
      img.onclick = () => abrirLightbox([{ id: img.dataset.fotoId, legenda: img.alt || 'Foto' }], 0);
    }
  });
}

function usarLocalizacao() {
  const status = $('#gps-status');
  if (!navigator.geolocation) { toast('Este aparelho não liberou o GPS', 'erro'); return; }
  if (status) status.textContent = 'Pegando sua localização…';
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude, longitude } = pos.coords;
    BRIEF.geo = { lat: latitude, lng: longitude };
    let endereco = '';
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=pt-BR&lat=' + latitude + '&lon=' + longitude, { signal: ctrl.signal });
      clearTimeout(timer);
      const d = await r.json();
      if (d && d.address) {
        const a = d.address;
        endereco = [
          [a.road, a.house_number].filter(Boolean).join(', '),
          a.suburb || a.neighbourhood,
          a.city || a.town || a.village,
          a.postcode ? 'CEP ' + a.postcode : ''
        ].filter(Boolean).join(' - ');
      }
      if (!endereco && d && d.display_name) endereco = d.display_name;
    } catch {}
    if (!endereco) endereco = 'Lat ' + latitude.toFixed(6) + ', Long ' + longitude.toFixed(6) + ' (sem internet pro endereço, complete a mão)';
    BRIEF.endereco = endereco;
    const campo = $('#c-endereco');
    if (campo) campo.value = endereco;
    if (status) status.textContent = 'Localização preenchida ✓';
    salvarRascunho(true);
  }, err => {
    if (status) status.textContent = '';
    toast('Não consegui a localização: ' + (err && err.message ? err.message : 'sem permissão'), 'erro');
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}

async function buscarOS(botao) {
  const numero = String(BRIEF.osNumero || '').trim();
  const alvo = $('#os-resultado');
  if (!numero) { if (alvo) alvo.innerHTML = '<div class="aviso amarelo">Digite o número da O.S. primeiro, ou marque "Sem O.S. por enquanto".</div>'; return; }
  botao.disabled = true; botao.textContent = 'Buscando…';
  try {
    const res = await STORE.apiFn('mubisys', { action: 'buscarOS', numero });
    if (res && res.encontrado && res.os) {
      const os = res.os;
      if (!BRIEF.cliente && os.cliente) BRIEF.cliente = os.cliente;
      if (!BRIEF.responsavel && os.contato && os.contato !== os.cliente) BRIEF.responsavel = os.contato;
      if (!BRIEF.telefone && os.telefone) BRIEF.telefone = mascaraTel(os.telefone);
      if (!BRIEF.endereco && os.endereco) BRIEF.endereco = os.endereco;
      BRIEF.osOrigem = res.origem;
      BRIEF.osServico = os.servico || '';
      BRIEF.semOS = false;
      // O.S. no nome de OUTRO cliente: acontece na correria (número trocado,
      // O.S. antiga do mesmo endereço). Não bloqueia -- às vezes é filial ou
      // razão social diferente -- mas avisa em cima, senão a prancha e o PDF
      // saem no nome errado e ninguém percebe até a fábrica.
      BRIEF._avisoClienteOS = '';
      if (BRIEF.cliente && os.cliente) {
        const tok = t => norm(t).split(/[^a-z0-9]+/).filter(x => x.length > 2);
        const meus = new Set(tok(BRIEF.cliente));
        const daOS = tok(os.cliente);
        if (daOS.length && !daOS.some(x => meus.has(x))) {
          BRIEF._avisoClienteOS = os.cliente;
        }
      }
      // Itens da O.S. ficam disponíveis pra trazer pro briefing na etapa 4
      const itensOS = Array.isArray(os.itens) ? os.itens : [];
      // Buscou uma O.S. DIFERENTE da que trouxe os pendentes atuais? Eles são
      // do trabalho anterior: só os já importados sobrevivem.
      if (BRIEF.osItensDe && BRIEF.osItensDe !== numero) {
        BRIEF.osItens = (BRIEF.osItens || []).filter(x => x.importado);
      }
      if (itensOS.length) {
        const jaTem = new Set((BRIEF.osItens || []).map(x => x.descricao + '|' + x.medidas));
        BRIEF.osItens = (BRIEF.osItens || []).concat(
          itensOS.filter(x => !jaTem.has((x.descricao || '') + '|' + (x.medidas || '')))
                 .map(x => ({ descricao: x.descricao || '', medidas: x.medidas || '', qtde: x.qtde || '1', importado: false, osNum: numero }))
        );
      }
      BRIEF.osItensDe = numero;
      salvarRascunho(true);
      toast(itensOS.length
        ? 'O.S. encontrada ✓ ' + itensOS.length + ' item(ns) prontos pra trazer na etapa 4'
        : 'O.S. encontrada, dados preenchidos ✓', 'sucesso');
      renderApp();
    } else {
      if (alvo) alvo.innerHTML = '<div class="aviso amarelo">O.S. não encontrada' +
        (res && res.fontes && !res.fontes.mubisys && !res.fontes.pcp ? ' (integração ainda não configurada)' : '') +
        '. Digite os dados do cliente manualmente, o briefing segue normal.</div>';
      BRIEF.osOrigem = '';
      salvarRascunho();
    }
  } catch {
    if (alvo) alvo.innerHTML = '<div class="aviso amarelo">Sem conexão agora. Digite os dados manualmente, dá pra vincular a O.S. depois.</div>';
  } finally {
    botao.disabled = false; botao.textContent = 'Buscar';
  }
}

// Fecho da visita: confirma quem concluiu; a data e a hora são do relógio,
// não digitadas (evita carimbo "ajustado" depois).
function abrirConcluirVisita() {
  // Quem está concluindo é quem está logado AGORA — não o dono do briefing.
  // A ordem antiga (quemMediu → vendedor → sessão) fazia o medidor concluir a
  // visita e o app carimbar o nome do comercial: registro de prova mentindo,
  // e ninguém repara porque o campo já vem preenchido e parece certo.
  const sugerido = (SESSAO && SESSAO.nome) || BRIEF.quemMediu || BRIEF.vendedor || '';
  const agora = new Date();
  // Itens incompletos podem estar recolhidos e passar despercebidos
  const faltando = BRIEF.itens.filter(i => !itemCompleto(i));
  const m = abrirModal(
    '<h3>Concluir a visita</h3>' +
    // Não diz mais "as 3 fotos": cada tipo de item exige uma quantidade
    // diferente, e o vendedor voltava pra rua atrás de foto que ninguém pediu.
    (faltando.length
      ? '<div class="aviso amarelo">Atenção: ' + faltando.length + ' item(ns) ainda sem medida ou sem as fotos exigidas. ' +
        'Dá pra concluir assim, mas o envio pro design só libera quando estiverem completos.</div>'
      : '') +
    '<p class="dica-campo">A data e a hora são marcadas automaticamente agora: <b>' +
    esc(fmtDataHora(agora.toISOString())) + '</b>.</p>' +
    '<div class="campo" style="margin-top:12px"><label>Quem concluiu a visita</label>' +
    '<input id="cv-nome" type="text" value="' + esc(sugerido) + '"></div>' +
    '<div class="acoes-modal">' +
    '<button class="botao fantasma btn-cancelar">Cancelar</button>' +
    '<button class="botao btn-ok">✅ Concluir</button></div>'
  );
  $('.btn-cancelar', m).onclick = () => m.remove();
  $('.btn-ok', m).onclick = () => {
    const nome = $('#cv-nome', m).value.trim();
    if (!nome) { toast('Informe quem concluiu a visita', 'erro'); return; }
    BRIEF.visitaConcluida = { por: nome, em: new Date().toISOString() };
    if (!BRIEF.quemMediu) BRIEF.quemMediu = nome;
    m.remove();
    salvarRascunho(true);
    renderApp();
    toast('Visita concluída ✓ Agora dá pra enviar pro design', 'sucesso');
  };
}

// Designers ativos do time (a lista de usuários sincroniza no CFG).
// A chave é o LOGIN, não o id: quem é cadastrado pela tela nova pode não ter id,
// e aí sumia da lista de atribuição sem ninguém entender por quê.
function designersAtivos() {
  return ((STORE.getCFG() || {}).usuarios || [])
    .filter(u => u.papel === 'designer' && u.ativo !== false)
    .map(u => ({ ...u, id: u.id || u.usuario }));
}

// Grava a atribuição no briefing, com o rastro de quem passou pra quem.
// `b` pode ser o BRIEF em edição ou um briefing salvo (repasse no detalhe).
function atribuirDesigner(b, designer) {
  const antes = b.designerAtribuido ? b.designerAtribuido.nome : '';
  b.designerAtribuido = designer ? { id: designer.id, nome: designer.nome, usuario: designer.usuario } : null;
  b.atribuicoes = b.atribuicoes || [];
  b.atribuicoes.push({
    de: antes, para: designer ? designer.nome : '',
    por: (SESSAO && SESSAO.nome) || '', em: new Date().toISOString()
  });
}

// Escolha de designer. `atual` marca o que já está com o briefing;
// aoEscolher recebe o usuário escolhido (ou null pra "qualquer um").
function abrirEscolhaMedidor(atual, aoEscolher) {
  const lista = medidoresAtivos();
  const m = abrirModal(
    '<h3>Quem vai medir?</h3>' +
    '<p class="dica-campo">A visita entra na agenda da pessoa, com a data, o endereço e o telefone do contato.</p>' +
    '<div class="lista-escolha" style="margin-top:10px">' +
    (lista.length ? lista.map(u =>
      '<button class="opcao-briefing" data-medidor="' + esc(u.usuario) + '">' +
      '<b>' + esc(u.nome) + (atual && norm(atual.usuario) === norm(u.usuario) ? ' · já está com ele' : '') + '</b>' +
      '<span class="dica-campo">' + esc(u.papel) + ' · ' + esc(u.usuario) + '</span></button>').join('')
      : '<div class="aviso amarelo">Ninguém com acesso de medição ainda. A gestão cria em Acessos.</div>') +
    '<button class="opcao-briefing" data-medidor=""><b>Eu mesmo vou medir</b>' +
    '<span class="dica-campo">não entra na agenda de ninguém</span></button>' +
    '</div>' +
    '<div class="acoes-modal"><button class="botao fantasma btn-cancelar">Cancelar</button></div>'
  );
  $('.btn-cancelar', m).onclick = () => m.remove();
  $$('[data-medidor]', m).forEach(bt => bt.onclick = () => {
    const u = lista.find(x => norm(x.usuario) === norm(bt.dataset.medidor)) || null;
    m.remove();
    aoEscolher(u);
  });
}

function abrirEscolhaDesigner(titulo, atual, aoEscolher) {
  const lista = designersAtivos();
  const m = abrirModal(
    '<h3>' + esc(titulo) + '</h3>' +
    '<p class="dica-campo">O briefing aparece pra todos, mas fica marcado com quem vai cuidar dele.</p>' +
    '<div class="lista-escolha" style="margin-top:10px">' +
    lista.map(u =>
      '<button class="opcao-briefing" data-designer="' + esc(u.id) + '">' +
      '<b>' + esc(u.nome) + (atual && atual.id === u.id ? ' · já está com ele' : '') + '</b>' +
      '<span class="dica-campo">' + esc(u.usuario) + '</span></button>').join('') +
    '<button class="opcao-briefing" data-designer=""><b>Sem designer definido</b>' +
    '<span class="dica-campo">qualquer um do design pega</span></button>' +
    '</div>' +
    '<div class="acoes-modal"><button class="botao fantasma btn-cancelar">Cancelar</button></div>'
  );
  $('.btn-cancelar', m).onclick = () => m.remove();
  $$('[data-designer]', m).forEach(bt => bt.onclick = () => {
    const u = lista.find(x => x.id === bt.dataset.designer) || null;
    m.remove();
    aoEscolher(u);
  });
}

function enviarBriefing() {
  const p = pendencias(BRIEF);
  if (p.length) {
    // Enviar com pendência não fica mudo: avisa e leva ao primeiro que falta.
    const primeiro = p[0];
    toast('Ainda falta: ' + primeiro.texto, 'erro');
    if (primeiro.itemId) ITENS_RECOLHIDOS.delete(primeiro.itemId);
    ETAPA = primeiro.etapa;
    _ultimaEtapaRender = 0;
    renderApp();
    if (primeiro.itemId) setTimeout(() => {
      const alvo = $('[data-item="' + (window.CSS && CSS.escape ? CSS.escape(primeiro.itemId) : primeiro.itemId) + '"]');
      if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    return;
  }
  const concluir = (designer) => {
    if (designer !== undefined) atribuirDesigner(BRIEF, designer);
    BRIEF.situacao = 'enviado';
    BRIEF.status = BRIEF.tipoMedicao === 'Execução' ? 'Aprovado pra execução' : 'Aguardando orçamento';
    BRIEF.enviadoEm = new Date().toISOString();
    BRIEF.semOS = !String(BRIEF.osNumero || '').trim();
    // Reenviou: o recado de correção não vale mais. null, e não delete: o merge
    // raso do pull só sobrescreve chave PRESENTE no remoto -- com delete, o
    // recado ressuscitava nos outros aparelhos e se re-espalhava.
    BRIEF.devolucao = null;
    // NÃO diz "enviado" se não conseguiu nem gravar no aparelho. Antes, com a
    // memória cheia, aparecia "enviado ✓" e o briefing sumia sem nunca subir.
    const gravou = salvarRascunho(true);
    if (!gravou) {
      // Volta a situação: não está enviado de verdade.
      BRIEF.situacao = 'rascunho';
      return; // salvarRascunho já mostrou o aviso de memória cheia
    }
    const id = BRIEF.id;
    BRIEF = null;
    // Enviar empurra pro servidor NA HORA (o autosave é agrupado; o envio não
    // espera a janela de agrupamento).
    STORE.trySync();
    toast('Briefing enviado pro design ✓ (sincroniza sozinho quando tiver sinal)', 'sucesso');
    location.hash = '#/b/' + id;
  };
  // Com mais de um designer no time, o vendedor diz pra quem vai. Com um só
  // (ou nenhum cadastrado), não há o que escolher -- segue direto.
  const designers = designersAtivos();
  const escolher = (depois) => {
    if (designers.length > 1) abrirEscolhaDesigner('Enviar pra qual designer?', null, depois);
    else depois(designers[0] || null);
  };
  if (BRIEF.tipoMedicao === 'Execução') {
    confirmar('Medição de execução', 'Estas medidas vão pra produção. <b>Conferiu duas vezes?</b>', 'Sim, enviar',
      () => escolher(concluir));
  } else {
    escolher(concluir);
  }
}

/* ══════════════════ Detalhe ══════════════════ */

// Grava uma mudança num briefing SEM levar junto um retrato velho da tela.
// Os botões do detalhe seguram o objeto do momento em que a tela foi montada;
// se entre a montagem e o clique alguma outra ação gravou algo (gerar uma nova
// versão da prancha, autosave, sync), salvar aquele objeto capturado apagaria
// o que veio depois -- foi assim que uma prancha corrigida sumia ao mexer no
// status. Então relemos do store, aplicamos a mudança em cima do ATUAL, e
// deixamos o objeto da tela em dia pro próximo clique.
// Intenções pendentes das ações do detalhe (status, repassar, lixeira...).
// Se o envio esbarrar num conflito (outro aparelho salvou primeiro), a
// intenção é REAPLICADA por cima da versão nova em vez de abrir o modal:
// mudar o status não briga com o colega que corrigiu o telefone.
const _intencoes = new Map(); // id -> { mudar, tentativas, em }

function gravarBriefing(b, mudar) {
  if (!b) return false;
  const atual = (b.id && STORE.getOS(b.id)) || b;
  const alvo = JSON.parse(JSON.stringify(atual));
  if (mudar) mudar(alvo);
  alvo.atualizadoEm = new Date().toISOString();
  if (SESSAO) alvo.atualizadoPor = SESSAO.nome;
  const ok = STORE.saveOS(alvo);
  if (ok && mudar && alvo.id) {
    const antiga = _intencoes.get(alvo.id);
    _intencoes.set(alvo.id, { mudar, tentativas: antiga ? antiga.tentativas : 0, em: Date.now() });
  }
  Object.assign(b, JSON.parse(JSON.stringify(alvo)));
  return ok;
}

function renderDetalhe(app) {
  const b = STORE.getOS(ROTA.id);
  if (!b) { toast('Briefing não encontrado neste aparelho. Sincronize e tente de novo.', 'erro'); location.hash = '#/lista'; return; }
  document.title = (b.cliente || 'Briefing') + ' · Brief de Medição';
  const podeGerir = SESSAO.papel === 'designer' || SESSAO.papel === 'admin';
  const meu = norm(b.vendedorUsuario) === norm(SESSAO.usuario);
  const semOS = !String(b.osNumero || '').trim();
  const o = b.obsGerais || {};
  // Arquivos e PDF do briefing só depois da visita concluída. Briefing já
  // enviado também vale: os antigos foram enviados antes deste carimbo existir.
  const liberado = !!b.visitaConcluida || b.situacao === 'enviado';

  const linha = (dt, dd) => dd ? '<div class="dupla-dado"><dt>' + dt + '</dt><dd>' + dd + '</dd></div>' : '';

  app.innerHTML =
    htmlTopo((b.numeroBrief ? 'Nº ' + padBrief(b.numeroBrief) + ' · ' : '') + (b.cliente || 'Briefing')) +
    '<main class="miolo">' +
    '<div class="titulo-pagina"><a href="#/lista" style="text-decoration:none">←</a> ' + esc(b.cliente || 'Briefing') +
    '<span class="badges">' +
    (b.numeroBrief ? '<span class="badge neutro">Nº ' + padBrief(b.numeroBrief) + '</span>' : '') +
    (b.situacao !== 'enviado' ? '<span class="badge rascunho">RASCUNHO</span>' : badgeStatus(b.status)) +
    (b.tipoMedicao ? '<span class="badge ' + (b.tipoMedicao === 'Execução' ? 'tipo-execucao' : 'tipo-orcamento') + '">' + esc(b.tipoMedicao) + '</span>' : '') +
    (semOS ? '<span class="badge sem-os">SEM O.S.</span>' : '<span class="badge neutro">O.S. ' + esc(b.osNumero) + '</span>') +
    '</span></div>' +

    (b.apagadoEm ? '<div class="aviso vermelho">Este briefing está na lixeira desde ' + fmtDataHora(b.apagadoEm) + '.</div>' : '') +

    // Ações
    '<div class="card"><div class="sub-secao">Ações</div>' +
    (liberado
      ? ''
      : '<div class="aviso amarelo" style="margin-top:0">🔒 O PDF e as fotos liberam depois que a visita for concluída. ' +
        'Até lá a medida ainda pode mudar, e nada deve sair pra produção.</div>') +
    '<div style="display:flex; flex-wrap:wrap; gap:8px">' +
    '<button class="botao mini" id="btn-pdf-brief"' + (liberado ? '' : ' disabled') + '>📄 PDF do briefing</button>' +
    '<button class="botao mini suave" id="btn-baixar-fotos"' + (liberado ? '' : ' disabled') + '>📥 Baixar todas as fotos (.zip)</button>' +
    // A ficha é o papel que o vendedor leva PRA visita: nunca pode ficar travada
    '<button class="botao mini fantasma" id="btn-ficha-det">🖨 Ficha de visita (PDF)</button>' +
    (podeUsarLayout() ? '<button class="botao mini suave" id="btn-gerar-prancha"' + (liberado ? '' : ' disabled') + '>🗂 Gerar prancha</button>' : '') +
    (podeGerir || meu ? '<button class="botao mini suave" id="btn-vincular-os">' + (semOS ? '🔗 Vincular O.S.' : '🔗 Trocar O.S.') + '</button>' : '') +
    // Corrigir depois de enviado: o design devolve pro vendedor com um recado,
    // em vez de a correção virar telefonema que nunca volta pro registro.
    (podeGerir && b.situacao === 'enviado' && !b.apagadoEm
      ? '<button class="botao mini fantasma" id="btn-devolver">↩️ Devolver pro vendedor</button>' : '') +
    (SESSAO.papel === 'admin' && !b.apagadoEm ? '<button class="botao mini perigo" id="btn-lixeira">🗑 Mover pra lixeira</button>' : '') +
    '</div>' +
    // Quem NÃO pode editar precisa saber por quê e o que fazer.
    (b.situacao === 'enviado' && SESSAO.papel !== 'admin' && !podeGerir
      ? '<div class="aviso amarelo" style="margin-top:12px">Este briefing já foi enviado, por isso não abre pra edição. ' +
        'Achou um erro numa medida? Peça ao design para <b>devolver pro vendedor</b> — aí ele volta a abrir pra você corrigir.</div>'
      : '') +
    (b.devolucao
      ? '<div class="aviso vermelho" style="margin-top:12px">↩️ <b>Devolvido pra correção</b> por ' +
        esc(b.devolucao.por) + ' em ' + fmtDataHora(b.devolucao.em) +
        (b.devolucao.motivo ? ':<br>“' + esc(b.devolucao.motivo) + '”' : '') + '</div>'
      : '') +
    (podeGerir && b.situacao === 'enviado'
      ? '<div class="campo" style="margin-top:12px; max-width:340px"><label>Status</label><select id="sel-status">' +
        STATUS_LISTA.map(s => '<option ' + (b.status === s ? 'selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></div>'
      : '') +
    // Com quem está o briefing. O repasse é entre os do design (e o admin).
    (b.situacao === 'enviado'
      ? '<div class="aviso ' + (b.designerAtribuido ? 'indigo' : 'amarelo') + '" style="margin-top:12px; display:flex; align-items:center; gap:10px; flex-wrap:wrap">' +
        '<span>🎨 ' + (b.designerAtribuido
          ? 'Com <b>' + esc(b.designerAtribuido.nome) + '</b>' +
            (SESSAO.usuario && norm(b.designerAtribuido.usuario) === norm(SESSAO.usuario) ? ' (você)' : '')
          : 'Sem designer definido — qualquer um do design pega') + '</span>' +
        (podeGerir ? '<button class="botao mini suave" id="btn-repassar">' +
          (b.designerAtribuido ? 'Direcionar pra outro' : 'Assumir ou direcionar') + '</button>' : '') +
        '</div>' +
        ((b.atribuicoes || []).length > 1
          ? '<div class="dica-campo" style="margin-top:6px">' +
            b.atribuicoes.slice(1).map(a =>
              esc(a.por) + ' passou de ' + esc(a.de || '—') + ' pra ' + esc(a.para || 'sem designer') +
              ' em ' + fmtDataHora(a.em)).join('<br>') + '</div>'
          : '')
      : '') +
    '</div>' +

    // Dados
    '<div class="card"><div class="sub-secao">Cliente e visita</div><dl>' +
    linha('Número do brief', b.numeroBrief ? 'Nº ' + padBrief(b.numeroBrief) : '') +
    linha('Cliente', esc(b.cliente)) +
    linha('Responsável', esc(b.responsavel)) +
    linha('Telefone', b.telefone ? '<a href="tel:' + esc(b.telefone.replace(/\D/g, '')) + '">' + esc(b.telefone) + '</a>' : '') +
    linha('Data da visita', fmtDataHora(b.dataHora)) +
    linha('Data da medida', b.dataMedicao ? fmtData(b.dataMedicao) : '') +
    linha('Vendedor', esc(b.vendedor)) +
    linha('Quem mediu', esc(b.quemMediu)) +
    linha('Visita concluída', b.visitaConcluida ? esc(b.visitaConcluida.por) + ' · ' + fmtDataHora(b.visitaConcluida.em) : '') +
    linha('Natureza', esc(b.naturezaServico)) +
    linha('Ambiente', esc(ambientesDe(b).join(' e '))) +
    linha('Serviço da O.S.', esc(b.osServico)) +
    linha('Enviado em', b.enviadoEm ? fmtDataHora(b.enviadoEm) : '') +
    '</dl></div>' +

    '<div class="card"><div class="sub-secao">Local</div><dl>' +
    linha('Endereço', esc(b.endereco)) +
    linha('Estabelecimento', esc(b.estabelecimento)) +
    linha('Referência', esc(b.pontoReferencia)) +
    (b.geo ? linha('GPS', '<a target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + b.geo.lat + ',' + b.geo.lng + '">abrir no mapa</a>') : '') +
    '</dl></div>' +

    // Itens
    (b.itens || []).map((it, i) =>
      '<div class="card"><div class="cabeca" style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px">' +
      '<h3 class="fonte-titulo" style="color:var(--indigo-escuro)">Item ' + (i + 1) + ': ' + esc(nomeItem(it) || 'sem nome') + '</h3>' +
      '<div style="display:flex; gap:6px; flex-wrap:wrap">' +
      '<button class="botao mini suave" data-pdf-item="' + it.id + '"' + (liberado ? '' : ' disabled') + '>📄 PDF do item</button>' +
      '<button class="botao mini fantasma" data-zip-item="' + it.id + '"' + (liberado ? '' : ' disabled') + '>📥 Fotos</button></div></div>' +
      (it.detalheServico ? '<p class="dica-campo" style="margin-bottom:8px">' + esc(it.detalheServico) + '</p>' : '') +
      '<table class="tabela"><tr><th>Medida</th><th>Largura</th><th>Altura</th><th>Área</th></tr>' +
      (it.medidas || []).map((m, mi) =>
        '<tr><td>' + (it.medidas.length > 1 ? 'Ponto ' + (mi + 1) : 'Principal') + '</td>' +
        '<td>' + esc(m.largura || '?') + ' cm</td><td>' + esc(m.altura || '?') + ' cm</td>' +
        '<td>' + (areaPar(m) > 0 ? fmtM2(areaPar(m)) : '') + '</td></tr>'
      ).join('') +
      (it.medidas && it.medidas.length > 1 ? '<tr><td colspan="3"><b>Soma das áreas</b></td><td><b>' + fmtM2(areaItem(it)) + '</b></td></tr>' : '') +
      '</table>' +
      '<dl style="margin-top:8px">' +
      linha('Quantidade', it.quantidade && String(it.quantidade) !== '1' ? esc(it.quantidade) + ' peças' : '') +
      linha('Altura de instalação', it.alturaInstalacao ? esc(it.alturaInstalacao) + ' cm do chão até a base' : '') +
      linha('Superfícies', esc((it.superficies || []).join(', ') + (it.superficieOutra ? ' (' + it.superficieOutra + ')' : ''))) +
      linha('Observação', esc(it.obs)) +
      '</dl>' +
      '<div class="grade-galeria" style="margin-top:10px" data-galeria-item="' + it.id + '">' +
      (it.fotos || []).map((f, fi) => {
        const def = FOTOS_ITEM.find(d => d.tipo === f.tipo);
        if (f.arquivada) return '<figure><div class="slot-foto" style="height:110px; display:flex; align-items:center; justify-content:center; font-size:.72rem; color:var(--cinza)">Foto removida na limpeza</div><figcaption>' + esc(def ? def.rotulo : f.tipo) + '</figcaption></figure>';
        return '<figure><img data-foto-idx="' + fi + '" data-foto-id="' + esc(f.id) + '" alt="' + esc(def ? def.rotulo : 'Foto') + '"><figcaption>' + esc(def ? def.rotulo : f.tipo) + '</figcaption></figure>';
      }).join('') +
      '</div></div>'
    ).join('') +

    // Croquis
    ((b.croquis || []).length
      ? '<div class="card"><div class="sub-secao">Desenhos da visita (croquis)</div>' +
        '<div class="grade-galeria" data-galeria-croquis>' +
        b.croquis.map((c, ci) => c.arquivada
          ? '<figure><div class="slot-foto" style="height:110px; display:flex; align-items:center; justify-content:center; font-size:.72rem; color:var(--cinza)">Removido na limpeza</div></figure>'
          : '<figure><img data-croqui-idx="' + ci + '" data-foto-id="' + esc(c.id) + '" alt="Desenho ' + (ci + 1) + '"><figcaption>Desenho ' + (ci + 1) + '</figcaption></figure>'
        ).join('') + '</div></div>'
      : '') +

    // Pranchas geradas (histórico de versões)
    ((b.pranchas || []).length
      ? '<div class="card"><div class="sub-secao">Pranchas geradas</div>' +
        b.pranchas.slice().reverse().map(v =>
          '<div class="resumo-item" style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap">' +
          '<div><b class="fonte-titulo">Versão ' + v.versao + ' · ' + (v.modo === 'producao' ? 'Produção' : 'Projeto') + '</b>' +
          '<div class="dica-campo">' + v.itens.length + ' prancha(s) · ' +
          esc(v.itens.map(p => p.seloServico || 'sem selo').join(', ')) + '<br>' +
          esc(v.criadoPor) + ' · ' + fmtDataHora(v.criadoEm) + '</div></div>' +
          '<button class="botao mini suave" data-regerar="' + v.versao + '">📄 Baixar PDF</button>' +
          (podeUsarLayout() ? '<button class="botao mini fantasma" data-corrigir="' + v.versao + '">✏️ Corrigir e gerar nova versão</button>' : '') +
          '</div>').join('') +
        '</div>'
      : '') +

    // Observações gerais
    '<div class="card"><div class="sub-secao">Observações gerais</div><dl>' +
    linha('Energia próxima', o.energia === 'sim' ? 'Sim' + (o.energiaOnde ? ' (' + esc(o.energiaOnde) + ')' : '') + (o.voltagem ? ' · ' + esc(o.voltagem) : '') : o.energia === 'nao' ? 'Não' : '') +
    linha('Obstáculos', esc(((o.obstaculos || []).join(', ')) + (o.obstaculoOutro ? ' (' + o.obstaculoOutro + ')' : ''))) +
    linha('Equipamento', o.equipamento ? esc(o.equipamento + (o.equipamentoDetalhe ? ' (' + o.equipamentoDetalhe + ')' : '')) : '') +
    linha('Ponto', esc(o.pontoTipo)) +
    linha('Serviços extras', esc((o.servicosExtras || []).join(', '))) +
    linha('Prazo desejado', esc(o.prazo)) +
    linha('Briefing do cliente', esc(o.briefingCliente)) +
    linha('Equipe estimada', esc(o.equipeInstalacao)) +
    linha('Tempo de execução', esc(o.tempoExecucao)) +
    '</dl></div>' +

    '<p class="dica-campo" style="text-align:center">Criado por ' + esc(b.criadoPor) + ' em ' + fmtDataHora(b.criadoEm) +
    ' · Última alteração: ' + esc(b.atualizadoPor || '') + ' em ' + fmtDataHora(b.atualizadoEm) + '</p>' +
    '</main>';

  ligarTopo();

  // Galerias com navegação
  (b.itens || []).forEach(it => {
    const cont = $('[data-galeria-item="' + it.id + '"]');
    if (!cont) return;
    const fotosVivas = (it.fotos || []).filter(f => !f.arquivada).map(f => {
      const def = FOTOS_ITEM.find(d => d.tipo === f.tipo);
      return { id: f.id, legenda: (nomeItem(it) || 'Item') + ' · ' + (def ? def.rotulo : f.tipo) };
    });
    $$('img[data-foto-id]', cont).forEach((img, pos) => {
      STORE.pullPhoto(img.dataset.fotoId).then(b64 => { if (b64) img.src = b64; });
      img.onclick = () => abrirLightbox(fotosVivas, fotosVivas.findIndex(x => x.id === img.dataset.fotoId));
    });
  });
  const gcro = $('[data-galeria-croquis]');
  if (gcro) {
    const vivos = (b.croquis || []).filter(c => !c.arquivada).map((c, i) => ({ id: c.id, legenda: 'Desenho da visita' }));
    $$('img[data-foto-id]', gcro).forEach(img => {
      STORE.pullPhoto(img.dataset.fotoId).then(b64 => { if (b64) img.src = b64; });
      img.onclick = () => abrirLightbox(vivos, vivos.findIndex(x => x.id === img.dataset.fotoId));
    });
  }

  // Repasse entre designers: grava direto no briefing salvo e sincroniza.
  const rep = $('#btn-repassar');
  if (rep) rep.onclick = () => abrirEscolhaDesigner(
    'Direcionar pra qual designer?', b.designerAtribuido,
    (u) => {
      gravarBriefing(b, alvo => atribuirDesigner(alvo, u));
      renderApp();
      toast(u ? 'Briefing direcionado pra ' + u.nome + ' ✓' : 'Briefing liberado pra qualquer designer ✓', 'sucesso');
    });

  // Ações
  $('#btn-pdf-brief').onclick = () => exportarPdfBriefing(b);
  $('#btn-ficha-det').onclick = () => exportarFichaVisita(b);
  $('#btn-baixar-fotos').onclick = () => baixarFotosDoBriefing(b);
  const bp = $('#btn-gerar-prancha');
  if (bp) bp.onclick = () => {
    // `_aberto: true` é obrigatório: sem ele a tela de produção entende que
    // está sendo aberta do zero e zera o rascunho -- levando embora o briefing
    // que este botão acabou de escolher.
    PROD = Object.assign(prodVazio(), {
      briefingId: b.id,
      osNumero: String(b.osNumero || '').trim(),
      urgente: !!b.urgente, // briefing urgente já liga a prioridade do lote
      mostrarBrief: true,
      _aberto: true
    });
    location.hash = '#/layout/producao';
  };
  $$('[data-regerar]').forEach(bt => bt.onclick = () => {
    const v = (b.pranchas || []).find(x => String(x.versao) === bt.dataset.regerar);
    if (v) regerarVersao(b, v);
  });
  // Corrigir um erro bobo (data trocada, typo) sem remontar o lote e remarcar
  // a ficha inteira: recarrega a versão na prévia e gera uma nova a partir dela.
  $$('[data-corrigir]').forEach(bt => bt.onclick = async () => {
    const v = (b.pranchas || []).find(x => String(x.versao) === bt.dataset.corrigir);
    if (!v) return;
    toast('Abrindo a versão pra corrigir…');
    try {
      await ensureModelos();
      const cfg = STORE.getCFG();
      const itens = [];
      for (const p of v.itens) {
        const imagem = p.imagemId ? await STORE.pullPhoto(p.imagemId) : null;
        itens.push(Object.assign({}, p, { id: STORE.uuid(), imagem, textoDireitos: cfg.textoDireitos || '' }));
      }
      LOTE = { modo: v.modo || 'producao', origem: 'correcao', briefingId: b.avulsa ? '' : b.id, itens, cfg };
      abrirPreviaLote();
    } catch (e) { toast('Não consegui abrir a versão: ' + e.message, 'erro'); }
  });
  $$('[data-pdf-item]').forEach(bt => bt.onclick = () => {
    const item = (b.itens || []).find(i => i.id === bt.dataset.pdfItem);
    if (item) exportarPdfItem(b, item);
  });
  $$('[data-zip-item]').forEach(bt => bt.onclick = () => {
    const item = (b.itens || []).find(i => i.id === bt.dataset.zipItem);
    if (item) baixarFotosDoBriefing(b, item);
  });
  const sel = $('#sel-status');
  if (sel) sel.onchange = () => {
    gravarBriefing(b, alvo => { alvo.status = sel.value; });
    toast('Status: ' + b.status, 'sucesso');
    renderApp();
  };
  const vinc = $('#btn-vincular-os');
  if (vinc) vinc.onclick = () => abrirVincularOS(b);
  const dev = $('#btn-devolver');
  if (dev) dev.onclick = () => abrirDevolver(b);
  const lix = $('#btn-lixeira');
  if (lix) lix.onclick = () => confirmar('Mover pra lixeira',
    'O briefing sai das listas e fica 30 dias recuperável na lixeira do admin. Depois disso é apagado de vez.', 'Mover', () => {
      gravarBriefing(b, alvo => {
        alvo.apagadoEm = new Date().toISOString();
        alvo.apagadoPor = SESSAO.nome;
      });
      toast('Movido pra lixeira');
      location.hash = '#/lista';
    }, true);
}

// Devolve o briefing pro vendedor corrigir: volta a ser rascunho (reabre pra
// edição) e guarda o recado de quem devolveu e por quê.
function abrirDevolver(b) {
  const m = abrirModal(
    '<h3>Devolver pro vendedor</h3>' +
    '<p class="dica-campo">O briefing volta a abrir pra edição do vendedor e sai da fila do design. Diga o que precisa corrigir.</p>' +
    '<div class="campo" style="margin-top:10px"><label>O que corrigir</label>' +
    '<textarea id="dev-motivo" rows="3" placeholder="Ex: a largura do item 2 está 180, confirmar se não é 108"></textarea></div>' +
    '<div class="acoes-modal">' +
    '<button class="botao fantasma btn-cancelar">Cancelar</button>' +
    '<button class="botao btn-ok">↩️ Devolver</button></div>'
  );
  $('.btn-cancelar', m).onclick = () => m.remove();
  $('.btn-ok', m).onclick = () => {
    const motivo = $('#dev-motivo', m).value.trim();
    if (!motivo) { toast('Escreva o que precisa ser corrigido.', 'erro'); return; }
    gravarBriefing(b, alvo => {
      alvo.situacao = 'rascunho';
      alvo.status = '';
      alvo.devolucao = { por: SESSAO.nome, em: new Date().toISOString(), motivo };
    });
    m.remove();
    toast('Devolvido pro vendedor ✓', 'sucesso');
    renderApp();
  };
}

function abrirVincularOS(b) {
  const m = abrirModal(
    '<h3>Vincular O.S.</h3>' +
    '<p class="dica-campo">Busca no Mubisys/PCP ou digita direto o número.</p>' +
    '<div class="campo" style="margin-top:10px"><label>Número da O.S.</label>' +
    '<input id="v-numero" type="text" inputmode="numeric" value="' + esc(b.osNumero || '') + '"></div>' +
    '<div id="v-resultado"></div>' +
    '<div class="acoes-modal">' +
    '<button class="botao suave btn-buscar">Buscar</button>' +
    '<button class="botao btn-salvar">Salvar número</button></div>'
  );
  const salvar = (origem, servico) => {
    const numero = $('#v-numero', m).value.trim();
    const mudou = numero !== (b.osNumero || '');
    gravarBriefing(b, alvo => {
      alvo.osNumero = numero;
      alvo.semOS = !numero;
      if (origem) alvo.osOrigem = origem; else if (mudou) alvo.osOrigem = '';
      // Serviço só vale pra O.S. que o buscou. Trocou o número sem buscar? Limpa,
      // senão o serviço da O.S. antiga sai errado na ficha e no PDF.
      if (servico) alvo.osServico = servico; else if (mudou) alvo.osServico = '';
    });
    m.remove();
    toast(numero ? 'O.S. ' + numero + ' vinculada ✓' : 'Número removido', 'sucesso');
    renderApp();
  };
  // O que a ÚLTIMA busca bem-sucedida achou. O Salvar compara com o número
  // que está no campo NA HORA do clique: rebindar o onclick no sucesso deixava
  // origem/serviço presos à busca antiga quando o usuário digitava outro
  // número depois -- e a O.S. nova saía com o serviço da errada.
  let achado = null;
  $('.btn-buscar', m).onclick = async () => {
    const numero = $('#v-numero', m).value.trim();
    const alvo = $('#v-resultado', m);
    if (!numero) { alvo.innerHTML = '<div class="aviso amarelo">Digite o número.</div>'; return; }
    alvo.innerHTML = '<div class="aviso indigo">Buscando…</div>';
    try {
      const res = await STORE.apiFn('mubisys', { action: 'buscarOS', numero });
      if (res && res.encontrado) {
        alvo.innerHTML = '<div class="aviso verde">Achei: ' + esc(res.os.cliente || '') + (res.os.servico ? ' · ' + esc(res.os.servico) : '') + '</div>';
        achado = { numero, origem: res.origem, servico: res.os.servico || '' };
      } else {
        if (achado && achado.numero !== numero) achado = null;
        alvo.innerHTML = '<div class="aviso amarelo">Não achei essa O.S. Dá pra salvar o número mesmo assim.</div>';
      }
    } catch {
      alvo.innerHTML = '<div class="aviso amarelo">Sem conexão. Dá pra salvar o número mesmo assim.</div>';
    }
  };
  $('.btn-salvar', m).onclick = () => {
    const n = $('#v-numero', m).value.trim();
    if (achado && achado.numero === n) salvar(achado.origem, achado.servico);
    else salvar('manual', '');
  };
}

/* ══════════════════ Admin ══════════════════ */

const ABAS_ADMIN = [
  { id: 'usuarios', nome: '🔑 Acessos' },
  { id: 'fichas', nome: 'Fichas dos setores' },
  { id: 'arquivos', nome: 'Arquivos e lixeira' },
  { id: 'armazenamento', nome: 'Armazenamento' },
  { id: 'config', nome: 'Configurações' },
  { id: 'log', nome: 'Log' },
  { id: 'integracao', nome: 'Mubisys' }
];

function renderAdmin(app) {
  if (SESSAO.papel !== 'admin') { location.hash = '#/lista'; return; }
  document.title = 'Painel de controle · Brief de Medição';
  const aba = ROTA.aba || 'usuarios';
  app.innerHTML =
    htmlTopo('Painel de controle') +
    '<main class="miolo">' +
    '<div class="abas">' +
    ABAS_ADMIN.map(a => '<button class="aba ' + (a.id === aba ? 'ativa' : '') + '" data-aba="' + a.id + '">' + a.nome + '</button>').join('') +
    '</div>' +
    '<div id="conteudo-admin"><div class="vazio">Carregando…</div></div>' +
    '</main>';
  ligarTopo();
  $$('.aba[data-aba]').forEach(bt => bt.onclick = () => {
    const ir = () => { location.hash = '#/admin/' + bt.dataset.aba; };
    const saindoDe = (t) => aba === t && bt.dataset.aba !== t;
    // Sair de Configurações ou de Fichas com alteração não salva perde tudo
    // (as duas têm um só Salvar no fim). Avisa antes.
    if ((saindoDe('config') && _configSuja) || (saindoDe('fichas') && _fichasSuja)) {
      confirmar('Sair sem salvar?', 'Você mexeu e ainda não salvou. Sair agora perde as alterações.',
        'Sair sem salvar', () => { _configSuja = false; _fichasSuja = false; ir(); }, true);
    } else ir();
  });
  const alvo = $('#conteudo-admin');
  if (aba === 'usuarios') adminUsuarios(alvo);
  else if (aba === 'fichas') adminFichas(alvo);
  else if (aba === 'arquivos') adminArquivos(alvo);
  else if (aba === 'armazenamento') adminArmazenamento(alvo);
  else if (aba === 'config') adminConfig(alvo);
  else if (aba === 'log') adminLog(alvo);
  else if (aba === 'integracao') adminIntegracao(alvo);
}

/* ══════════════════ Editor das fichas dos setores ══════════════════ */
// As fichas da prancha (opções que a produção marca) deixaram de ser fixas no
// código: o admin cria/edita/apaga aqui, e vira cfg.fichasSetores (sincronizado).
let FICHAS_EDIT = null;
let _fichasSuja = false;
// Fica true enquanto o admin continua NO PAINEL; sair dele derruba o rascunho.
let _fichasAbaViva = false;
// Nomes dos setores no momento em que a aba abriu (base pra salvar a diferença).
let _fichasNomesAoAbrir = null;
const RODAPES = [
  ['', 'Nenhum'],
  ['producao', 'Liberação produção'],
  ['tecnica-producao', 'Liberação técnica + produção'],
  ['comercial-producao', 'Liberação comercial + produção']
];

// Modelos efetivos (padrão + admin) num formato editável (cor em hex, listas soltas).
function fichasParaEditar(cfg) {
  const models = (typeof PRANCHA !== 'undefined') ? PRANCHA.todosModelos(cfg) : {};
  return Object.keys(models).map(nome => {
    const m = models[nome] || {};
    return {
      nome,
      cor: (typeof PRANCHA !== 'undefined' && PRANCHA.rgbParaHex) ? PRANCHA.rgbParaHex(m.cor) : '#384018',
      atencao: !!m.atencao,
      rodape: m.rodape || '',
      // Flags de layout do cabeçalho: não aparecem no editor, mas viajam junto
      // pra renomear um setor não perder o cabeçalho especial dele.
      rotuloData: m.rotuloData,
      dataInicioEntrega: m.dataInicioEntrega,
      endEntregaNoCabecalho: m.endEntregaNoCabecalho,
      enderecoObs: m.enderecoObs,
      caixasSoltas: (m.caixasSoltas || []).slice(),
      tabelas: (m.tabelas || []).map(t => ({
        titulo: t.titulo || '', semCheck: !!t.semCheck,
        itens: (t.itens || []).map(x => String(x == null ? '' : x)),
        colunas: (t.colunas || []).slice(),
        // Cores das linhas (só a Serralheria usa) NÃO aparecem no editor, mas
        // viajam junto pra não sumir ao salvar.
        cores: t.cores
      }))
    };
  });
}

async function adminFichas(alvo) {
  alvo.innerHTML = '<div class="vazio">Carregando as fichas…</div>';
  // Os modelos vivem no prancha.js (carregado sob demanda). Sem ele, o editor
  // abriria vazio.
  try { await ensureModelos(); } catch { alvo.innerHTML = '<div class="aviso vermelho">Não consegui carregar os modelos das fichas.</div>'; return; }
  // Só mantém o rascunho quando a pessoa NÃO saiu do painel. Se ela navegou pra
  // fora (Briefings, Layout, logo…) e voltou, relê o cfg -- senão o rascunho
  // abandonado voltava com cara de "salvo" e um Salvar apagava o que tinha
  // chegado por sync de outro aparelho.
  const continuou = _fichasSuja && _fichasAbaViva;
  if (!FICHAS_EDIT || !continuou) {
    FICHAS_EDIT = fichasParaEditar(STORE.getCFG());
    _fichasSuja = false;
    // Guarda quem existia ao abrir: é o que permite salvar só a DIFERENÇA
    // (criados/apagados) sem desfazer a curadoria de setores em Configurações.
    _fichasNomesAoAbrir = FICHAS_EDIT.map(s => String(s.nome || '').trim());
  }
  _fichasAbaViva = true;
  redesenharFichas(alvo);
}

function htmlTabelaFicha(s, si, tab, ti) {
  return (
    '<div class="ficha-edit-tab">' +
    '<div class="linha-2">' +
    '<div class="campo"><label>Título da tabela</label><input type="text" data-ftitulo="' + si + '_' + ti + '" value="' + esc(tab.titulo) + '"></div>' +
    '<div class="campo"><label>Colunas extras (separe por vírgula)</label><input type="text" data-fcolunas="' + si + '_' + ti + '" placeholder="Ex: ESPESSURA, COR" value="' + esc((tab.colunas || []).join(', ')) + '"></div>' +
    '</div>' +
    '<label class="chip ' + (tab.semCheck ? 'marcado' : '') + '" data-fsemcheck="' + si + '_' + ti + '" style="margin:2px 0 8px">Só preencher (sem caixa de marcar)</label>' +
    '<div class="campo"><label>Opções (uma por linha)</label>' +
    '<textarea rows="5" data-fitens="' + si + '_' + ti + '" placeholder="Uma opção por linha…">' + esc((tab.itens || []).join('\n')) + '</textarea></div>' +
    '<button class="botao mini perigo fantasma" data-fdeltab="' + si + '_' + ti + '">Apagar esta tabela</button>' +
    '</div>'
  );
}

function htmlSetorFicha(s, si) {
  return (
    '<div class="card ficha-edit-setor" data-fsetor="' + si + '">' +
    '<div class="linha-2">' +
    '<div class="campo"><label>Nome do setor</label><input type="text" data-fnome="' + si + '" value="' + esc(s.nome) + '"></div>' +
    '<div class="campo"><label>Cor do selo</label><input type="color" data-fcor="' + si + '" value="' + esc(s.cor) + '" style="height:44px; padding:2px"></div>' +
    '</div>' +
    '<div class="linha-2">' +
    '<div class="campo"><label>&nbsp;</label><label class="chip ' + (s.atencao ? 'marcado' : '') + '" data-fatencao="' + si + '">Barra “ATENÇÃO” no topo</label></div>' +
    '<div class="campo"><label>Rodapé de liberação</label><select data-frodape="' + si + '">' +
    RODAPES.map(r => '<option value="' + r[0] + '"' + (s.rodape === r[0] ? ' selected' : '') + '>' + esc(r[1]) + '</option>').join('') +
    '</select></div>' +
    '</div>' +
    (s.caixasSoltas && s.caixasSoltas.length
      ? '<div class="campo"><label>Caixas avulsas (uma por linha)</label><textarea rows="2" data-fsoltas="' + si + '">' + esc(s.caixasSoltas.join('\n')) + '</textarea></div>'
      : '') +
    '<div class="sub-secao" style="margin-top:6px">Tabelas</div>' +
    (s.tabelas || []).map((t, ti) => htmlTabelaFicha(s, si, t, ti)).join('') +
    '<button class="botao mini suave" data-faddtab="' + si + '">+ Adicionar tabela</button>' +
    '<div style="margin-top:12px; border-top:1px solid var(--borda); padding-top:10px">' +
    '<button class="botao mini perigo" data-fdelsetor="' + si + '">🗑 Apagar o setor “' + esc(s.nome) + '”</button></div>' +
    '</div>'
  );
}

function redesenharFichas(alvo) {
  alvo.innerHTML =
    '<div class="card"><p class="dica-campo" style="margin:0">Estas são as fichas que a produção marca em cada prancha. O que você mudar aqui vale pra todo mundo (sincroniza). Ao gerar, a prancha mostra só o que foi marcado. <b>Salve no fim.</b></p></div>' +
    FICHAS_EDIT.map((s, si) => htmlSetorFicha(s, si)).join('') +
    '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px">' +
    '<button class="botao suave" id="btn-add-setor">+ Novo setor</button>' +
    '<button class="botao fantasma" id="btn-reset-fichas">↩︎ Voltar ao padrão de fábrica</button>' +
    '</div>' +
    '<button class="botao largo" id="btn-salvar-fichas" style="margin-top:14px">Salvar fichas</button>';
  ligarFichasEditor(alvo);
}

function ligarFichasEditor(alvo) {
  const suja = () => { _fichasSuja = true; };
  const setor = si => FICHAS_EDIT[Number(si)];
  const tabela = (si, ti) => FICHAS_EDIT[Number(si)].tabelas[Number(ti)];

  // Campos de texto: gravam sem redesenhar (não rouba o foco).
  $$('[data-fnome]', alvo).forEach(el => el.oninput = () => { setor(el.dataset.fnome).nome = el.value; suja(); });
  $$('[data-fcor]', alvo).forEach(el => el.oninput = () => { setor(el.dataset.fcor).cor = el.value; suja(); });
  $$('[data-frodape]', alvo).forEach(el => el.onchange = () => { setor(el.dataset.frodape).rodape = el.value; suja(); });
  $$('[data-fsoltas]', alvo).forEach(el => el.oninput = () => { setor(el.dataset.fsoltas).caixasSoltas = el.value.split('\n').map(x => x.trim()).filter(Boolean); suja(); });
  $$('[data-fatencao]', alvo).forEach(el => el.onclick = () => { const s = setor(el.dataset.fatencao); s.atencao = !s.atencao; el.classList.toggle('marcado', s.atencao); suja(); });
  $$('[data-ftitulo]', alvo).forEach(el => el.oninput = () => { const [si, ti] = el.dataset.ftitulo.split('_'); tabela(si, ti).titulo = el.value; suja(); });
  $$('[data-fcolunas]', alvo).forEach(el => el.oninput = () => { const [si, ti] = el.dataset.fcolunas.split('_'); tabela(si, ti).colunas = el.value.split(',').map(x => x.trim()).filter(Boolean); suja(); });
  $$('[data-fitens]', alvo).forEach(el => el.oninput = () => { const [si, ti] = el.dataset.fitens.split('_'); tabela(si, ti).itens = el.value.split('\n').map(x => x.replace(/\s+$/, '')); suja(); });
  $$('[data-fsemcheck]', alvo).forEach(el => el.onclick = () => { const [si, ti] = el.dataset.fsemcheck.split('_'); const t = tabela(si, ti); t.semCheck = !t.semCheck; el.classList.toggle('marcado', t.semCheck); suja(); });

  // Estruturais: mudam a lista e redesenham.
  $$('[data-faddtab]', alvo).forEach(el => el.onclick = () => { setor(el.dataset.faddtab).tabelas.push({ titulo: 'NOVA TABELA', semCheck: false, itens: [''], colunas: [] }); suja(); redesenharFichas(alvo); });
  $$('[data-fdeltab]', alvo).forEach(el => el.onclick = () => {
    const [si, ti] = el.dataset.fdeltab.split('_');
    confirmar('Apagar a tabela?', 'Vai remover “' + esc(tabela(si, ti).titulo || 'tabela') + '” deste setor.', 'Apagar', () => {
      setor(si).tabelas.splice(Number(ti), 1); suja(); redesenharFichas(alvo);
    }, true);
  });
  $$('[data-fdelsetor]', alvo).forEach(el => el.onclick = () => {
    const si = el.dataset.fdelsetor;
    confirmar('Apagar o setor?', 'Vai remover “' + esc(setor(si).nome) + '” e a ficha dele. As pranchas já geradas não mudam.', 'Apagar setor', () => {
      FICHAS_EDIT.splice(Number(si), 1); suja(); redesenharFichas(alvo);
    }, true);
  });
  const addS = $('#btn-add-setor', alvo);
  if (addS) addS.onclick = () => { FICHAS_EDIT.push({ nome: 'Novo setor', cor: '#384018', atencao: true, rodape: 'producao', caixasSoltas: [], tabelas: [{ titulo: 'MATERIAL', semCheck: false, itens: [''], colunas: [] }] }); suja(); redesenharFichas(alvo); window.scrollTo(0, document.body.scrollHeight); };
  const reset = $('#btn-reset-fichas', alvo);
  if (reset) reset.onclick = () => confirmar('Voltar ao padrão de fábrica?', 'Descarta TODAS as suas alterações de fichas e volta pro que veio de origem. Não dá pra desfazer.', 'Voltar ao padrão', () => {
    FICHAS_EDIT = fichasParaEditar({}); // {} = sem overrides → só o padrão
    _fichasSuja = true; redesenharFichas(alvo);
  }, true);
  const salvar = $('#btn-salvar-fichas', alvo);
  if (salvar) salvar.onclick = () => salvarFichas(alvo);
}

async function salvarFichas(alvo) {
  // Valida nomes: sem nome vazio, sem repetido.
  const nomes = FICHAS_EDIT.map(s => String(s.nome || '').trim());
  if (nomes.some(n => !n)) { toast('Todo setor precisa de um nome.', 'erro'); return; }
  const dup = nomes.find((n, i) => nomes.indexOf(n) !== i);
  if (dup) { toast('Setor repetido: “' + dup + '”. Os nomes têm que ser únicos.', 'erro'); return; }

  const mapa = {};
  FICHAS_EDIT.forEach(s => {
    mapa[s.nome.trim()] = {
      cor: s.cor,
      atencao: !!s.atencao,
      rodape: s.rodape || '',
      // Preserva o layout do cabeçalho (ver fichasParaEditar).
      rotuloData: s.rotuloData,
      dataInicioEntrega: s.dataInicioEntrega,
      endEntregaNoCabecalho: s.endEntregaNoCabecalho,
      enderecoObs: s.enderecoObs,
      caixasSoltas: (s.caixasSoltas || []).filter(Boolean),
      tabelas: (s.tabelas || []).map(t => {
        // Mantém linhas em branco INTERNAS (viram campo pra escrever na prancha),
        // mas descarta as linhas vazias do fim (sobra de digitação).
        const itens = (t.itens || []).map(x => String(x).replace(/\s+$/, ''));
        while (itens.length && itens[itens.length - 1] === '') itens.pop();
        const out = {
          titulo: (t.titulo || '').trim(),
          semCheck: !!t.semCheck,
          itens,
          colunas: (t.colunas || []).filter(Boolean)
        };
        if (t.cores) out.cores = t.cores; // preserva as cores de linha (Serralheria)
        return out;
      })
    };
  });

  // Busca a config ATUAL antes de gravar. A configuração da empresa (equipe,
  // senhas, fichas, textos) mora num pacote só, e cada tela regrava o pacote
  // inteiro. Sem este passo, salvar as fichas com o painel aberto desde cedo
  // apagava quem tivesse sido cadastrado em outro aparelho no meio do dia.
  if (!(await STORE.pullCFG())) {
    toast('Não consegui conferir a config atual (sem conexão). Tente salvar de novo.', 'erro');
    return;
  }
  const cfg = STORE.getCFG();
  cfg.fichasSetores = mapa;

  // Setores de FÁBRICA que o admin apagou. Precisam ficar registrados: o padrão
  // sempre semeia o mapa, então sem esta lista o setor voltava sozinho.
  // Recriar um setor com o mesmo nome tira ele da lista.
  const deFabrica = (typeof PRANCHA !== 'undefined' && PRANCHA.setoresPadrao) ? PRANCHA.setoresPadrao : [];
  const vivos = nomes.map(n => norm(n));
  cfg.fichasApagadas = deFabrica.filter(n => !vivos.includes(norm(n)));

  // A lista de setores do gerador NÃO é reconstruída do zero: se fosse, todo
  // "Salvar fichas" ressuscitava os setores que o admin tinha tirado na aba
  // Configurações (o editor sempre lista todos os de fábrica). Aqui só
  // aplicamos a DIFERENÇA: tira os apagados, acrescenta os criados.
  const agora = nomes.slice();
  const antes = _fichasNomesAoAbrir || agora;
  const apagados = antes.filter(n => !agora.includes(n));
  const criados = agora.filter(n => !antes.includes(n));
  const atuais = (cfg.setoresProducao && cfg.setoresProducao.length ? cfg.setoresProducao : agora);
  cfg.setoresProducao = atuais.filter(n => !apagados.includes(n)).concat(criados.filter(n => !atuais.includes(n)));

  // Selos da prévia: acrescenta os novos e tira os de setores apagados,
  // preservando os selos que não são setor (Retirada, Manutenção, Entrega…).
  const selos = (cfg.tiposServico || []).filter(s => !apagados.includes(s));
  criados.forEach(n => { if (!selos.includes(n)) selos.push(n); });
  cfg.tiposServico = selos;
  STORE.saveCFG(cfg, SESSAO.nome);
  _fichasSuja = false;
  toast('Fichas salvas ✓ (sincronizam pra equipe)', 'sucesso');
  adminFichas(alvo);
}

// Tela de "entre de novo" — usada quando o aparelho não tem crachá (sessão
// antiga) ou o crachá venceu. Sem isto o app dava um erro que não ajudava.
function avisoEntrarDeNovo(alvo, motivo) {
  alvo.innerHTML = '<div class="card"><div class="sub-secao">Equipe</div>' +
    '<div class="aviso">' + esc(motivo) + ' Para administrar os acessos, entre de novo — ' +
    'leva dez segundos e não apaga nada deste aparelho.</div>' +
    '<button class="botao" id="btn-reentrar">Entrar de novo</button></div>';
  const b = $('#btn-reentrar', alvo);
  if (b) b.onclick = () => {
    AUTH.esquecer(); STORE.setUser(null); SESSAO = null;
    location.hash = '#/entrar/admin';
  };
}

// ── Acessos da equipe (Central de Acessos) ────────────────────────────────
// Esta tela é usada DA RUA: o dono contrata alguém de manhã e cria o acesso do
// celular, no carro. Por isso: cartões (tabela de 5 colunas não cabe no
// telefone), busca (a equipe passa de 30), senha SUGERIDA em palavras (dá pra
// ditar por telefone sem soletrar) e o botão de mandar os dados pelo WhatsApp,
// que é como a informação realmente chega na pessoa.
const PAPEL_INFO = {
  vendedor: { ic: '📐', desc: 'faz o briefing na visita, vê os briefings dele' },
  medidor:  { ic: '📍', desc: 'só a agenda de visitas direcionadas a ele' },
  designer: { ic: '🎨', desc: 'recebe briefings, gera pranchas, vê todos' },
  admin:    { ic: '🛠', desc: 'tudo, inclusive este painel' },
};
// Senha ditável: quem recebe vai digitar isso no celular, na obra.
function senhaDitavel() {
  const a = ['sol', 'lua', 'rio', 'mar', 'ceu', 'pao', 'flor', 'vento', 'pedra', 'folha'];
  const b = ['azul', 'verde', 'claro', 'forte', 'novo', 'leve', 'alto', 'certo'];
  const p = l => l[Math.floor(Math.random() * l.length)];
  return p(a) + '-' + p(b) + '-' + String(Math.floor(Math.random() * 900) + 100);
}

let _buscaEquipe = '';

async function adminUsuarios(alvo) {
  // Sessão de antes da virada não tem crachá: pedir para entrar de novo é a
  // resposta honesta — dizer "apenas a gestão" para o próprio dono não é.
  if (!AUTH.temCracha()) { avisoEntrarDeNovo(alvo, 'Sua sessão é anterior ao login novo.'); return; }
  alvo.innerHTML = '<div class="card"><div class="sub-secao">Acessos</div><p class="dica-campo">Carregando…</p></div>';
  let usuarios = [], papeisOk = ['vendedor', 'designer', 'medidor', 'admin'];
  try {
    const r = await AUTH.listarContas();
    usuarios = r.contas || [];
    if (r.papeis && r.papeis.length) papeisOk = r.papeis;
  } catch (e) {
    if (e.status === 401 || e.status === 403) { avisoEntrarDeNovo(alvo, 'Sua sessão expirou.'); return; }
    alvo.innerHTML = '<div class="card"><div class="sub-secao">Acessos</div>' +
      '<div class="aviso vermelho">Não consegui ler a equipe: ' + esc(e.erro || e.message) + '</div>' +
      '<p class="dica-campo">Esta tela precisa de internet — os acessos moram no servidor.</p></div>';
    return;
  }

  const filtrados = _buscaEquipe
    ? usuarios.filter(u => norm(u.nome + ' ' + u.usuario + ' ' + u.papel).includes(norm(_buscaEquipe)))
    : usuarios;
  const porPapel = {};
  usuarios.forEach(u => { porPapel[u.papel] = (porPapel[u.papel] || 0) + 1; });

  alvo.innerHTML =
    '<div class="card">' +
    '<div class="sub-secao">Acessos da equipe (' + usuarios.length + ')</div>' +
    '<p class="dica-campo" style="margin-bottom:10px">' +
    papeisOk.map(p => (PAPEL_INFO[p] ? PAPEL_INFO[p].ic + ' ' : '') + p + ': ' + (porPapel[p] || 0)).join(' · ') +
    '</p>' +
    '<div class="campo" style="margin-bottom:0"><input id="busca-equipe" type="search" ' +
    'placeholder="Buscar por nome, login ou perfil" value="' + esc(_buscaEquipe) + '"></div>' +
    '</div>' +
    (filtrados.length ? filtrados.map((u) => {
      const i = usuarios.indexOf(u);
      const info = PAPEL_INFO[u.papel] || { ic: '👤', desc: '' };
      return '<div class="card cartao-acesso">' +
        '<div class="ca-topo">' +
        '<div><b>' + esc(u.nome) + '</b>' +
        '<div class="dica-campo">' + info.ic + ' ' + esc(u.papel) + ' · ' + esc(u.usuario) + '</div></div>' +
        (u.ativo === false ? '<span class="badge rascunho">desativado</span>'
          : u.trocarSenha ? '<span class="badge rascunho">senha temporária</span>'
          : '<span class="badge status-concluido">ativo</span>') +
        '</div>' +
        (info.desc ? '<div class="dica-campo" style="margin-top:4px">' + esc(info.desc) + '</div>' : '') +
        '<div class="ca-acoes">' +
        '<button class="botao mini suave" data-editar="' + i + '">✏️ Editar</button>' +
        '<button class="botao mini suave" data-senha="' + i + '">🔑 Nova senha</button>' +
        '<button class="botao mini fantasma" data-remover="' + i + '">Remover</button>' +
        '</div></div>';
    }).join('')
      : '<div class="card"><p class="dica-campo" style="margin:0">Ninguém encontrado com “' + esc(_buscaEquipe) + '”.</p></div>') +
    '<div class="card"><button class="botao largo" id="btn-novo-usuario">➕ Novo acesso</button>' +
    '<p class="dica-campo" style="margin-top:10px">A senha fica no servidor, embaralhada — nem eu nem você conseguimos lê-la. ' +
    'A senha que você cria para outra pessoa é temporária: ela troca na primeira entrada.</p></div>';

  const busca = $('#busca-equipe', alvo);
  if (busca) busca.oninput = debounce(e => { _buscaEquipe = e.target.value; adminUsuarios(alvo); }, 300);

  // Manda usuário e senha por WhatsApp: é assim que a informação chega em quem
  // está na obra. Só a senha TEMPORÁRIA passa por aqui — a definitiva a própria
  // pessoa escolhe na primeira entrada, e ninguém mais a conhece.
  const mandarAcesso = (nome, usuario, senha) => {
    const txt = 'Oi ' + nome.split(' ')[0] + '! Seu acesso ao *Brief de Medição* da Impresilk:\n\n' +
      'Usuário: *' + usuario + '*\nSenha: *' + senha + '*\n\n' +
      'Entre em ' + 'https://impresilk.com.br/brief' + ' — na primeira entrada o app pede pra você criar a sua senha.';
    window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener');
  };

  const formUsuario = (u) => {
    const sugerida = u ? '' : senhaDitavel();
    const m = abrirModal(
      '<h3>' + (u ? 'Editar acesso' : 'Novo acesso') + '</h3>' +
      '<div class="campo"><label>Nome</label><input id="u-nome" value="' + esc(u ? u.nome : '') + '"></div>' +
      '<div class="campo"><label>Usuário (login)</label><input id="u-usuario" autocapitalize="none" value="' + esc(u ? u.usuario : '') + '"' + (u ? ' disabled' : '') + '></div>' +
      '<div class="campo"><label>Perfil</label><select id="u-papel">' +
      papeisOk.map(p => '<option value="' + esc(p) + '" ' + (u && u.papel === p ? 'selected' : '') + '>' +
        (PAPEL_INFO[p] ? PAPEL_INFO[p].ic + ' ' : '') + p + '</option>').join('') + '</select>' +
      '<div class="dica-campo" id="u-papel-desc"></div></div>' +
      '<div class="campo"><label>' + (u ? 'Nova senha (deixe em branco pra manter)' : 'Senha') + '</label>' +
      '<div style="display:flex; gap:8px">' +
      '<input id="u-senha" type="text" autocomplete="new-password" style="flex:1" value="' + esc(sugerida) + '">' +
      '<button type="button" class="botao mini fantasma" id="u-sugerir">🎲</button></div>' +
      '<div class="dica-campo">Palavras em vez de código: dá pra ditar por telefone.</div></div>' +
      (u ? '<div class="campo"><label class="chip ' + (u.ativo !== false ? 'marcado' : '') + '" id="u-ativo">Acesso ativo</label></div>' : '') +
      '<div class="acoes-modal"><button class="botao fantasma btn-cancelar">Cancelar</button><button class="botao btn-salvar">Salvar</button></div>'
    );
    const descreve = () => {
      const p = $('#u-papel', m).value;
      $('#u-papel-desc', m).textContent = (PAPEL_INFO[p] || {}).desc || '';
    };
    $('#u-papel', m).onchange = descreve; descreve();
    $('#u-sugerir', m).onclick = () => { $('#u-senha', m).value = senhaDitavel(); };
    let ativo = !u || u.ativo !== false;
    const chipAtivo = $('#u-ativo', m);
    if (chipAtivo) chipAtivo.onclick = () => { ativo = !ativo; chipAtivo.classList.toggle('marcado', ativo); };
    $('.btn-cancelar', m).onclick = () => m.remove();
    $('.btn-salvar', m).onclick = async () => {
      const nome = $('#u-nome', m).value.trim();
      const usuario = $('#u-usuario', m).value.trim().toLowerCase();
      const papel = $('#u-papel', m).value;
      const senha = $('#u-senha', m).value;
      if (!nome || !usuario || (!u && !senha)) { toast('Preencha nome, usuário e senha', 'erro'); return; }
      if (senha && senha.length < 6) { toast('A senha precisa de ao menos 6 caracteres', 'erro'); return; }
      // Ficar sem nenhum admin ativo tranca todo mundo fora do painel.
      const adminsAtivos = usuarios.filter(x => x.papel === 'admin' && x.ativo !== false);
      if (u && u.papel === 'admin' && adminsAtivos.length === 1 && norm(adminsAtivos[0].usuario) === norm(u.usuario)
          && (papel !== 'admin' || !ativo)) {
        toast('Este é o único admin ativo. Crie outro admin antes de mudar este.', 'erro'); return;
      }
      if (!u && usuarios.some(x => norm(x.usuario) === norm(usuario))) {
        toast('Já existe um acesso com esse login', 'erro'); return;
      }
      const bt = $('.btn-salvar', m); bt.disabled = true; bt.textContent = 'Salvando…';
      try {
        await AUTH.salvarConta({
          usuario: u ? u.usuario : usuario, nome, papel, ativo,
          senha: senha || undefined,
          temporaria: senha ? true : undefined,
        });
      } catch (e) {
        bt.disabled = false; bt.textContent = 'Salvar';
        toast(e.erro || 'Não consegui salvar', 'erro');
        return;
      }
      m.remove();
      toast('Acesso salvo ✓', 'sucesso');
      // Criou ou trocou a senha: oferece mandar na hora, que é o passo que
      // costuma ficar esquecido (acesso criado e ninguém avisa a pessoa).
      if (senha) {
        const login = u ? u.usuario : usuario;
        const m2 = abrirModal(
          '<h3>Avisar ' + esc(nome.split(' ')[0]) + '</h3>' +
          '<p class="dica-campo">Usuário <b>' + esc(login) + '</b> · senha temporária <b>' + esc(senha) + '</b></p>' +
          '<p class="dica-campo">Ela troca na primeira entrada — depois disso ninguém mais conhece a senha dela.</p>' +
          '<div class="acoes-modal"><button class="botao fantasma btn-depois">Depois</button>' +
          '<button class="botao btn-zap">💬 Mandar no WhatsApp</button></div>'
        );
        $('.btn-depois', m2).onclick = () => { m2.remove(); renderApp(); };
        $('.btn-zap', m2).onclick = () => { mandarAcesso(nome, login, senha); m2.remove(); renderApp(); };
        return;
      }
      renderApp();
    };
  };

  $('#btn-novo-usuario').onclick = () => formUsuario(null);
  $$('[data-editar]', alvo).forEach(bt => bt.onclick = () => formUsuario(usuarios[Number(bt.dataset.editar)]));
  // Atalho da rua: "esqueci a senha" resolve em dois toques, sem abrir o form.
  $$('[data-senha]', alvo).forEach(bt => bt.onclick = async () => {
    const u = usuarios[Number(bt.dataset.senha)];
    if (!u) return;
    const nova = senhaDitavel();
    if (!confirm('Gerar uma senha nova para ' + u.nome + '?\n\n    ' + nova + '\n\nEla troca na primeira entrada.')) return;
    try { await AUTH.salvarConta({ usuario: u.usuario, nome: u.nome, papel: u.papel, ativo: u.ativo !== false, senha: nova, temporaria: true }); }
    catch (e) { toast(e.erro || 'Não consegui trocar', 'erro'); return; }
    toast('Senha nova gerada ✓', 'sucesso');
    mandarAcesso(u.nome, u.usuario, nova);
    renderApp();
  });
  $$('[data-remover]', alvo).forEach(bt => bt.onclick = async () => {
    const u = usuarios[Number(bt.dataset.remover)];
    if (!u) return;
    if (!confirm('Tirar o acesso de ' + u.nome + ' (' + u.usuario + ')? Os briefings dele continuam onde estão.')) return;
    try { await AUTH.removerConta(u.usuario); } catch (e) { toast(e.erro || 'Não consegui remover', 'erro'); return; }
    toast('Acesso removido ✓', 'sucesso');
    renderApp();
  });
}
function adminArquivos(alvo) {
  const lixeira = STORE.getAllOS().filter(b => b && b.apagadoEm)
    .sort((a, z) => String(z.apagadoEm).localeCompare(String(a.apagadoEm)));
  alvo.innerHTML =
    '<div class="card"><div class="sub-secao">Lixeira (' + lixeira.length + ')</div>' +
    '<p class="dica-campo" style="margin-bottom:10px">Item apagado fica 30 dias recuperável. A limpeza automática roda todo dia.</p>' +
    (lixeira.length
      ? lixeira.map(b => {
          const dias = Math.max(0, 30 - Math.floor((Date.now() - new Date(b.apagadoEm).getTime()) / 86400000));
          return '<div class="resumo-item" style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap">' +
            '<div><b>' + esc(b.cliente || 'Sem nome') + '</b><div class="dica-campo">apagado por ' + esc(b.apagadoPor || '?') + ' em ' + fmtDataHora(b.apagadoEm) + ' · some em ' + dias + ' dia(s)</div></div>' +
            '<div style="display:flex; gap:6px"><button class="botao mini suave" data-restaurar="' + b.id + '">Restaurar</button>' +
            '<button class="botao mini perigo" data-excluir="' + b.id + '">Excluir de vez</button></div></div>';
        }).join('')
      : '<div class="vazio">Lixeira vazia.</div>') +
    '</div>' +
    '<div class="card"><div class="sub-secao">Limpeza em lote de fotos</div>' +
    '<p class="dica-campo" style="margin-bottom:10px">Apaga só as FOTOS de briefings CONCLUÍDOS antigos. Os dados e o PDF (sem fotos) continuam. Exporte os PDFs importantes antes.</p>' +
    '<div class="linha-2" style="align-items:end"><div class="campo" style="margin:0"><label>Concluídos há mais de (meses)</label>' +
    '<input id="lm-meses" type="text" inputmode="numeric" value="6"></div>' +
    '<button class="botao perigo" id="btn-limpeza">Executar limpeza</button></div>' +
    '<div id="lm-resultado"></div></div>' +
    '<div class="card"><div class="sub-secao">Backup deste aparelho</div>' +
    '<div style="display:flex; gap:8px; flex-wrap:wrap">' +
    '<button class="botao mini suave" id="btn-backup">⬇️ Exportar backup (JSON)</button>' +
    '<label class="botao mini fantasma" style="cursor:pointer">⬆️ Importar backup<input type="file" id="input-backup" accept="application/json" hidden></label>' +
    '</div></div>';

  $$('[data-restaurar]', alvo).forEach(bt => bt.onclick = () => {
    const b = STORE.getOS(bt.dataset.restaurar);
    if (!b) return;
    b.apagadoEm = null; b.apagadoPor = '';
    b.atualizadoEm = new Date().toISOString(); b.atualizadoPor = SESSAO.nome;
    STORE.saveOS(JSON.parse(JSON.stringify(b)));
    toast('Restaurado ✓', 'sucesso');
    renderApp();
  });
  $$('[data-excluir]', alvo).forEach(bt => bt.onclick = () => {
    const b = STORE.getOS(bt.dataset.excluir);
    if (!b) return;
    confirmar('Excluir DE VEZ', 'Briefing de <b>' + esc(b.cliente || 'sem nome') + '</b>: apaga registro e fotos do servidor e de todos os aparelhos. Não tem volta.', 'Continuar', () => {
      confirmar('Confirmação dupla', 'Última chance: excluir definitivamente?', 'Excluir de vez', () => {
        STORE.deleteOS(b.id, SESSAO.nome);
        toast('Excluído definitivamente');
        renderApp();
      }, true);
    }, true);
  });
  $('#btn-limpeza').onclick = () => {
    const meses = Math.max(1, Number($('#lm-meses').value) || 6);
    confirmar('Limpeza em lote', 'Apagar as fotos de todos os briefings CONCLUÍDOS há mais de <b>' + meses + ' meses</b>? Os dados continuam, as fotos não voltam.', 'Executar', async () => {
      const alvoR = $('#lm-resultado');
      alvoR.innerHTML = '<div class="aviso indigo">Executando…</div>';
      try {
        const r = await STORE.api({ action: 'limpezaFotos', meses, _quem: SESSAO.nome });
        alvoR.innerHTML = '<div class="aviso verde">Pronto: ' + r.fotosApagadas + ' foto(s) de ' + r.briefingsLimpos + ' briefing(s), ' + fmtBytes(r.bytesLiberados) + ' liberados.</div>';
        STORE.pull(() => {});
      } catch (e) {
        alvoR.innerHTML = '<div class="aviso vermelho">Não deu: ' + esc(e.message) + '</div>';
      }
    }, true);
  };
  $('#btn-backup').onclick = () => {
    const dados = STORE.exportarBackup();
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'backup-brief-' + diaLocal(new Date().toISOString()) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('#input-backup').onchange = e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const input = e.target;
    const leitor = new FileReader();
    leitor.onload = () => {
      let dados;
      try { dados = JSON.parse(leitor.result); }
      catch (err) { toast('Arquivo inválido: ' + err.message, 'erro'); input.value = ''; return; }
      if (!dados || !Array.isArray(dados.os)) { toast('Este arquivo não é um backup do Brief.', 'erro'); input.value = ''; return; }
      // Importar SUBSTITUI tudo e joga fora a fila do que ainda não subiu.
      // Antes fazia isso sem perguntar -- um clique curioso apagava o trabalho
      // da rua. Agora confirma, dizendo o tamanho do estrago.
      const atuais = STORE.getAllOS().filter(x => !x.apagadoEm).length;
      const naFila = (STORE.getQueue() || []).length;
      const aviso = 'Isto vai <b>substituir os ' + atuais + ' briefing(s)</b> deste aparelho pelos ' +
        dados.os.length + ' do arquivo' +
        (naFila ? ' e <b>descartar ' + naFila + ' item(ns) que ainda não subiram</b>' : '') +
        '. Não dá pra desfazer.' +
        '<br><br>O arquivo <b>não contém fotos</b>: só sobem as que existirem neste aparelho. ' +
        'Briefings mais novos no servidor são mantidos lá (o arquivo não desfaz o trabalho da equipe).';
      confirmar('Substituir tudo por este backup?', aviso, 'Substituir', async () => {
        try {
          await STORE.importarBackup(dados);
          toast('Backup importado ✓ (' + dados.os.length + ' briefings) — subindo pro servidor…', 'sucesso');
          renderApp();
        } catch (err) { toast('Não consegui importar: ' + err.message, 'erro'); }
      }, true);
      input.value = ''; // permite reescolher o mesmo arquivo depois
    };
    leitor.readAsText(f);
  };
}

async function adminArmazenamento(alvo) {
  alvo.innerHTML = '<div class="vazio">Calculando armazenamento…</div>';
  let d;
  try { d = await STORE.api({ action: 'armazenamento' }); }
  catch (e) { alvo.innerHTML = '<div class="aviso vermelho">Sem conexão com o servidor agora.</div>'; return; }
  const totalGeral = d.banco.bytes + d.fotos.bytes;
  const maxMes = Math.max(1, ...d.porMes.map(m => m.bytes));
  alvo.innerHTML =
    '<div class="card"><div class="sub-secao">Espaço usado na nuvem</div>' +
    '<div class="cards-numeros">' +
    '<div class="numero-grande"><div class="valor">' + fmtBytes(totalGeral) + '</div><div class="nome">Total geral</div></div>' +
    '<div class="numero-grande"><div class="valor">' + fmtBytes(d.banco.bytes) + '</div><div class="nome">Dados dos ' + d.banco.registros + ' briefings</div></div>' +
    '<div class="numero-grande"><div class="valor">' + fmtBytes(d.fotos.bytes) + '</div><div class="nome">Fotos (' + d.fotos.quantidade + ')</div></div>' +
    '<div class="numero-grande"><div class="valor">' + d.lixeira + '</div><div class="nome">Na lixeira</div></div>' +
    '</div>' +
    (d.fotos.blobsNoServidor !== d.fotos.quantidade
      ? '<p class="dica-campo" style="margin-top:8px">No servidor existem ' + d.fotos.blobsNoServidor + ' arquivos de foto (inclui fotos em trânsito ou órfãs).</p>'
      : '') +
    '</div>' +
    '<div class="card"><div class="sub-secao">Crescimento por mês</div>' +
    '<div class="grafico-meses">' +
    d.porMes.slice(-12).map(m =>
      '<div class="coluna"><div class="barra-mes" style="height:' + Math.max(3, Math.round(m.bytes / maxMes * 120)) + 'px" title="' + fmtBytes(m.bytes) + '"></div>' +
      '<div class="rotulo-mes">' + esc(m.mes.slice(2)) + '</div></div>'
    ).join('') +
    '</div></div>' +
    '<div class="card"><div class="sub-secao">Briefings que mais ocupam espaço</div>' +
    '<table class="tabela"><tr><th>Cliente</th><th>Status</th><th>Tamanho</th></tr>' +
    d.maiores.map(m =>
      '<tr><td><a href="#/b/' + m.id + '">' + esc(m.cliente) + '</a>' + (m.naLixeira ? ' 🗑' : '') + '</td>' +
      '<td>' + esc(m.status || '') + '</td><td>' + fmtBytes(m.bytes) + '</td></tr>'
    ).join('') + '</table></div>';
}

let _configSuja = false;
function adminConfig(alvo) {
  _configSuja = false; // acabou de (re)abrir a aba, nada mexido ainda
  const cfg = STORE.getCFG();
  alvo.innerHTML =
    '<div class="card"><div class="sub-secao">Dicas por superfície</div>' +
    (cfg.superficies || []).filter(s => s !== 'Outro').map(s =>
      '<div class="campo"><label>' + esc(s) + '</label>' +
      '<textarea rows="2" data-dica="' + esc(s) + '">' + esc((cfg.dicas || {})[s] || '') + '</textarea></div>'
    ).join('') + '</div>' +
    '<div class="card"><div class="sub-secao">Contatos da empresa (cabeçalho da prancha)</div>' +
    '<div class="linha-2">' +
    [['nome', 'Nome'], ['instagram', 'Instagram'], ['whatsapp', 'WhatsApp'], ['telefone', 'Telefone'], ['email', 'E-mail'], ['endereco', 'Endereço']]
      .map(([k, r]) => '<div class="campo"><label>' + r + '</label>' +
        '<input type="text" data-empresa="' + k + '" value="' + esc((cfg.empresa || {})[k] || '') + '"></div>').join('') +
    '</div>' +
    '<div class="campo"><label>Texto de direitos autorais</label>' +
    '<textarea id="cf-direitos" rows="2">' + esc(cfg.textoDireitos || '') + '</textarea></div>' +
    '</div>' +

    '<div class="card"><div class="sub-secao">Prancha: setores e selos</div>' +
    '<div class="campo"><label>Setores de produção (um por linha)</label>' +
    '<textarea rows="5" id="cf-setores">' + esc((cfg.setoresProducao || []).join('\n')) + '</textarea>' +
    '<div class="dica-campo">Cada setor marcado no gerador vira uma prancha.</div></div>' +
    '<div class="campo"><label>Tipos de serviço do selo laranja (um por linha)</label>' +
    '<textarea rows="5" id="cf-servicos">' + esc((cfg.tiposServico || []).join('\n')) + '</textarea></div>' +
    '</div>' +

    '<div class="card"><div class="sub-secao">Fotos obrigatórias por tipo de item</div>' +
    '<p class="dica-campo" style="margin-bottom:12px">Marque o que o vendedor é obrigado a fotografar em cada tipo. Adesivo de parede costuma resolver com uma foto só; letreiro e totem pedem o conjunto. As outras fotos continuam disponíveis como opcionais.</p>' +
    '<div class="tabela-fotos">' +
    '<div class="linha-fotos cabeca-fotos"><span>Tipo de item</span>' +
    FOTOS_ITEM.map(f => '<span>' + esc(f.rotulo.replace(' (se substituição)', '')) + '</span>').join('') + '</div>' +
    (cfg.tiposItem || []).map(t => {
      const marcadas = (cfg.fotosPorTipo || {})[t] || cfg.fotosPadrao || [];
      return '<div class="linha-fotos"><span class="nome-tipo">' + esc(t) + '</span>' +
        FOTOS_ITEM.map(f =>
          '<span><input type="checkbox" data-fototipo="' + esc(t) + '" data-foto="' + f.tipo + '"' +
          (marcadas.includes(f.tipo) ? ' checked' : '') + '></span>'
        ).join('') + '</div>';
    }).join('') +
    '</div></div>' +

    '<div class="card"><div class="sub-secao">Listas</div>' +
    '<div class="campo"><label>Tipos de item (um por linha)</label>' +
    '<p class="dica-campo" style="margin:0 0 6px">Cuidado ao <b>renomear</b> um tipo: as fotos exigidas dele (acima) recomeçam do padrão. Se quiser mudar as fotos, ajuste depois de salvar o nome novo.</p>' +
    '<textarea rows="6" id="cf-tipos">' + esc((cfg.tiposItem || []).join('\n')) + '</textarea></div>' +
    '<div class="campo"><label>Superfícies (uma por linha)</label>' +
    '<textarea rows="6" id="cf-superficies">' + esc((cfg.superficies || []).join('\n')) + '</textarea></div>' +
    '</div>' +
    '<div class="card"><div class="sub-secao">Avisar o time quando chega um briefing</div>' +
    '<p class="dica-campo" style="margin-bottom:8px">Assim que um vendedor envia um briefing pro design, o sistema dispara um aviso automático (WhatsApp, e-mail, Telegram — o que estiver montado no n8n). Cole aqui o endereço que o n8n forneceu. Em branco = ninguém é avisado.</p>' +
    '<div class="campo"><label>Endereço do aviso automático</label><input id="cf-webhook" type="text" placeholder="https://…" value="' + esc(cfg.webhookUrl || '') + '"></div>' +
    '<button class="botao mini suave" id="btn-testar-webhook">Disparar teste</button>' +
    '<span id="webhook-resultado" class="dica-campo" style="margin-left:8px"></span>' +
    '</div>' +
    '<button class="botao largo" id="btn-salvar-config">Salvar configurações</button>';

  $('#btn-testar-webhook').onclick = async () => {
    const url = $('#cf-webhook').value.trim();
    const r$ = $('#webhook-resultado');
    if (!url) { r$.textContent = 'Cole a URL primeiro.'; return; }
    r$.textContent = 'Testando…';
    try {
      const r = await STORE.api({ action: 'testarWebhook', url });
      r$.textContent = r.ok ? 'Chegou lá ✓ (HTTP ' + r.http + ')' : 'Falhou: ' + (r.erro || ('HTTP ' + r.http) || r.motivo);
    } catch (e) { r$.textContent = 'Falhou: ' + e.message; }
  };
  // Qualquer mexida marca a config como "suja", pra avisar antes de trocar de aba.
  alvo.addEventListener('input', () => { _configSuja = true; });
  alvo.addEventListener('change', () => { _configSuja = true; });

  $('#btn-salvar-config').onclick = async () => {
    // Mesma razão do editor de fichas: a config é um pacote só e esta tela
    // regrava o pacote inteiro. Busca o atual antes pra não apagar o que outro
    // aparelho cadastrou enquanto esta tela estava aberta.
    if (!(await STORE.pullCFG())) {
      toast('Não consegui conferir a config atual (sem conexão). Tente salvar de novo.', 'erro');
      return;
    }
    const cfg2 = STORE.getCFG();
    cfg2.dicas = cfg2.dicas || {};
    $$('[data-dica]', alvo).forEach(t => { cfg2.dicas[t.dataset.dica] = t.value.trim(); });
    const tipos = $('#cf-tipos').value.split('\n').map(s => s.trim()).filter(Boolean);
    const superficies = $('#cf-superficies').value.split('\n').map(s => s.trim()).filter(Boolean);
    // Lista obrigatória vazia NÃO é ignorada em silêncio (antes o "salvo ✓"
    // aparecia e nada mudava). Avisa e não salva.
    if (!tipos.length) { toast('A lista de tipos de item não pode ficar vazia.', 'erro'); return; }
    if (!superficies.length) { toast('A lista de superfícies não pode ficar vazia.', 'erro'); return; }
    cfg2.tiposItem = tipos;
    cfg2.superficies = superficies;
    // Fotos obrigatórias por tipo
    const porTipo = {};
    $$('[data-fototipo]', alvo).forEach(cb => {
      const t = cb.dataset.fototipo;
      if (!porTipo[t]) porTipo[t] = [];
      if (cb.checked) porTipo[t].push(cb.dataset.foto);
    });
    if (Object.keys(porTipo).length) cfg2.fotosPorTipo = porTipo;
    // Prancha: contatos da empresa, setores e selos
    cfg2.empresa = Object.assign({}, cfg2.empresa || {});
    $$('[data-empresa]', alvo).forEach(el => { cfg2.empresa[el.dataset.empresa] = el.value.trim(); });
    cfg2.textoDireitos = $('#cf-direitos').value.trim();
    const setores = $('#cf-setores').value.split('\n').map(s => s.trim()).filter(Boolean);
    const servicos = $('#cf-servicos').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (setores.length) cfg2.setoresProducao = setores;
    if (servicos.length) cfg2.tiposServico = servicos;
    cfg2.webhookUrl = $('#cf-webhook').value.trim();
    STORE.saveCFG(cfg2, SESSAO.nome);
    _configSuja = false;
    toast('Configurações salvas ✓ (sincronizam pra equipe)', 'sucesso');
    adminConfig(alvo); // redesenha com o que ficou salvo (antes a tela não refletia)
  };
}

async function adminLog(alvo) {
  alvo.innerHTML = '<div class="vazio">Carregando o log…</div>';
  let dados;
  try { dados = await STORE.api({ action: 'listarLog' }); }
  catch { alvo.innerHTML = '<div class="aviso vermelho">Sem conexão com o servidor agora.</div>'; return; }
  const linhas = (logs) => logs.map(l =>
    '<tr><td style="white-space:nowrap">' + fmtDataHora(l.em) + '</td><td>' + esc(l.quem || '') + '</td>' +
    '<td>' + esc(l.acao || '') + (l.cliente ? ' · ' + esc(l.cliente) : '') + '</td></tr>'
  ).join('');
  alvo.innerHTML =
    '<div class="card"><div class="sub-secao">Log de atividades (quem fez o quê)</div>' +
    '<table class="tabela"><tr><th>Quando</th><th>Quem</th><th>Ação</th></tr>' +
    '<tbody id="log-linhas">' + linhas(dados.logs) + '</tbody></table>' +
    (dados.nextBefore ? '<button class="botao mini suave" id="btn-mais-log" style="margin-top:10px">Carregar mais</button>' : '') +
    '<p class="dica-campo" style="margin-top:8px">Entradas com mais de 90 dias são limpas automaticamente.</p></div>';
  let cursor = dados.nextBefore;
  const btn = $('#btn-mais-log');
  if (btn) btn.onclick = async () => {
    btn.disabled = true;
    const mais = await STORE.api({ action: 'listarLog', before: cursor }).catch(() => null);
    if (mais) {
      $('#log-linhas').insertAdjacentHTML('beforeend', linhas(mais.logs));
      cursor = mais.nextBefore;
      if (!cursor) btn.remove(); else btn.disabled = false;
    } else btn.disabled = false;
  };
}

async function adminIntegracao(alvo) {
  alvo.innerHTML = '<div class="vazio">Consultando…</div>';
  let st = null;
  try { st = await STORE.apiFn('mubisys', { action: 'statusConfig' }); } catch {}
  alvo.innerHTML =
    '<div class="card"><div class="sub-secao">Busca de O.S.</div>' +
    (st
      ? '<dl>' +
        // Nomes pelo EFEITO, não pela tecnologia: o dono precisa saber o que
        // liga e desliga, não o que é "fallback" ou "public key".
        '<div class="dupla-dado"><dt>Busca direta no Mubisys (na hora)</dt><dd>' + (st.mubisysConfigurado ? '<span class="badge status-concluido">ligada</span>' : '<span class="badge rascunho">desligada</span>') + '</dd></div>' +
        '<div class="dupla-dado"><dt>Busca pelo PCP (reserva)</dt><dd>' + (st.pcpConfigurado ? '<span class="badge status-concluido">ligada</span>' : '<span class="badge rascunho">desligada</span>') + '</dd></div>' +
        (st.tokenMascarado ? '<div class="dupla-dado"><dt>Token Mubisys</dt><dd>' + esc(st.tokenMascarado) + '</dd></div>' : '') +
        '</dl>' +
        '<p class="dica-campo" style="margin-top:8px">Com a busca pelo PCP ligada, o vendedor já encontra a O.S. hoje — só que com os dados da última importação (de hora em hora). Ligar a busca direta no Mubisys traz a O.S. no estado do momento.</p>'
      : '<div class="aviso vermelho">Sem conexão com o servidor agora.</div>') +
    '</div>' +
    // O formulário de credenciais SÓ aparece quando o status carregou. Sem
    // conexão, mostrá-lo em branco e salvável apagava a chave que estava lá.
    (st
      ? '<div class="card"><div class="sub-secao">Credenciais do Mubisys (opcional)</div>' +
        '<p class="dica-campo" style="margin-bottom:10px">Estes três dados vêm do suporte do Mubisys. Se não tiver, deixe como está — a busca pelo PCP continua funcionando.</p>' +
        '<div class="campo"><label>Identificação da empresa (public key)</label><input id="mb-public" value="' + esc(st.publicKey || '') + '"></div>' +
        '<div class="campo"><label>Senha de acesso (deixe em branco pra manter a atual)</label><input id="mb-token" type="password" autocomplete="off"></div>' +
        '<div class="campo"><label>Endereço do sistema Mubisys</label><input id="mb-base" value="' + esc(st.base || 'https://api.mubisys.com/api') + '"></div>' +
        '<button class="botao" id="btn-salvar-mubisys">Salvar credenciais</button>' +
        '<span id="mb-resultado" class="dica-campo" style="margin-left:8px"></span></div>'
      : '<div class="card"><p class="dica-campo">Pra ver ou trocar as credenciais, abra esta aba com internet. Sem carregar o que está gravado, salvar apagaria a chave atual.</p></div>');
  const btn = $('#btn-salvar-mubisys');
  if (btn) btn.onclick = async () => {
    const r$ = $('#mb-resultado');
    r$.textContent = 'Salvando…';
    try {
      await STORE.apiFn('mubisys', {
        action: 'salvarConfig',
        publicKey: $('#mb-public').value.trim(),
        accessToken: $('#mb-token').value.trim(),
        base: $('#mb-base').value.trim()
      });
      r$.textContent = 'Salvo ✓';
      toast('Credenciais salvas ✓', 'sucesso');
    } catch (e) { r$.textContent = 'Falhou: ' + e.message; }
  };
}

/* ══════════════════ PDF (carregamento preguiçoso) ══════════════════ */

function carregarScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Falha ao carregar ' + src));
    document.head.appendChild(s);
  });
}

let _zipCarregado = null;
function ensureZip() {
  if (!_zipCarregado) _zipCarregado = carregarScript('libs/zip.js');
  return _zipCarregado;
}

let _pdfCarregado = null;
function ensurePdfLibs() {
  if (_pdfCarregado) return _pdfCarregado;
  _pdfCarregado = new Promise((resolve, reject) => {
    const scripts = ['libs/jspdf.umd.min.js', 'libs/pdf-assets.js', 'pdf.js'];
    let i = 0;
    const proximo = () => {
      if (i >= scripts.length) return resolve();
      const s = document.createElement('script');
      s.src = scripts[i++];
      s.onload = proximo;
      s.onerror = () => reject(new Error('Falha ao carregar ' + s.src));
      document.head.appendChild(s);
    };
    proximo();
  });
  return _pdfCarregado;
}

/* ══════════════════ Tela de Arquivos (visão do designer) ══════════════════ */

// Quem vê a tela de arquivos. Mesma regra do gerador de layout: é ferramenta de
// design, não do vendedor na rua.
function podeVerArquivos() {
  return SESSAO && (SESSAO.papel === 'designer' || SESSAO.papel === 'admin');
}

let ARQ = { busca: '', limite: 8 };

// Todas as fotos vivas do briefing (itens + croquis), já com a legenda que vai
// aparecer no visualizador.
function fotosDoBriefing(b) {
  const out = [];
  (b.itens || []).forEach((it, i) => {
    (it.fotos || []).forEach(f => {
      if (f.arquivada) return;
      const def = FOTOS_ITEM.find(d => d.tipo === f.tipo);
      out.push({ id: f.id, legenda: (nomeItem(it) || 'Item ' + pad2(i + 1)) + ' · ' + (def ? def.rotulo : f.tipo) });
    });
  });
  (b.croquis || []).forEach((c, ci) => {
    if (!c.arquivada) out.push({ id: c.id, legenda: 'Desenho da visita ' + pad2(ci + 1) });
  });
  return out;
}

const ARQ_POR_CARTAO = 6;   // miniaturas por briefing; o resto vira "+N"

function renderArquivos(app) {
  if (!podeVerArquivos()) { toast('A tela de arquivos é da área do designer', 'erro'); location.hash = '#/lista'; return; }
  document.title = 'Arquivos';

  // Só briefing com a visita fechada: antes disso as fotos ainda estão mudando
  // e baixar arquivo pela metade só gera retrabalho.
  const prontos = STORE.getAllOS()
    .filter(x => x && !x.apagadoEm && !x.avulsa && (x.situacao === 'enviado' || x.visitaConcluida))
    .filter(x => {
      const t = norm(ARQ.busca);
      if (!t) return true;
      return norm((x.cliente || '') + ' ' + (x.osNumero || '') + ' ' +
        (x.numeroBrief ? padBrief(x.numeroBrief) : '') + ' ' + fmtData(x.dataHora)).includes(t);
    })
    .sort((a, z) => String(z.dataHora || '').localeCompare(String(a.dataHora || '')));

  const visiveis = prontos.slice(0, ARQ.limite);

  // Pranchas geradas SEM briefing (direto da O.S. ou modo Projeto). Antes elas
  // não apareciam em lugar nenhum do app -- o designer refazia o lote inteiro
  // quando a produção pedia de novo.
  const avulsas = STORE.getAllOS()
    .filter(x => x && !x.apagadoEm && x.avulsa && (x.pranchas || []).length)
    .filter(x => {
      const t = norm(ARQ.busca);
      if (!t) return true;
      return norm((x.cliente || '') + ' ' + (x.osNumero || '')).includes(t);
    })
    .sort((a, z) => String(z.criadoEm || '').localeCompare(String(a.criadoEm || '')))
    .slice(0, 10);

  app.innerHTML =
    htmlTopo('Arquivos') +
    '<main class="miolo">' +
    '<div class="card">' +
    '<p class="dica-campo" style="margin-bottom:10px">As fotos e desenhos de cada visita, prontos pra baixar. Toque numa foto pra ver grande.</p>' +
    '<div class="campo"><input id="arq-busca" type="text" placeholder="Cliente, O.S., Nº do brief ou data" value="' + esc(ARQ.busca) + '"></div>' +
    '</div>' +

    (avulsas.length
      ? '<div class="card"><div class="sub-secao">Pranchas geradas sem briefing</div>' +
        '<p class="dica-campo" style="margin-bottom:10px">Feitas direto da O.S. ou do modo Projeto. Dá pra baixar o PDF de novo sem remontar.</p>' +
        avulsas.map(a => (a.pranchas || []).slice().reverse().map(v =>
          '<div class="resumo-item" style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap">' +
          '<div><b class="fonte-titulo">' + esc(a.cliente || 'Sem nome') + '</b>' +
          '<div class="dica-campo">' +
          (String(a.osNumero || '').trim() ? 'O.S. ' + esc(a.osNumero) + ' · ' : 'sem O.S. · ') +
          'v' + v.versao + ' · ' + v.itens.length + ' prancha(s) · ' +
          esc(v.itens.map(p => p.seloServico || 'sem selo').join(', ')) + '<br>' +
          esc(v.criadoPor || '') + ' · ' + fmtDataHora(v.criadoEm) + '</div></div>' +
          '<button class="botao mini suave" data-avulsa="' + esc(a.id) + '" data-versao="' + v.versao + '">📄 Baixar PDF</button>' +
          '</div>').join('')).join('') +
        '</div>'
      : '') +

    (visiveis.length
      ? visiveis.map(b => {
          const fotos = fotosDoBriefing(b);
          const mostra = fotos.slice(0, ARQ_POR_CARTAO);
          const sobra = fotos.length - mostra.length;
          return '<div class="card card-arquivos" data-arq="' + esc(b.id) + '">' +
            '<div class="cabeca-arquivos">' +
            '<div><b class="fonte-titulo">' + esc(b.cliente || 'Sem nome') + '</b>' +
            '<div class="dica-campo">' +
            (b.numeroBrief ? 'Nº ' + padBrief(b.numeroBrief) + ' · ' : '') +
            (String(b.osNumero || '').trim() ? 'O.S. ' + esc(b.osNumero) : 'sem O.S.') +
            ' · ' + fmtData(b.dataHora) +
            ' · ' + (fotos.length ? fotos.length + ' arquivo(s)' : 'sem fotos') +
            '</div></div>' +
            '<div class="acoes-arquivos">' +
            '<a class="botao mini fantasma" href="#/b/' + esc(b.id) + '">Abrir briefing</a>' +
            (fotos.length ? '<button class="botao mini" data-zip="' + esc(b.id) + '">⬇ Baixar tudo</button>' : '') +
            '</div></div>' +
            (fotos.length
              ? '<div class="grade-galeria" data-galeria-arq="' + esc(b.id) + '">' +
                mostra.map(f =>
                  '<figure><img data-foto-id="' + esc(f.id) + '" alt="' + esc(f.legenda) + '">' +
                  '<figcaption>' + esc(f.legenda) + '</figcaption></figure>').join('') +
                (sobra > 0
                  ? '<figure><button class="mais-fotos" data-mais="' + esc(b.id) + '">+' + sobra + '</button>' +
                    '<figcaption>ver todas</figcaption></figure>'
                  : '') +
                '</div>'
              : '<p class="dica-campo">As fotos deste briefing ainda não sincronizaram neste aparelho.</p>') +
            '</div>';
        }).join('') +
        (prontos.length > visiveis.length
          ? '<button class="botao largo suave" id="arq-mais">Mostrar mais ' +
            Math.min(8, prontos.length - visiveis.length) + ' de ' + (prontos.length - visiveis.length) + '</button>'
          : '')
      : '<div class="vazio">' + (ARQ.busca ? 'Nada encontrado com esse texto.' : 'Nenhuma visita concluída ainda.') + '</div>') +
    '</main>';

  ligarTopo();
  $('#arq-busca').oninput = debounce(e => { ARQ.busca = e.target.value; ARQ.limite = 8; renderApp(); }, 300);
  const mais = $('#arq-mais');
  if (mais) mais.onclick = () => { ARQ.limite += 8; renderApp(); };

  // Miniaturas: cada uma busca a sua foto e abre o visualizador com a galeria
  // INTEIRA do briefing (não só as 6 que estão à vista).
  // Carregar as miniaturas em FILA (poucas por vez): abrir Arquivos disparava
  // dezenas de downloads de foto cheia ao mesmo tempo e o navegador engasgava,
  // deixando quadrados cinza pra sempre. Aqui a fila é global e limitada.
  const fila = [];
  visiveis.forEach(b => {
    const cont = $('[data-galeria-arq="' + b.id + '"]');
    if (!cont) return;
    const fotos = fotosDoBriefing(b);
    $$('img[data-foto-id]', cont).forEach(img => {
      img.onclick = () => abrirLightbox(fotos, fotos.findIndex(x => x.id === img.dataset.fotoId));
      fila.push(img);
    });
    const bt = $('[data-mais="' + b.id + '"]', cont);
    if (bt) bt.onclick = () => abrirLightbox(fotos, ARQ_POR_CARTAO);
  });
  carregarThumbsEmFila(fila);
  $$('[data-zip]').forEach(bt => bt.onclick = () => {
    const b = STORE.getOS(bt.dataset.zip);
    if (b) baixarFotosDoBriefing(b);
  });
  // Rebaixar o PDF de uma prancha avulsa (sem briefing).
  $$('[data-avulsa]').forEach(bt => bt.onclick = () => {
    const a = STORE.getOS(bt.dataset.avulsa);
    const v = a && (a.pranchas || []).find(x => String(x.versao) === bt.dataset.versao);
    if (v) regerarVersao(a, v);
  });
}

// Carrega miniaturas de foto no máximo N por vez. Falha vira um botão "tentar
// de novo" no lugar do quadrado, em vez de ficar cinza calado.
async function carregarThumbsEmFila(imgs, limite) {
  const max = limite || 4;
  let i = 0;
  const proxima = async () => {
    while (i < imgs.length) {
      const img = imgs[i++];
      if (!img.isConnected) continue;
      try {
        const b64 = await STORE.pullPhoto(img.dataset.fotoId);
        if (b64) img.src = b64;
        else marcarThumbFalha(img);
      } catch { marcarThumbFalha(img); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(max, imgs.length) }, proxima));
}
function marcarThumbFalha(img) {
  if (!img.isConnected) return;
  const fig = img.closest('figure') || img.parentElement;
  const btn = document.createElement('button');
  btn.className = 'thumb-retry';
  btn.textContent = '↻ tentar';
  btn.title = 'A foto não carregou — tocar pra tentar de novo';
  btn.onclick = () => { const novo = img.cloneNode(true); btn.replaceWith(novo); carregarThumbsEmFila([novo], 1); };
  img.replaceWith(btn);
}

/* ══════════════════ Arquivos das fotos (para o designer) ══════════════════ */

function nomeArquivoFoto(b, idxItem, item, tipoFoto, ext) {
  const def = FOTOS_ITEM.find(f => f.tipo === tipoFoto);
  const rotulo = def ? arquivoSeguro(def.rotulo.replace(' (se substituição)', '')) : tipoFoto;
  const nomeIt = arquivoSeguro(nomeItem(item) || 'item');
  return 'item-' + pad2(idxItem + 1) + '-' + nomeIt + '-' + rotulo + '.' + (ext || 'jpg');
}

function pastaDoBriefing(b) {
  return (b.numeroBrief ? 'brief-' + padBrief(b.numeroBrief) : 'brief') + '-' + arquivoSeguro(b.cliente);
}

function baixarBlob(blob, nome) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}

// Junta todas as fotos do briefing (itens + croquis) num zip com nomes que já
// dizem de qual item e de que ângulo é cada uma.
let _baixandoZip = false;
async function baixarFotosDoBriefing(b, apenasItem) {
  if (!b.visitaConcluida && b.situacao !== 'enviado') {
    toast('Conclua a visita antes de baixar os arquivos', 'erro');
    return;
  }
  // Trava contra clique repetido: sem isto, o zip demorava, o designer clicava
  // de novo e caíam vários zips iguais.
  if (_baixandoZip) { toast('Já estou montando o arquivo, aguarde…'); return; }
  _baixandoZip = true;
  const alvo = apenasItem ? [apenasItem] : (b.itens || []);
  // Total previsto, pra mostrar "montando X de Y".
  const totalPrev = alvo.reduce((s, it) => s + (it.fotos || []).filter(f => !f.arquivada).length, 0) +
    (apenasItem ? 0 : (b.croquis || []).filter(c => !c.arquivada).length);
  try {
    await ensureZip();
    const arquivos = [];
    const pasta = pastaDoBriefing(b);
    let faltando = 0, feitas = 0;
    // Um único aviso de progresso que se atualiza (em vez de encher a tela).
    let area = $('#toasts'); if (!area) { area = document.createElement('div'); area.id = 'toasts'; document.body.appendChild(area); }
    const prog = document.createElement('div'); prog.className = 'toast'; area.appendChild(prog);
    const passo = () => { feitas++; prog.textContent = 'Montando… ' + feitas + ' de ' + totalPrev; };
    prog.textContent = 'Montando… 0 de ' + totalPrev;

    for (const item of alvo) {
      const i = (b.itens || []).indexOf(item);
      for (const f of (item.fotos || [])) {
        if (f.arquivada) continue;
        const b64 = await STORE.pullPhoto(f.id);
        if (!b64) { faltando++; passo(); continue; }
        arquivos.push({ nome: pasta + '/' + nomeArquivoFoto(b, i < 0 ? 0 : i, item, f.tipo), dados: ZIP.base64ParaBytes(b64) });
        passo();
      }
    }
    if (!apenasItem) {
      for (let ci = 0; ci < (b.croquis || []).length; ci++) {
        const c = b.croquis[ci];
        if (c.arquivada) continue;
        const b64 = await STORE.pullPhoto(c.id);
        if (!b64) { faltando++; passo(); continue; }
        arquivos.push({ nome: pasta + '/desenho-' + pad2(ci + 1) + '.jpg', dados: ZIP.base64ParaBytes(b64) });
        passo();
      }
    }

    prog.remove(); // fim do progresso
    if (!arquivos.length) {
      toast(faltando ? 'As fotos ainda não sincronizaram neste aparelho. Sincronize e tente de novo.' : 'Não há fotos para baixar', 'erro');
      return;
    }
    // Faltou foto: pergunta antes e marca o nome do arquivo, pra ninguém montar
    // a prancha achando que baixou tudo.
    const baixar = () => {
      const zip = ZIP.criar(arquivos, new Date(b.dataHora || Date.now()));
      const marca = faltando ? '-INCOMPLETO-' + arquivos.length + 'de' + (arquivos.length + faltando) : '';
      baixarBlob(zip, pasta + (apenasItem ? '-item' : '') + '-fotos' + marca + '.zip');
      toast(arquivos.length + ' foto(s) baixadas' + (faltando ? ' · FALTARAM ' + faltando + ' (ainda não sincronizadas)' : ' ✓'), faltando ? 'erro' : 'sucesso');
    };
    if (faltando) {
      confirmar('Faltam ' + faltando + ' foto(s)',
        faltando + ' foto(s) ainda não sincronizaram neste aparelho. Dá pra baixar as ' + arquivos.length + ' que já tem (o arquivo sai marcado como INCOMPLETO), ou sincronizar e tentar de novo.',
        'Baixar as ' + arquivos.length, baixar);
    } else baixar();
  } catch (e) {
    console.error(e);
    toast('Não consegui montar o arquivo: ' + e.message, 'erro');
  } finally {
    _baixandoZip = false;
  }
}

// Uma foto só, direto da galeria
async function baixarUmaFoto(b, item, f) {
  const b64 = await STORE.pullPhoto(f.id);
  if (!b64) { toast('Foto ainda não sincronizada neste aparelho', 'erro'); return; }
  await ensureZip();
  const i = (b.itens || []).indexOf(item);
  const nome = item ? nomeArquivoFoto(b, i < 0 ? 0 : i, item, f.tipo) : 'desenho.jpg';
  baixarBlob(new Blob([ZIP.base64ParaBytes(b64)], { type: 'image/jpeg' }), pastaDoBriefing(b) + '-' + nome);
}

// Guarda comum do PDF: nada que vá pra produção ou pro cliente sai antes de a
// visita estar concluída (a ficha de visita é exceção, ela é PRA visita).
function podeExportar(b) {
  if (b && (b.visitaConcluida || b.situacao === 'enviado')) return true;
  toast('Conclua a visita antes de exportar', 'erro');
  return false;
}

async function exportarPdfBriefing(b) {
  if (!podeExportar(b)) return;
  toast('Gerando o PDF do briefing…');
  try {
    await ensurePdfLibs();
    await PDF.briefingCompleto(b);
    toast('PDF pronto ✓', 'sucesso');
  } catch (e) { console.error(e); toast('Não consegui gerar o PDF: ' + e.message, 'erro'); }
}

async function exportarPdfItem(b, item) {
  if (!podeExportar(b)) return;
  toast('Gerando o PDF do item…');
  try {
    await ensurePdfLibs();
    await PDF.itemUnico(b, item);
    toast('PDF pronto ✓', 'sucesso');
  } catch (e) { console.error(e); toast('Não consegui gerar o PDF: ' + e.message, 'erro'); }
}

// Antes de gerar, pergunta quantas folhas de rascunho: serviço grande não cabe
// numa folha só, e o vendedor precisa sair com o papel certo na prancheta.
function exportarFichaVisita(b) {
  const m = abrirModal(
    '<h3>Ficha de visita</h3>' +
    '<p class="dica-campo">Quantas folhas de rascunho você quer? Serviço grande costuma pedir mais de uma.</p>' +
    '<div class="chips" style="margin:12px 0">' +
    [1, 2, 3, 4].map(n => '<button class="chip ' + (n === 1 ? 'marcado' : '') + '" data-folhas="' + n + '">' +
      n + (n === 1 ? ' folha' : ' folhas') + '</button>').join('') +
    '</div>' +
    '<div class="acoes-modal">' +
    '<button class="botao fantasma btn-cancelar">Cancelar</button>' +
    '<button class="botao btn-gerar">🖨 Gerar PDF</button></div>'
  );
  let folhas = 1;
  $$('[data-folhas]', m).forEach(ch => ch.onclick = () => {
    folhas = Number(ch.dataset.folhas);
    $$('[data-folhas]', m).forEach(x => x.classList.toggle('marcado', x === ch));
  });
  $('.btn-cancelar', m).onclick = () => m.remove();
  $('.btn-gerar', m).onclick = async () => {
    m.remove();
    toast('Gerando a ficha de visita…');
    try {
      await ensurePdfLibs();
      await PDF.fichaVisita(b, folhas);
      toast('Ficha pronta ✓ É só imprimir', 'sucesso');
    } catch (e) { console.error(e); toast('Não consegui gerar a ficha: ' + e.message, 'erro'); }
  };
}

/* ══════════════════ Início ══════════════════ */

boot();
