// pdf.js — Exportações em PDF na identidade Impresilk
// Depende de libs/jspdf.umd.min.js e libs/pdf-assets.js (fontes TTF + logo em base64),
// carregados sob demanda pelo app.js (ensurePdfLibs).
//
// Identidade: indigo #3840E8, títulos Poppins, texto Spectral,
// logo como assinatura no rodapé da última página.

const PDF = (() => {
  const INDIGO = [56, 64, 232];
  const INDIGO_ESCURO = [42, 48, 184];
  const INDIGO_CLARO = [238, 239, 253];
  const TINTA = [23, 26, 51];
  const CINZA = [90, 94, 122];
  const BORDA = [227, 229, 242];

  const W = 595.28, H = 841.89, M = 42;
  const LARG = W - M * 2;
  const LOGO_PROP = 381 / 760; // altura/largura do logo

  function novoDoc() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    doc.addFileToVFS('Poppins-SemiBold.ttf', PDF_FONTES['Poppins-SemiBold']);
    doc.addFont('Poppins-SemiBold.ttf', 'Poppins', 'normal');
    doc.addFileToVFS('Spectral-Regular.ttf', PDF_FONTES['Spectral-Regular']);
    doc.addFont('Spectral-Regular.ttf', 'Spectral', 'normal');
    doc.addFileToVFS('Spectral-SemiBold.ttf', PDF_FONTES['Spectral-SemiBold']);
    doc.addFont('Spectral-SemiBold.ttf', 'Spectral', 'bold');
    return doc;
  }

  function medirImagem(dataUrl) {
    return new Promise(resolve => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth || 4, h: im.naturalHeight || 3 });
      im.onerror = () => resolve(null);
      im.src = dataUrl;
    });
  }

  function fmtDataHoraLocal(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtDataLocal(iso) {
    if (!iso) return '';
    return fmtDataHoraLocal(iso).slice(0, 10);
  }
  function m2(cm2) {
    return (cm2 / 10000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m²';
  }
  function nomeArquivo(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'briefing';
  }
  function nomeDoItem(item) {
    if (!item) return '';
    return item.tipo === 'Outro' ? (item.tipoOutro || 'Outro') : (item.tipo || 'Item');
  }

  // ── Cursor de página com quebra automática ────────────────────────────────
  function criarCursor(doc) {
    const c = { y: 0 };
    c.nova = () => { doc.addPage(); c.y = M; };
    c.garantir = (h) => { if (c.y + h > H - 64) c.nova(); };
    return c;
  }

  function cabecalho(doc, c, titulo, sub) {
    doc.setFillColor(...INDIGO);
    doc.rect(0, 0, W, 92, 'F');
    doc.setFillColor(...INDIGO_ESCURO);
    doc.rect(0, 86, W, 6, 'F');
    doc.setFont('Poppins'); doc.setTextColor(255, 255, 255);
    doc.setFontSize(21);
    doc.text(titulo, M, 42);
    doc.setFontSize(9.5);
    doc.text('Impresilk · Soluções Visuais', M, 60);
    if (sub) {
      doc.setFontSize(10);
      doc.text(sub, W - M, 42, { align: 'right' });
    }
    c.y = 116;
  }

  function tituloSecao(doc, c, texto) {
    c.garantir(40);
    doc.setFillColor(...INDIGO_CLARO);
    doc.roundedRect(M, c.y - 13, LARG, 24, 5, 5, 'F');
    doc.setFont('Poppins'); doc.setFontSize(10.5); doc.setTextColor(...INDIGO_ESCURO);
    doc.text(texto.toUpperCase(), M + 10, c.y + 3);
    c.y += 26;
  }

  function parLabelValor(doc, c, rotulo, valor, xBase, larguraCol) {
    if (!valor) return 0;
    const x = xBase != null ? xBase : M;
    const larg = larguraCol != null ? larguraCol : LARG;
    doc.setFont('Poppins'); doc.setFontSize(7.4); doc.setTextColor(...CINZA);
    doc.text(rotulo.toUpperCase(), x, c.y);
    doc.setFont('Spectral', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...TINTA);
    const linhas = doc.splitTextToSize(String(valor), larg);
    doc.text(linhas, x, c.y + 12);
    return 16 + (linhas.length - 1) * 12.5;
  }

  // Grade de pares rotulo/valor em duas colunas
  function gradeDados(doc, c, pares) {
    const meio = LARG / 2;
    const vivos = pares.filter(p => p[1]);
    for (let i = 0; i < vivos.length; i += 2) {
      const a = vivos[i], b = vivos[i + 1];
      c.garantir(34);
      const hA = parLabelValor(doc, c, a[0], a[1], M, meio - 14);
      const hB = b ? parLabelValor(doc, c, b[0], b[1], M + meio, meio - 4) : 0;
      c.y += Math.max(hA, hB) + 7;
    }
  }

  async function fotosEmGrade(doc, c, fotos, colunas) {
    const cols = colunas || 2;
    const gap = 10;
    const largFoto = (LARG - gap * (cols - 1)) / cols;
    let col = 0, linhaAltura = 0;
    for (const f of fotos) {
      const b64 = f.arquivada ? null : await STORE.pullPhoto(f.id);
      let hFoto = largFoto * 0.72;
      let dims = null;
      if (b64) {
        dims = await medirImagem(b64);
        if (dims) hFoto = Math.min(largFoto * (dims.h / dims.w), 220);
      }
      const blocoH = hFoto + (f.legenda ? 14 : 4);
      if (col === 0) c.garantir(blocoH + 6);
      const x = M + col * (largFoto + gap);
      if (b64) {
        try { doc.addImage(b64, 'JPEG', x, c.y, largFoto, hFoto, undefined, 'FAST'); }
        catch { desenharFotoFaltando(doc, x, c.y, largFoto, hFoto); }
      } else {
        desenharFotoFaltando(doc, x, c.y, largFoto, hFoto, f.arquivada);
      }
      if (f.legenda) {
        doc.setFont('Poppins'); doc.setFontSize(7); doc.setTextColor(...CINZA);
        doc.text(String(f.legenda), x, c.y + hFoto + 10);
      }
      linhaAltura = Math.max(linhaAltura, blocoH);
      col++;
      if (col >= cols) { col = 0; c.y += linhaAltura + 8; linhaAltura = 0; }
    }
    if (col > 0) c.y += linhaAltura + 8;
  }

  function desenharFotoFaltando(doc, x, y, w, h, arquivada) {
    doc.setDrawColor(...BORDA); doc.setFillColor(250, 250, 254);
    doc.roundedRect(x, y, w, h, 6, 6, 'FD');
    doc.setFont('Poppins'); doc.setFontSize(7.5); doc.setTextColor(...CINZA);
    doc.text(arquivada ? 'Foto removida na limpeza' : 'Foto ainda não sincronizada', x + w / 2, y + h / 2, { align: 'center' });
  }

  // Rodapé em todas as páginas + logo assinatura na última
  function fecharDocumento(doc, rotulo) {
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setDrawColor(...INDIGO);
      doc.setLineWidth(1.2);
      doc.line(M, H - 46, W - M, H - 46);
      doc.setFont('Poppins'); doc.setFontSize(7.5); doc.setTextColor(...CINZA);
      doc.text(rotulo, M, H - 32);
      doc.text('página ' + p + ' de ' + total, W - M, H - 32, { align: 'right' });
      if (p === total) {
        const lw = 92;
        try { doc.addImage(PDF_LOGO, 'PNG', W - M - lw, H - 40 - lw * LOGO_PROP + 6, lw, lw * LOGO_PROP); } catch {}
      }
    }
  }

  function metaVisita(b) {
    return [
      ['Cliente', b.cliente], ['Telefone', b.telefone],
      ['Responsável', b.responsavel], ['Como conheceu', b.comoConheceu],
      ['O.S.', String(b.osNumero || '').trim() || 'SEM O.S. por enquanto'], ['Serviço da O.S.', b.osServico],
      ['Tipo de medição', b.tipoMedicao], ['Natureza', b.naturezaServico],
      ['Ambiente', b.ambiente], ['Status', b.situacao === 'enviado' ? b.status : 'Rascunho'],
      ['Vendedor', b.vendedor], ['Quem mediu', b.quemMediu],
      ['Data da visita', fmtDataHoraLocal(b.dataHora)], ['Enviado em', b.enviadoEm ? fmtDataHoraLocal(b.enviadoEm) : '']
    ];
  }

  function tabelaMedidas(doc, c, item) {
    const linhas = (item.medidas || []).filter(p => p.largura || p.altura);
    if (!linhas.length) return;
    c.garantir(26 + linhas.length * 17);
    const cols = [M, M + 150, M + 260, M + 370];
    doc.setFont('Poppins'); doc.setFontSize(7.6); doc.setTextColor(...CINZA);
    doc.text('MEDIDA', cols[0], c.y); doc.text('LARGURA', cols[1], c.y);
    doc.text('ALTURA', cols[2], c.y); doc.text('ÁREA', cols[3], c.y);
    doc.setDrawColor(...BORDA); doc.line(M, c.y + 4, W - M, c.y + 4);
    c.y += 16;
    doc.setFont('Spectral'); doc.setFontSize(10); doc.setTextColor(...TINTA);
    linhas.forEach((p, i) => {
      doc.text(linhas.length > 1 ? 'Ponto ' + (i + 1) : 'Principal', cols[0], c.y);
      doc.text(String(p.largura || '?') + ' cm', cols[1], c.y);
      doc.text(String(p.altura || '?') + ' cm', cols[2], c.y);
      const a = (Number(String(p.largura).replace(',', '.')) || 0) * (Number(String(p.altura).replace(',', '.')) || 0);
      doc.text(a > 0 ? m2(a) : '', cols[3], c.y);
      c.y += 15;
    });
    if (linhas.length > 1) {
      const total = linhas.reduce((s, p) => s + (Number(String(p.largura).replace(',', '.')) || 0) * (Number(String(p.altura).replace(',', '.')) || 0), 0);
      doc.setFont('Spectral', 'bold');
      doc.text('Soma das áreas', cols[0], c.y);
      doc.text(m2(total), cols[3], c.y);
      c.y += 15;
    }
    c.y += 4;
  }

  async function blocoItem(doc, c, item, indice, comFotos) {
    tituloSecao(doc, c, 'Item ' + (indice + 1) + ' · ' + nomeDoItem(item));
    gradeDados(doc, c, [
      ['Detalhe do serviço', item.detalheServico],
      ['Altura de instalação', item.alturaInstalacao ? item.alturaInstalacao + ' cm do chão até a base' : ''],
      ['Superfícies', (item.superficies || []).join(', ') + (item.superficieOutra ? ' (' + item.superficieOutra + ')' : '')],
      ['Observação do item', item.obs]
    ]);
    tabelaMedidas(doc, c, item);
    if (comFotos) {
      const rotulos = { fachada: 'Geral da fachada', close: 'Close da superfície', escala: 'Referência de escala', atual: 'Peça atual' };
      const fotos = (item.fotos || []).map(f => ({ ...f, legenda: rotulos[f.tipo] || 'Foto' }));
      if (fotos.length) await fotosEmGrade(doc, c, fotos, 2);
    }
    c.y += 4;
  }

  function obsGeraisPares(b) {
    const o = b.obsGerais || {};
    return [
      ['Energia próxima', o.energia === 'sim' ? 'Sim' + (o.energiaOnde ? ' (' + o.energiaOnde + ')' : '') + (o.voltagem ? ' · ' + o.voltagem : '') : (o.energia === 'nao' ? 'Não' : '')],
      ['Obstáculos', (o.obstaculos || []).join(', ') + (o.obstaculoOutro ? ' (' + o.obstaculoOutro + ')' : '')],
      ['Equipamento', o.equipamento ? o.equipamento + (o.equipamentoDetalhe ? ' (' + o.equipamentoDetalhe + ')' : '') : ''],
      ['Ponto', o.pontoTipo],
      ['Serviços extras', (o.servicosExtras || []).join(', ')],
      ['Prazo desejado', o.prazo],
      ['Arte em alta resolução', o.arteAlta], ['Projeto 3D', o.projeto3D],
      ['Budget', o.budget], ['Forma de pagamento', o.formaPagamento],
      ['Equipe estimada', o.equipeInstalacao], ['Tempo de execução', o.tempoExecucao],
      ['Briefing do cliente', o.briefingCliente]
    ];
  }

  // ── PDF do briefing completo ──────────────────────────────────────────────
  async function briefingCompleto(b) {
    const doc = novoDoc();
    const c = criarCursor(doc);
    cabecalho(doc, c, 'BRIEF DE MEDIÇÃO', fmtDataLocal(b.dataHora));

    tituloSecao(doc, c, 'Cliente e visita');
    gradeDados(doc, c, metaVisita(b));

    tituloSecao(doc, c, 'Local');
    gradeDados(doc, c, [
      ['Endereço', b.endereco], ['Estabelecimento', b.estabelecimento],
      ['Ponto de referência', b.pontoReferencia],
      ['GPS', b.geo ? b.geo.lat.toFixed(6) + ', ' + b.geo.lng.toFixed(6) : '']
    ]);

    for (let i = 0; i < (b.itens || []).length; i++) {
      await blocoItem(doc, c, b.itens[i], i, true);
    }

    const croquisVivos = (b.croquis || []);
    if (croquisVivos.length) {
      tituloSecao(doc, c, 'Desenhos da visita (croquis)');
      await fotosEmGrade(doc, c, croquisVivos.map((x, i) => ({ ...x, legenda: 'Desenho ' + (i + 1) })), 1);
    }

    tituloSecao(doc, c, 'Observações gerais');
    gradeDados(doc, c, obsGeraisPares(b));

    c.garantir(30);
    doc.setFont('Spectral'); doc.setFontSize(8.5); doc.setTextColor(...CINZA);
    doc.text('Gerado em ' + fmtDataHoraLocal(new Date().toISOString()) + ' por ' + ((STORE.getUser() || {}).nome || ''), M, c.y + 8);

    fecharDocumento(doc, 'Brief de Medição · ' + (b.cliente || '') + (String(b.osNumero || '').trim() ? ' · O.S. ' + b.osNumero : ''));
    doc.save('briefing-' + nomeArquivo(b.cliente) + (String(b.osNumero || '').trim() ? '-os' + b.osNumero : '') + '.pdf');
  }

  // ── PDF de um item específico (pra produção ou cliente) ───────────────────
  async function itemUnico(b, item) {
    const doc = novoDoc();
    const c = criarCursor(doc);
    const idx = Math.max(0, (b.itens || []).findIndex(i => i.id === item.id));
    cabecalho(doc, c, 'MEDIDA · ' + nomeDoItem(item).toUpperCase(), fmtDataLocal(b.dataHora));

    tituloSecao(doc, c, 'Referência');
    gradeDados(doc, c, [
      ['Cliente', b.cliente], ['Telefone', b.telefone],
      ['O.S.', String(b.osNumero || '').trim() || 'SEM O.S. por enquanto'], ['Tipo de medição', b.tipoMedicao],
      ['Endereço', b.endereco], ['Quem mediu', b.quemMediu]
    ]);
    if (b.tipoMedicao === 'Execução') {
      c.garantir(24);
      doc.setFillColor(254, 226, 226); doc.setDrawColor(252, 165, 165);
      doc.roundedRect(M, c.y - 10, LARG, 22, 5, 5, 'FD');
      doc.setFont('Poppins'); doc.setFontSize(9); doc.setTextColor(153, 27, 27);
      doc.text('MEDIDAS APROVADAS PRA EXECUÇÃO. CONFERIR ANTES DE PRODUZIR.', M + 10, c.y + 4);
      c.y += 24;
    }

    await blocoItem(doc, c, item, idx, true);

    fecharDocumento(doc, 'Item ' + (idx + 1) + ' · ' + (b.cliente || ''));
    doc.save('item-' + nomeArquivo(nomeDoItem(item)) + '-' + nomeArquivo(b.cliente) + '.pdf');
  }

  // ── Ficha de visita pra imprimir (desenho a mão continua no papel) ───────
  async function fichaVisita(b) {
    const doc = novoDoc();
    const o = (b && b.obsGerais) || {};

    // Cabeçalho
    doc.setFillColor(...INDIGO);
    doc.rect(0, 0, W, 58, 'F');
    doc.setFont('Poppins'); doc.setTextColor(255, 255, 255); doc.setFontSize(17);
    doc.text('FICHA DE VISITA TÉCNICA', M, 30);
    doc.setFontSize(8.5);
    doc.text('Impresilk · Soluções Visuais', M, 44);
    doc.setFontSize(9);
    doc.text('Brief de Medição', W - M, 30, { align: 'right' });

    let y = 78;
    const linhaCampo = (rotulo, valor, x, largTotal, largRotulo) => {
      doc.setFont('Poppins'); doc.setFontSize(7.6); doc.setTextColor(...TINTA);
      doc.text(rotulo, x, y);
      const xi = x + (largRotulo || doc.getTextWidth(rotulo) + 4);
      const xf = x + largTotal;
      doc.setDrawColor(...CINZA); doc.setLineWidth(0.6);
      doc.line(xi, y + 1.5, xf, y + 1.5);
      if (valor) {
        doc.setFont('Spectral', 'bold'); doc.setFontSize(9); doc.setTextColor(...INDIGO_ESCURO);
        doc.text(doc.splitTextToSize(String(valor), xf - xi - 4)[0] || '', xi + 3, y);
      }
    };
    const caixinha = (rotulo, x, marcado) => {
      doc.setDrawColor(...TINTA); doc.setLineWidth(0.8);
      doc.rect(x, y - 6.5, 7.5, 7.5);
      if (marcado) {
        doc.setFont('Poppins'); doc.setFontSize(8); doc.setTextColor(...INDIGO);
        doc.text('X', x + 1.6, y - 0.4);
      }
      doc.setFont('Poppins'); doc.setFontSize(7.4); doc.setTextColor(...TINTA);
      doc.text(rotulo, x + 10.5, y);
      return x + 10.5 + doc.getTextWidth(rotulo) + 12;
    };

    // Linha 1: data, vendedor, O.S.
    linhaCampo('DATA:', b ? fmtDataLocal(b.dataHora) : '', M, 118, 34);
    linhaCampo('VENDEDOR:', b ? b.vendedor : '', M + 128, 205, 58);
    linhaCampo('Nº O.S.:', b && String(b.osNumero || '').trim() ? b.osNumero : '', M + 343, 168, 44);
    y += 17;
    linhaCampo('EMPRESA:', b ? b.cliente : '', M, 300, 52);
    linhaCampo('RESPONSÁVEL:', b ? b.responsavel : '', M + 310, 201, 74);
    y += 17;
    linhaCampo('FONE:', b ? b.telefone : '', M, 190, 34);
    linhaCampo('QUEM MEDIU:', b ? b.quemMediu : '', M + 200, 311, 68);
    y += 17;
    linhaCampo('ENDEREÇO:', b ? b.endereco : '', M, LARG, 58);
    y += 17;
    linhaCampo('REFERÊNCIA:', b ? b.pontoReferencia : '', M, 300, 64);
    // Como conheceu
    let xc = M + 312;
    doc.setFont('Poppins'); doc.setFontSize(7.4); doc.setTextColor(...TINTA);
    doc.text('CONHECEU:', xc, y); xc += 50;
    ['Google', 'Instagram', 'Indicação'].forEach(op => { xc = caixinha(op, xc, b && b.comoConheceu === op); });
    y += 15;
    xc = M + 362;
    ['Facebook', 'Em instalação', 'Carro'].forEach(op => { xc = caixinha(op, xc, b && b.comoConheceu === op); });

    // Tipo de serviço
    y += 12;
    doc.setFillColor(...INDIGO_CLARO);
    doc.rect(M, y - 9, LARG, 15, 'F');
    doc.setFont('Poppins'); doc.setFontSize(8.5); doc.setTextColor(...INDIGO_ESCURO);
    doc.text('TIPO DE SERVIÇO', M + 6, y + 1.5);
    y += 17;
    xc = M;
    xc = caixinha('Tirar medida serviço novo', xc, b && b.naturezaServico === 'Serviço novo');
    xc = caixinha('Restauração / troca / remoção', xc, b && (b.naturezaServico === 'Restauração ou troca' || b.naturezaServico === 'Remoção'));
    xc = caixinha('Interno', xc, b && b.ambiente === 'Interno');
    xc = caixinha('Externo', xc, b && b.ambiente === 'Externo');

    // Colunas de serviços (checklist do papel)
    y += 14;
    const yColunas = y;
    const colunas = [
      { x: M, itens: ['FACHADA EM LONA', 'Estrutura + lona impressa', 'Estrutura + lona + adesivos', 'Troca de lona', 'ADESIVOS', 'Papel de parede', 'Vidros (jateado / perfurado)', 'Veículo parcial', 'Veículo total'] },
      { x: M + LARG / 3 + 4, itens: ['FACHADA ACM', 'ACM + adesivos', 'ACM + PVC expandido', 'ACM + letra galvanizada', 'ACM + acrílico', 'LETREIRO NA PAREDE', 'PVC expandido 10/20mm', 'PVC retroiluminado', 'Letra acrílica / galvanizada'] },
      { x: M + (LARG / 3) * 2 + 8, itens: ['LUMINOSO', 'Lona backlight (1 ou 2 faces)', 'ACM vazado', 'Backlight slim', 'APOIO', 'Escada (P / M / G)', 'Andaime (sapata / rodinha)', 'Munk', 'Energia (127v / 220v)'] }
    ];
    let yMax = yColunas;
    colunas.forEach(col => {
      y = yColunas;
      col.itens.forEach(item => {
        const ehTituloGrupo = item === item.toUpperCase();
        if (ehTituloGrupo) {
          doc.setFont('Poppins'); doc.setFontSize(7.6); doc.setTextColor(...INDIGO_ESCURO);
          doc.text(item, col.x, y);
        } else {
          caixinha(item, col.x, false);
        }
        y += 12.5;
      });
      yMax = Math.max(yMax, y);
    });
    y = yMax + 2;

    // Serviços extras em linha
    doc.setFont('Poppins'); doc.setFontSize(7.6); doc.setTextColor(...INDIGO_ESCURO);
    doc.text('EXTRAS:', M, y);
    xc = M + 36;
    ['Remoção adesivo', 'Remoção fachada', 'Pintura', 'Lixamento', 'Solda', 'Elétrica', 'Terceirizados'].forEach(sv => { xc = caixinha(sv, xc, false); });
    y += 13;
    xc = M + 36;
    ['Cantoneiras', 'Spot', 'Refletor', 'Telhado', 'Calha', 'Lâmpadas'].forEach(sv => { xc = caixinha(sv, xc, false); });

    // Área quadriculada de desenho
    y += 10;
    const yGrid = y;
    const hGrid = 700 - yGrid > 320 ? 700 - yGrid : 320;
    const yGridFim = yGrid + hGrid;
    doc.setFont('Spectral'); doc.setFontSize(7.6); doc.setTextColor(...CINZA);
    doc.text('Rascunhe aqui as medidas (largura × altura × profundidade), componentes extras e imprevistos. Se precisar, use o verso.', M, y - 2);
    // grade
    doc.setDrawColor(221, 223, 251); doc.setLineWidth(0.5);
    for (let gx = M; gx <= W - M + 0.1; gx += 14.2) doc.line(gx, yGrid + 2, gx, yGridFim);
    for (let gy = yGrid + 2; gy <= yGridFim + 0.1; gy += 14.2) doc.line(M, gy, W - M, gy);
    // marca d'água do logo
    try {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.06 }));
      const lw = 300;
      doc.addImage(PDF_LOGO, 'PNG', W / 2 - lw / 2, yGrid + hGrid / 2 - (lw * LOGO_PROP) / 2, lw, lw * LOGO_PROP);
      doc.restoreGraphicsState();
    } catch {}
    doc.setDrawColor(...INDIGO); doc.setLineWidth(1);
    doc.rect(M, yGrid + 2, LARG, hGrid - 2);

    // Rodapé da ficha
    y = yGridFim + 16;
    xc = M;
    doc.setFont('Poppins'); doc.setFontSize(7.4); doc.setTextColor(...TINTA);
    doc.text('Arte em alta:', xc, y); xc += 46;
    xc = caixinha('Sim', xc, b && o.arteAlta === 'Sim');
    xc = caixinha('Não', xc, b && o.arteAlta === 'Não');
    doc.text('Projeto 3D:', xc, y); xc += 42;
    xc = caixinha('Sim', xc, b && o.projeto3D === 'Sim');
    xc = caixinha('Não', xc, b && o.projeto3D === 'Não');
    doc.text('Budget:', xc, y); xc += 30;
    ['até 1 mil', '1 a 5 mil', '5 a 10 mil', '+10 mil'].forEach((fx, i) => {
      const marcado = b && o.budget && ['Até R$1.000', 'R$1.000 a R$5.000', 'R$5.000 a R$10.000', 'Acima de R$10.000'][i] === o.budget;
      xc = caixinha(fx, xc, marcado);
    });
    y += 16;
    linhaCampo('EQUIPE PRA INSTALAÇÃO:', b ? o.equipeInstalacao : '', M, 190, 106);
    linhaCampo('TEMPO ESTIMADO:', b ? o.tempoExecucao : '', M + 202, 172, 80);
    linhaCampo('PRAZO DO CLIENTE:', b ? o.prazo : '', M + 386, 125, 84);

    // Assinatura Impresilk
    const lw2 = 74;
    try { doc.addImage(PDF_LOGO, 'PNG', W - M - lw2, H - 34 - lw2 * LOGO_PROP, lw2, lw2 * LOGO_PROP); } catch {}
    doc.setFont('Poppins'); doc.setFontSize(6.8); doc.setTextColor(...CINZA);
    doc.text('Fotografe o desenho pronto e anexe no Brief de Medição (Desenhos da visita).', M, H - 26);

    doc.save(b ? 'ficha-visita-' + nomeArquivo(b.cliente || 'cliente') + '.pdf' : 'ficha-visita-em-branco.pdf');
  }

  return { briefingCompleto, itemUnico, fichaVisita };
})();
