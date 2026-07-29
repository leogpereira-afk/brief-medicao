// prancha.js — Prancha técnica da Impresilk (A4 paisagem), fiel ao modelo em uso.
//
// Estrutura do modelo original:
//   cabeçalho em caixas (logo + contatos | cliente/contato/vend/designer/entrega |
//   selo colorido do setor + texto de direitos | data, prancha 01/01, Nº da O.S.),
//   barra vermelha de ATENÇÃO nos setores de produção,
//   corpo branco pro desenho, checklists do setor na lateral esquerda,
//   carimbo URGENTE e linhas de liberação no rodapé.
//
// Cada setor tem o SEU modelo (cor do selo e checklists), copiado das ordens que
// a empresa já usa. Desenhado em vetor com jsPDF: texto nítido na gráfica.

const PRANCHA = (() => {
  const PRETO = [0, 0, 0];
  const CINZA_TXT = [90, 90, 90];
  const BORDA = [0, 0, 0];
  const VERMELHO = [227, 6, 19];
  const AZUL_BARRA = [40, 48, 140];

  const W = 841.89, H = 595.28;
  const M = 8;                       // margem da folha
  const LOGO_PROP = 381 / 760;

  // ── Modelos por setor (cor do selo + checklists da ordem em uso) ──────────
  const T = (titulo, itens, colunas, opcoes) =>
    Object.assign({ titulo, itens, colunas: colunas || [] }, opcoes || {});

  const MODELOS = {
    'Instalação': {
      cor: [245, 130, 31], corTexto: [255, 255, 255],
      atencao: false, enderecoObs: true, rotuloData: 'Data:',
      tabelas: [
        T('SUPERFÍCIES', ['Alvenaria lisa', 'Alvenaria texturizada', 'Bloco de concreto', 'Tijolo furado',
          'Aço', 'ACM', 'Acrílico', 'PVC', 'Vidro', 'Drywall / Gesso', 'Telha', 'Pedra Natural',
          'Porcelanato', 'Outros:', 'Não se aplica']),
        T('ELÉTRICA / HIDRÁULICA', ['Fiação aparente', 'Fiação embutida', 'Energia 110V', 'Energia 220V',
          'Não há energia', 'Parede c/ tubulação']),
        T('EQUIPAMENTOS', ['Escada extensiva', 'Escada tesoura', 'Andaime', 'Munck', 'Plataforma', 'Guindaste'])
      ],
      rodape: null
    },
    'Router': {
      cor: [255, 194, 14], corTexto: [40, 40, 40],
      atencao: true, enderecoObs: false, rotuloData: 'Data:', dataInicioEntrega: true,
      tabelas: [
        T('MATERIAL', ['ACM', 'PVC EXP.', 'POLICARBONATO', 'MDF', 'ACRÍLICO', 'PS'], ['ESPESSURA']),
        T('ACABAMENTO', ['CORTE', 'REBAIXO', 'FRISAGEM'])
      ],
      rodape: 'tecnica-producao'
    },
    'Fibra letra caixa': {
      cor: [227, 6, 19], corTexto: [255, 255, 255],
      atencao: true, enderecoObs: false, rotuloData: 'Data Export:',
      tabelas: [
        T('MATERIAL', ['Galvanizada', 'Inox', 'Chapa preta'], ['TIPO', 'ESPESSURA']),
        T('MODELO', ['Cega', 'Retroiluminada', 'Iluminada']),
        T('VARIAÇÃO', ['Película Acrílica', 'Face Acrílica', 'Pintura Automotiva']),
        T('BORDA', ['3CM', '5CM', '7,5CM', '15CM']),
        T('ILUMINAÇÃO', ['Quente', 'Fria', 'Neutra'], ['TIPO', 'POTÊNCIA'])
      ],
      rodape: 'producao'
    },
    'Laser C02': {
      cor: [27, 59, 139], corTexto: [255, 255, 255],
      atencao: true, enderecoObs: false, rotuloData: 'Data Export:',
      tabelas: [
        T('FITA DUPLA FACE', ['MASSA BRANCA', 'VHB TRNSPA.', '3M', 'MANTA DUPLA FACE'], ['ESPESSURA', 'DIMENSÃO']),
        T('MATERIAL', ['Acrílico', 'MDF', 'Papel'], ['ESPESSURA', 'COR'])
      ],
      rodape: 'producao'
    },
    'Serralheria': {
      cor: [166, 166, 166], corTexto: [40, 40, 40],
      atencao: false, enderecoObs: false, rotuloData: 'Data:', endEntregaNoCabecalho: true,
      tabelas: [
        // Plano de corte: linhas EM BRANCO pra escrever o material. Antes vinham
        // três "Metalom" fixos e repetidos, que não diziam nada e ainda ocupavam
        // a coluna onde o serralheiro precisa escrever a peça.
        T('Plano de Corte', ['', '', '', ''], ['Chapa', 'DIM', 'Medida', 'QTD', 'Corte'], { semCheck: true }),
        // A 2ª coluna era '' (sem título): virava uma coluna fantasma na folha.
        T('Aço', ['Metalom 20x20', 'Metalom 20x30', 'Metalom 50x30', 'Alumínio 50x25', 'Perfil 50x25'], ['n°/ Barras'], {
          cores: [[64, 64, 64], [232, 62, 100], [46, 204, 154], [86, 74, 168], [237, 139, 47]], semCheck: true
        }),
        T('Suportes', ['Mão francesa', 'Suporte'], ['Medida', 'QTD'], { cores: [[41, 171, 226], [41, 171, 226]], semCheck: true })
      ],
      rodape: 'tecnica-producao'
    },
    'Impressão lona': {
      cor: [35, 31, 32], corTexto: [255, 255, 255],
      atencao: true, enderecoObs: false, rotuloData: 'Data Export:',
      tabelas: [
        T('LONA', ['Front', 'Back', 'Mesh', 'Titanium', 'Texturizada', '']),
        T('Variação', ['Brilho', 'Fosco']),
        T('ACABAMENTO', ['Sem Acabamento', 'Ilhós Total', 'Ilhós Localizado', 'Com Verniz', 'Bastão', 'Corda', 'Fita de Reforço']),
        T('ORIGEM MEDIDAS', ['CLIENTE', 'CONSULTOR', 'TÉCNICO']),
        T('Exportado Com:', ['MEDIDAS EXATAS', 'MEDIDAS C/ SOBRAS'])
      ],
      rodape: 'producao'
    },
    'Laser brindes': {
      cor: [160, 36, 143], corTexto: [255, 255, 255],
      atencao: true, enderecoObs: false, rotuloData: 'Data Export:',
      caixasSoltas: ['GRAVAÇÃO', 'DTF'],
      tabelas: [
        T('MATERIAL', ['KIT', 'COPO', 'CANECA', 'CANETA', 'MOLESQUINE', 'PLACA INOX', 'GARRAFA', ''], ['COR', 'MODELO'])
      ],
      rodape: 'producao'
    },
    'Impressão vinil': {
      cor: [35, 31, 32], corTexto: [255, 255, 255],
      atencao: true, enderecoObs: false, rotuloData: 'Data Export:',
      tabelas: [
        T('VINIL', ['Leitoso', 'Blockout', 'Transparente', 'Automotivo', 'Jateado', 'Perfurado', 'Refletivo', 'Parede']),
        T('COLORIDO', ['', '', ''], ['COR', 'MARCA'], { semCheck: true }),
        T('Variação', ['Brilho', 'Fosco']),
        T('ACABAMENTO', ['Sem Acabamento', 'Recorte e Máscara', 'Recorte e Cartela', 'Recorte', 'Refile', 'Com Verniz', 'Laminado', 'Espelhado']),
        T('ORIGEM MEDIDAS', ['CLIENTE', 'CONSULTOR', 'TÉCNICO']),
        T('Exportado com:', ['MEDIDAS EXATAS', 'MEDIDAS C/ SOBRAS'])
      ],
      rodape: 'producao'
    },
    'Impressão UV': {
      cor: [0, 166, 81], corTexto: [255, 255, 255],
      atencao: true, enderecoObs: false, rotuloData: 'Data Export:',
      tabelas: [
        T('PS', ['2MM', '3MM']),
        T('MDF', ['3MM', '6MM', '10MM', '15MM']),
        T('ACRÍLICO', ['', '', ''], ['COR', 'ESPESSURA'], { semCheck: true }),
        T('MATERIAL DIVERSOS', ['', '', ''], ['MATERIAL', 'ESPESSURA'], { semCheck: true }),
        T('MODELO DE IMPRESSÃO', ['COLORIDO', 'COLORIDO INVERTIDO', 'COLORIDO INVERTIDO + BRANCO',
          'COLORIDO DUPLA FACE', 'COLORIDO DUPLA FACE + BRANCO', 'BRANCO + IMPRESSÃO COLORIDA',
          'BRANCO', 'COLORIDO INVERTIDO + ADESIVO BRANCO'])
      ],
      rodape: 'producao'
    },
    'Ploter papel outdoor': {
      cor: [245, 130, 31], corTexto: [255, 255, 255],
      atencao: true, enderecoObs: false, rotuloData: 'Data:',
      tabelas: [],
      rodape: 'comercial-producao'
    }
  };

  // Setor sem modelo próprio cai neste (só o cabeçalho e o corpo limpo)
  const MODELO_PADRAO = {
    cor: [56, 64, 232], corTexto: [255, 255, 255],
    atencao: false, enderecoObs: true, rotuloData: 'Data:', tabelas: [], rodape: 'producao'
  };

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  // ── Fichas configuráveis pelo admin ───────────────────────────────────────
  // Os modelos acima (MODELOS) são o PADRÃO de fábrica. O admin pode sobrescrever
  // em cfg.fichasSetores (sincronizado como o resto da config). Guarda cor em hex
  // e um formato simples de tabela; aqui convertemos pro que o desenho espera.
  function hexParaRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  }
  function rgbParaHex(rgb) {
    if (!Array.isArray(rgb)) return '#384018';
    return '#' + rgb.slice(0, 3).map(n => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0')).join('');
  }
  // Texto branco sobre selo escuro, preto sobre claro (luminância).
  function corTextoDe(rgb) {
    const [r, g, b] = rgb || [0, 0, 0];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b);
    return lum > 150 ? [40, 40, 40] : [255, 255, 255];
  }
  // Junta a versão do admin por cima do padrão do setor.
  function mesclarSetor(base, ov) {
    const cor = ov.cor ? (hexParaRgb(ov.cor) || base.cor) : base.cor;
    return {
      ...base,
      // Flags de layout do cabeçalho (Data Export, Data Início/ENTREGA, End+
      // Entrega, linha de endereço/obs). O editor não mostra, mas o round-trip
      // carrega: sem isto, RENOMEAR um setor de fábrica perdia o cabeçalho
      // especial dele (o override não casava mais nenhum modelo e caía no padrão).
      rotuloData: ov.rotuloData !== undefined ? ov.rotuloData : base.rotuloData,
      dataInicioEntrega: ov.dataInicioEntrega !== undefined ? ov.dataInicioEntrega : base.dataInicioEntrega,
      endEntregaNoCabecalho: ov.endEntregaNoCabecalho !== undefined ? ov.endEntregaNoCabecalho : base.endEntregaNoCabecalho,
      enderecoObs: ov.enderecoObs !== undefined ? ov.enderecoObs : base.enderecoObs,
      cor,
      corTexto: ov.cor ? corTextoDe(cor) : base.corTexto,
      atencao: ov.atencao != null ? !!ov.atencao : base.atencao,
      rodape: ov.rodape !== undefined ? (ov.rodape || null) : base.rodape,
      caixasSoltas: Array.isArray(ov.caixasSoltas) ? ov.caixasSoltas.filter(Boolean) : base.caixasSoltas,
      tabelas: Array.isArray(ov.tabelas)
        ? ov.tabelas.map(t => {
            const nt = {
              titulo: t.titulo || '',
              itens: (t.itens || []).map(x => String(x == null ? '' : x)),
              colunas: (t.colunas || []).filter(Boolean),
              semCheck: !!t.semCheck
            };
            // Cores de linha (Serralheria) são um array casado por POSIÇÃO com
            // os itens. Se o admin mexeu nos itens e a contagem não bate mais,
            // a cor iria pra linha errada -- melhor não pintar do que pintar
            // "Alumínio" com a cor do "Metalom".
            if (t.cores && t.cores.length === nt.itens.length) nt.cores = t.cores;
            return nt;
          })
        : base.tabelas
    };
  }
  // Mapa efetivo: padrão + overrides do admin (inclusive setores novos), menos
  // os que o admin apagou. Sem essa lista de apagados, um setor de fábrica
  // removido no editor voltava sozinho no próximo carregamento (o padrão sempre
  // semeava o mapa) -- e ainda carimbava a ficha completa de fábrica.
  function todosModelos(cfg) {
    const out = {};
    const apagados = (cfg && Array.isArray(cfg.fichasApagadas)) ? cfg.fichasApagadas.map(norm) : [];
    Object.keys(MODELOS).forEach(k => { if (!apagados.includes(norm(k))) out[k] = MODELOS[k]; });
    const custom = cfg && cfg.fichasSetores;
    if (custom && typeof custom === 'object') {
      Object.keys(custom).forEach(k => {
        if (!k) return;
        out[k] = mesclarSetor(out[k] || MODELO_PADRAO, custom[k] || {});
      });
    }
    return out;
  }
  function modeloDe(nome, cfg) {
    if (!nome) return MODELO_PADRAO;
    const models = todosModelos(cfg);
    const chave = Object.keys(models).find(k => norm(k) === norm(nome));
    return chave ? models[chave] : MODELO_PADRAO;
  }

  // ── Base do documento ─────────────────────────────────────────────────────
  function novoDoc() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape', compress: true });
    doc.addFileToVFS('Poppins-SemiBold.ttf', PDF_FONTES['Poppins-SemiBold']);
    doc.addFont('Poppins-SemiBold.ttf', 'Poppins', 'bold');
    if (PDF_FONTES['Poppins-Regular']) {
      doc.addFileToVFS('Poppins-Regular.ttf', PDF_FONTES['Poppins-Regular']);
      doc.addFont('Poppins-Regular.ttf', 'Poppins', 'normal');
    } else {
      doc.addFont('Poppins-SemiBold.ttf', 'Poppins', 'normal');
    }
    return doc;
  }

  function p2(n) { return String(n).padStart(2, '0'); }
  function fmtData(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function medirImagem(dataUrl) {
    return new Promise(res => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth || 4, h: im.naturalHeight || 3 });
      im.onerror = () => res(null);
      im.src = dataUrl;
    });
  }
  function cortar(doc, texto, largura) {
    const t = String(texto == null ? '' : texto);
    return t ? (doc.splitTextToSize(t, largura)[0] || '') : '';
  }

  // Escreve centralizado ENCOLHENDO até caber, em vez de cortar no meio.
  // "COLORIDO DUPLA FACE + BRANCO" virava "COLORIDO DUPLA FACE +" na folha da
  // produção -- o mesmo item, sem a tinta branca. Corte só como último recurso.
  function textoQueCabe(doc, texto, xCentro, y, largura, fsInicial, fsMin) {
    const t = String(texto == null ? '' : texto);
    if (!t) return;
    let fs = fsInicial;
    doc.setFontSize(fs);
    while (doc.getTextWidth(t) > largura && fs > (fsMin || 4.6)) {
      fs -= 0.2; doc.setFontSize(fs);
    }
    doc.text(doc.getTextWidth(t) > largura ? cortar(doc, t, largura) : t, xCentro, y, { align: 'center' });
    doc.setFontSize(fsInicial);
  }
  function caixa(doc, x, y, w, h) {
    doc.setDrawColor(...BORDA); doc.setLineWidth(0.8);
    doc.rect(x, y, w, h);
  }
  // "Rótulo: valor" dentro de uma caixa. O valor NUNCA é cortado no meio: encolhe
  // até caber (nome de cliente e endereço cortados mandavam o instalador pro
  // lugar errado e a produção pro material errado).
  // `maxLinhas` (2 para cliente/contato/endereço): quando o texto não cabe num
  // corpo ainda legível, ele QUEBRA em duas linhas em vez de encolher até virar
  // formiga ou ser cortado. Razão social longa ("... Sao Jose LTDA ME") saía
  // cortada em "... Construcao Sao", e endereço cortado manda o instalador pro
  // lugar errado.
  function rotuloValor(doc, rotulo, valor, x, y, larguraCaixa, tamRotulo, tamValor, maxLinhas) {
    const tam = tamRotulo || 10;
    doc.setFont('Poppins', 'normal'); doc.setFontSize(tam); doc.setTextColor(...PRETO);
    doc.text(rotulo, x, y);
    const xv = x + doc.getTextWidth(rotulo) + 6;
    const disp = Math.max(10, larguraCaixa - (xv - x) - 6);
    const txt = String(valor == null ? '' : valor);
    if (!txt) return;
    const nMax = maxLinhas || 1;
    // Com duas linhas disponíveis, para de encolher enquanto ainda dá pra ler.
    const fsMin = nMax > 1 ? 7 : 5.5;
    let fs = tamValor || tam;
    doc.setFontSize(fs);
    while (doc.getTextWidth(txt) > disp && fs > fsMin) { fs -= 0.3; doc.setFontSize(fs); }
    doc.setTextColor(...CINZA_TXT);
    if (doc.getTextWidth(txt) <= disp) { doc.text(txt, xv, y); return; }
    // Não coube numa linha: distribui em até nMax linhas, centradas na altura
    // original (senão a segunda linha invadiria a caixa de baixo).
    const linhas = doc.splitTextToSize(txt, disp).slice(0, nMax);
    const alturaLinha = fs + 1.4;
    const yTopo = y - (linhas.length - 1) * alturaLinha / 2;
    linhas.forEach((l, i) => doc.text(l, xv, yTopo + i * alturaLinha));
  }

  // ── Cabeçalho ─────────────────────────────────────────────────────────────
  function cabecalho(doc, p, cfg, modelo) {
    const empresa = (cfg && cfg.empresa) || {};
    const y0 = M, altura = 84, linha = altura / 3;
    const xLogo = M, wLogo = 218;
    const xMeio = xLogo + wLogo, wMeio = 328;
    const xSelo = xMeio + wMeio, wSelo = 152;
    const xDir = xSelo + wSelo, wDir = W - M - xDir;

    // Bloco do logo + contatos
    caixa(doc, xLogo, y0, wLogo, altura);
    const lw = 104, lh = lw * LOGO_PROP;
    try { doc.addImage(PDF_LOGO, 'PNG', xLogo + 6, y0 + (altura - lh) / 2 - 4, lw, lh); } catch {}
    const xc = xLogo + wLogo - 6;
    doc.setTextColor(...PRETO);
    let yc = y0 + 16;
    const contatos = [
      empresa.instagram && ('@' + String(empresa.instagram).replace(/^@/, '')),
      empresa.whatsapp, empresa.telefone
    ].filter(Boolean);
    contatos.forEach(c => {
      doc.setFont('Poppins', 'normal'); doc.setFontSize(6.6);
      doc.text(cortar(doc, c, 104), xc, yc, { align: 'right' });
      yc += 9;
    });
    doc.setFontSize(5.2); doc.setTextColor(...CINZA_TXT);
    (empresa.endereco ? doc.splitTextToSize(empresa.endereco, 106).slice(0, 2) : []).forEach(l => {
      doc.text(l, xc, yc, { align: 'right' }); yc += 6.6;
    });
    if (empresa.email) { doc.text(cortar(doc, empresa.email, 106), xc, yc, { align: 'right' }); }

    // Bloco do meio: cliente/contato, vend/designer, entrega
    // Cliente ocupa mais espaço que contato: nome de empresa costuma ser longo
    const corte = wMeio * 0.56;
    caixa(doc, xMeio, y0, wMeio, linha);
    rotuloValor(doc, 'Cliente:', p.cliente, xMeio + 8, y0 + linha / 2 + 4, corte - 12, 10.5, 10.5, 2);
    // Telefone do cliente junto do contato: a equipe de rua liga direto do papel.
    // Quando NÃO há um responsável separado (o contato repetiria o nome da
    // empresa), mostra só o telefone -- senão o nome longo empurrava o número
    // pra fora do quadro, que é justamente o que a equipe precisa.
    const contatoNome = (p.contato && p.contato !== p.cliente) ? p.contato : '';
    const contatoTxt = [contatoNome, p.telefone].filter(Boolean).join('  ·  ');
    rotuloValor(doc, 'Contato:', contatoTxt, xMeio + corte, y0 + linha / 2 + 4, wMeio - corte - 10, 10.5, 10.5, 2);

    caixa(doc, xMeio, y0 + linha, wMeio, linha);
    rotuloValor(doc, 'Vend:', p.vendedor, xMeio + 8, y0 + linha * 1.5 + 4, corte - 12, 10.5);
    rotuloValor(doc, 'Designer:', p.designer, xMeio + corte, y0 + linha * 1.5 + 4, wMeio - corte - 10, 10.5);

    caixa(doc, xMeio, y0 + linha * 2, wMeio, linha);
    if (modelo.endEntregaNoCabecalho) {
      rotuloValor(doc, 'End:', p.endereco, xMeio + 8, y0 + linha * 2.5 + 4, wMeio * 0.52 - 10, 10.5, 10.5, 2);
      doc.setFont('Poppins', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...PRETO);
      doc.text('Entrega:', xMeio + wMeio * 0.55, y0 + linha * 2.5 + 4);
      doc.setTextColor(...VERMELHO);
      doc.text(fmtData(p.dataEntrega), xMeio + wMeio * 0.55 + 52, y0 + linha * 2.5 + 4);
    } else if (modelo.dataInicioEntrega) {
      rotuloValor(doc, 'Data Início:', p.dataInicio || '', xMeio + 8, y0 + linha * 2.5 + 4, wMeio * 0.45 - 10, 10.5);
      doc.setDrawColor(...BORDA); doc.line(xMeio + wMeio * 0.5, y0 + linha * 2, xMeio + wMeio * 0.5, y0 + altura);
      doc.setFont('Poppins', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...PRETO);
      doc.text('ENTREGA:', xMeio + wMeio * 0.5 + 8, y0 + linha * 2.5 + 4);
      doc.setTextColor(...VERMELHO);
      doc.text(fmtData(p.dataEntrega), xMeio + wMeio * 0.5 + 68, y0 + linha * 2.5 + 4);
    } else {
      rotuloValor(doc, 'Data de Entrega:', p.dataEntrega ? fmtData(p.dataEntrega) : '', xMeio + 8, y0 + linha * 2.5 + 4, wMeio - 16, 10.5);
    }

    // Selo do setor + texto de direitos
    const selo = String(p.seloServico || p.setor || '').toUpperCase();
    caixa(doc, xSelo, y0, wSelo, linha);
    if (selo) {
      doc.setFillColor(...(modelo.cor || MODELO_PADRAO.cor));
      doc.rect(xSelo + 0.4, y0 + 0.4, wSelo - 0.8, linha - 0.8, 'F');
      doc.setFont('Poppins', 'normal'); doc.setTextColor(...(modelo.corTexto || [255, 255, 255]));
      let fs = 12;
      doc.setFontSize(fs);
      const linhasSelo = doc.splitTextToSize(selo, wSelo - 10);
      while (linhasSelo.length > 2 && fs > 7) { fs -= 1; doc.setFontSize(fs); }
      const ls = doc.splitTextToSize(selo, wSelo - 10).slice(0, 2);
      const yBase = y0 + linha / 2 + (ls.length === 1 ? 4 : -1);
      ls.forEach((l, i) => doc.text(l, xSelo + wSelo / 2, yBase + i * (fs + 1), { align: 'center' }));
    }
    caixa(doc, xSelo, y0 + linha, wSelo, altura - linha);
    doc.setFont('Poppins', 'normal'); doc.setFontSize(4.9); doc.setTextColor(...PRETO);
    const direitos = (cfg && cfg.textoDireitos) || '';
    doc.splitTextToSize(direitos, wSelo - 10).slice(0, 6)
      .forEach((l, i) => doc.text(l, xSelo + wSelo - 5, y0 + linha + 8 + i * 6.2, { align: 'right' }));

    // Coluna da direita: data, prancha, O.S.
    const dirs = [
      [modelo.rotuloData || 'Data:', fmtData(p.data)],
      ['Prancha:', p2(p.numero || 1) + '/' + p2(p.total || 1)],
      ['Nº da OS:', String(p.osNumero || '').trim() || 'S/N']
    ];
    dirs.forEach((d, i) => {
      caixa(doc, xDir, y0 + linha * i, wDir, linha);
      const tam = (modelo.rotuloData === 'Data Export:' && i === 0) ? 8.6 : 10.5;
      rotuloValor(doc, d[0], d[1], xDir + 7, y0 + linha * i + linha / 2 + 4, wDir - 12, tam);
    });

    return y0 + altura;
  }

  // ── Barra de atenção / linha endereço e obs ───────────────────────────────
  function barraAtencao(doc, y) {
    const alt = 26, wRot = 300;
    doc.setFillColor(...VERMELHO);
    doc.rect(0, y, wRot, alt, 'F');
    doc.setFillColor(...AZUL_BARRA);
    doc.rect(wRot, y, W - wRot, alt, 'F');
    doc.setFont('Poppins', 'bold'); doc.setTextColor(255, 255, 255); doc.setFontSize(15);
    doc.text('A T E N Ç Ã O', wRot / 2, y + 18, { align: 'center' });
    // O aviso precisa caber inteiro na faixa azul: encolhe até caber
    const aviso = 'É obrigatório conferir se o tamanho do arquivo exportado corresponde ao tamanho especificado no layout.';
    const largDisp = W - wRot - 28;
    let fs = 10;
    doc.setFontSize(fs);
    while (doc.getTextWidth(aviso) > largDisp && fs > 6) { fs -= 0.2; doc.setFontSize(fs); }
    doc.text(aviso, wRot + 14, y + 17);
    return y + alt;
  }

  // Quantas linhas a obs precisa dentro de uma largura (máx. 3: acima disso o
  // corpo da prancha ficaria sem espaço pro desenho).
  function linhasObs(doc, texto, largura) {
    if (!texto) return [];
    doc.setFont('Poppins', 'normal'); doc.setFontSize(9);
    return doc.splitTextToSize(String(texto), largura).slice(0, 3);
  }

  // Desenha "Obs:" com quebra de linha de verdade. Antes era uma linha só que
  // encolhia até virar letra de formiga -- observação de instalação não cabe
  // em meia linha.
  function escreverObs(doc, texto, x, y, largura) {
    doc.setFont('Poppins', 'normal'); doc.setFontSize(9); doc.setTextColor(...PRETO);
    doc.text('Obs:', x, y);
    const xv = x + doc.getTextWidth('Obs:') + 6;
    const ls = linhasObs(doc, texto, largura - (xv - x));
    doc.setTextColor(...CINZA_TXT);
    ls.forEach((l, i) => doc.text(l, xv, y + i * 11));
  }

  function linhaEnderecoObs(doc, p, y) {
    const meio = W * 0.5;
    const nLinhas = Math.max(1, linhasObs(doc, p.obs, W - M - meio - 40).length);
    const alt = Math.max(26, 15 + nLinhas * 11);
    caixa(doc, M, y, meio - M, alt);
    caixa(doc, meio, y, W - M - meio, alt);
    rotuloValor(doc, 'Endereço:', p.endereco, M + 8, y + 17, meio - M - 20, 11, 11, 2);
    escreverObs(doc, p.obs, meio + 8, y + 15, W - M - meio - 20);
    return y + alt;
  }

  // Só a obs, largura inteira. Usada nos setores de produção (que têm a barra
  // de ATENÇÃO no lugar da linha de endereço) e só aparece quando há texto:
  // sem obs, a prancha continua idêntica ao modelo em uso.
  function linhaSoObs(doc, p, y) {
    if (!p.obs) return y;
    const nLinhas = Math.max(1, linhasObs(doc, p.obs, W - 2 * M - 40).length);
    const alt = Math.max(20, 12 + nLinhas * 11);
    caixa(doc, M, y, W - 2 * M, alt);
    escreverObs(doc, p.obs, M + 8, y + 14, W - 2 * M - 20);
    return y + alt;
  }

  // Visto do checklist. Desenhado em vetor (duas linhas) pra sair nítido na
  // gráfica e não depender de fonte com o caractere ✓.
  function visto(doc, x, y, tam) {
    const t = tam || 15;
    doc.setDrawColor(...VERMELHO); doc.setLineWidth(1.6);
    doc.line(x + t * 0.22, y + t * 0.52, x + t * 0.42, y + t * 0.74);
    doc.line(x + t * 0.42, y + t * 0.74, x + t * 0.80, y + t * 0.26);
    doc.setDrawColor(...BORDA); doc.setLineWidth(0.8);
  }

  // ── Tabela de checklist do setor ──────────────────────────────────────────
  // `dados` é o que o designer preencheu na prévia:
  //   { marcas:{i:true}, rotulos:{i:'texto'}, valores:{i:{j:'texto'}}, outros:'texto' }
  //
  // Quais linhas mostrar. Em modo COMPACTO (o designer marcou algo na prancha),
  // sai SÓ o que foi escolhido -- a prancha vira um resumo limpo e sobra espaço
  // pra arte. Sem nada marcado, sai a ficha em branco inteira (pra preencher à
  // mão). O campo "Outros:" (algo particular) entra como uma linha a mais.
  function linhasDaTabela(tab, dados, compacto) {
    const d = dados || {};
    const marcas = d.marcas || {}, rotulos = d.rotulos || {}, valores = d.valores || {};
    const temValor = i => valores[i] && Object.values(valores[i]).some(v => String(v || '').trim());
    // Tabela "só preencher" SEM colunas e com rótulos fixos não tem por onde ser
    // preenchida (nem caixa, nem campo). Se a filtrássemos no resumo, a lista
    // simplesmente sumiria da prancha -- então essas linhas sempre entram.
    const semOndePreencher = tab.semCheck && !(tab.colunas || []).length;
    const rows = [];
    (tab.itens || []).forEach((item, i) => {
      const livre = !item || /:$/.test(item);
      const escrito = String(rotulos[i] || '').trim();
      const incluir = !compacto || (tab.semCheck
        ? (escrito || temValor(i) || (semOndePreencher && !livre))
        : (marcas[i] || (livre && escrito) || temValor(i)));
      if (!incluir) return;
      const texto = escrito ? (item && /:$/.test(item) ? item + ' ' + escrito : escrito) : item;
      rows.push({ i, texto, cor: tab.cores && tab.cores[i], marcado: !!marcas[i] });
    });
    const outros = String(d.outros || '').trim();
    if (outros) rows.push({ i: 'outros', texto: 'Outros: ' + outros, cor: null, marcado: true });
    return rows;
  }

  function tabelaCheck(doc, tab, x, y, dados, compacto) {
    const d = dados || {};
    const valores = d.valores || {};
    const rows = linhasDaTabela(tab, dados, compacto);
    if (compacto && !rows.length) return null; // tabela sem nada marcado some no resumo
    const wCheck = tab.semCheck ? 0 : 15;
    const wRotulo = 128;
    const wCol = 62;
    const cols = tab.colunas || [];
    const largura = wCheck + wRotulo + cols.length * wCol;
    const hLinha = 13.5, hTitulo = 15;

    // Título
    caixa(doc, x, y, largura, hTitulo);
    doc.setFont('Poppins', 'normal'); doc.setFontSize(7.6); doc.setTextColor(...PRETO);
    doc.text(tab.titulo, x + wCheck + wRotulo / 2, y + 10.5, { align: 'center' });
    cols.forEach((c, i) => {
      const cx = x + wCheck + wRotulo + i * wCol;
      caixa(doc, cx, y, wCol, hTitulo);
      if (c) { doc.setFontSize(6.6); doc.text(c, cx + wCol / 2, y + 10, { align: 'center' }); }
    });

    let yy = y + hTitulo;
    rows.forEach((row) => {
      if (!tab.semCheck) {
        caixa(doc, x, yy, wCheck, hLinha);
        // No resumo, tudo que aparece está selecionado → visto. Na ficha em
        // branco, só o que o designer marcou.
        if (compacto || row.marcado) visto(doc, x, yy, hLinha);
      }
      if (row.cor) { doc.setFillColor(...row.cor); doc.rect(x + wCheck, yy, wRotulo, hLinha, 'F'); }
      caixa(doc, x + wCheck, yy, wRotulo, hLinha);
      if (row.texto) {
        doc.setFont('Poppins', 'normal');
        doc.setTextColor(...(row.cor ? [255, 255, 255] : PRETO));
        textoQueCabe(doc, row.texto, x + wCheck + wRotulo / 2, yy + 9.2, wRotulo - 8, 7.4, 5);
      }
      cols.forEach((c, j) => {
        const cx = x + wCheck + wRotulo + j * wCol;
        caixa(doc, cx, yy, wCol, hLinha);
        const v = row.i !== 'outros' && valores[row.i] && valores[row.i][j];
        if (v) {
          doc.setFont('Poppins', 'normal'); doc.setTextColor(...PRETO);
          textoQueCabe(doc, String(v), cx + wCol / 2, yy + 9.2, wCol - 6, 7.2, 5);
        }
      });
      yy += hLinha;
    });
    return { altura: yy - y, largura, nLinhas: rows.length };
  }

  // ── Carimbos ──────────────────────────────────────────────────────────────
  // Texto que sempre cabe dentro de um círculo de raio r
  function textoNoCirculo(doc, texto, x, y, r, fsInicial) {
    let fs = fsInicial;
    doc.setFontSize(fs);
    while (doc.getTextWidth(texto) > r * 1.7 && fs > 5) { fs -= 0.3; doc.setFontSize(fs); }
    doc.text(texto, x, y, { align: 'center' });
    return fs;
  }

  // Disco branco por trás do carimbo: ele fica EM CIMA da arte, e sobre uma
  // imagem escura o vermelho/azul sumia. A borda branca destaca sem tapar a peça.
  function fundoCarimbo(doc, x, y, r) {
    doc.setFillColor(255, 255, 255);
    doc.circle(x, y, r + 5, 'F');
  }

  function carimboUrgente(doc, x, y) {
    const r = 32;
    fundoCarimbo(doc, x, y, r);
    doc.setDrawColor(...VERMELHO); doc.setLineWidth(2.4);
    doc.circle(x, y, r, 'S');
    doc.setLineWidth(1);
    doc.circle(x, y, r - 4, 'S');
    doc.setFont('Poppins', 'bold'); doc.setTextColor(...VERMELHO);
    textoNoCirculo(doc, 'URGENTE!', x, y + 4, r - 4, 12);
  }

  function carimboEspelhado(doc, x, y) {
    const AZUL = [41, 171, 226];
    const r = 46;
    fundoCarimbo(doc, x, y, r);
    doc.setDrawColor(...AZUL); doc.setLineWidth(2.2);
    doc.circle(x, y, r, 'S');
    doc.setLineWidth(1.1);
    doc.circle(x, y, r - 10, 'S');
    doc.setFont('Poppins', 'bold'); doc.setTextColor(...AZUL);
    textoNoCirculo(doc, 'A R Q U I V O', x, y - 22, r - 6, 8.5);
    textoNoCirculo(doc, 'E S P E L H A D O', x, y + 33, r - 6, 8.5);
    doc.setDrawColor(...AZUL); doc.setLineWidth(1);
    doc.setLineDashPattern([2, 2], 0);
    doc.rect(x - 19, y - 11, 18, 22);
    doc.setLineDashPattern([], 0);
    doc.setFillColor(...AZUL);
    doc.rect(x + 2, y - 11, 18, 22, 'F');
  }

  // ── Rodapé de liberação ───────────────────────────────────────────────────
  function rodapeLiberacao(doc, tipo, y) {
    if (!tipo) return;
    doc.setFont('Poppins', 'normal'); doc.setFontSize(8); doc.setTextColor(...PRETO);
    const linha = (rotulo, x) => {
      doc.text(rotulo, x, y);
      const xi = x + doc.getTextWidth(rotulo) + 4;
      doc.setDrawColor(...PRETO); doc.setLineWidth(0.7);
      doc.line(xi, y + 1.5, xi + 108, y + 1.5);
      doc.text('DATA:', xi + 116, y);
      doc.line(xi + 148, y + 1.5, xi + 176, y + 1.5);
      doc.text('/', xi + 179, y);
      doc.line(xi + 184, y + 1.5, xi + 212, y + 1.5);
      doc.text('/', xi + 215, y);
      doc.line(xi + 220, y + 1.5, xi + 262, y + 1.5);
      return xi + 262;
    };
    if (tipo === 'comercial-producao') {
      const fim = linha('LIBERAÇÃO COMERCIAL:', M + 24);
      doc.line(fim + 16, y - 8, fim + 16, y + 4);
      linha('LIBERAÇÃO PRODUÇÃO:', fim + 32);
    } else if (tipo === 'producao') {
      linha('LIBERAÇÃO PRODUÇÃO:', W - M - 420);
    } else if (tipo === 'tecnica-producao') {
      // Duas caixinhas empilhadas, como no modelo
      const x = W / 2 - 60, alt = 13, larg = 168;
      [['LIBERAÇÃO TÉCNICA', 0], ['LIBERAÇÃO PRODUÇÃO', 1]].forEach(([rot, i]) => {
        caixa(doc, x, y - 18 + i * alt, 16, alt);
        caixa(doc, x + 16, y - 18 + i * alt, larg, alt);
        doc.setFontSize(7.4);
        doc.text(rot, x + 16 + larg / 2, y - 18 + i * alt + 9, { align: 'center' });
      });
    }
  }

  // Mesma chave usada no app: título normalizado (não a posição). Assim mexer
  // nas fichas no admin não faz a marcação de uma prancha antiga reaparecer na
  // tabela errada ao regerar.
  function chaveTabela(modelo, ti) {
    const tab = modelo && (modelo.tabelas || [])[ti];
    const t = tab && String(tab.titulo || '').trim();
    return t ? 't:' + norm(t) : String(ti);
  }
  function dadosDaTabela(ficha, modelo, ti) {
    const tabs = (ficha && ficha.tabelas) || {};
    return tabs[chaveTabela(modelo, ti)] || tabs[ti] || null; // [ti] = pranchas antigas
  }

  // A ficha desta prancha tem algo marcado NAS TABELAS QUE O SETOR AINDA TEM?
  // Considerar marcação órfã (de tabela que foi apagada no admin) fazia a
  // prancha entrar em modo resumo e sair com o corpo vazio.
  function fichaTemAlgo(ficha, modelo) {
    if (!ficha) return false;
    if (ficha.soltas && Object.values(ficha.soltas).some(Boolean)) return true;
    const temConteudo = (t) => {
      if (!t) return false;
      if (String(t.outros || '').trim()) return true;
      if (t.marcas && Object.values(t.marcas).some(Boolean)) return true;
      if (t.rotulos && Object.values(t.rotulos).some(v => String(v || '').trim())) return true;
      if (t.valores && Object.values(t.valores).some(col => Object.values(col || {}).some(v => String(v || '').trim()))) return true;
      return false;
    };
    return ((modelo && modelo.tabelas) || []).some((_, ti) => temConteudo(dadosDaTabela(ficha, modelo, ti)));
  }

  // ── Uma prancha ───────────────────────────────────────────────────────────
  async function desenhar(doc, p, cfg) {
    const modelo = modeloDe(p.seloServico || p.setor, cfg);
    const ficha = p.ficha || {};          // o que o designer marcou na prévia
    let y = cabecalho(doc, p, cfg, modelo);
    if (modelo.atencao) {
      y = barraAtencao(doc, y);
      // Setor de produção não tem linha de endereço; a obs, quando existe,
      // ganha uma faixa própria em vez de se perder.
      y = linhaSoObs(doc, p, y);
    } else if (modelo.enderecoObs) y = linhaEnderecoObs(doc, p, y);

    const yCorpo = y + 6;
    const yFimCorpo = H - 34;

    // Checklists do setor, na lateral esquerda. Quando não cabem numa coluna,
    // seguem numa SEGUNDA coluna ao lado.
    //
    // Antes havia um `break` aqui: a tabela que não coubesse simplesmente não
    // era desenhada. Impressão vinil tem 6 tabelas e só 4 saíam -- ORIGEM
    // MEDIDAS e "Exportado com:" sumiam da folha, levando junto o que o
    // designer tinha marcado nelas. Perder marcação em silêncio é pior do que
    // uma prancha apertada.
    // Modo COMPACTO: se o designer marcou qualquer coisa na ficha, a prancha
    // sai como RESUMO (só o marcado). Sem nada marcado, sai a ficha em branco
    // inteira pra preencher à mão. O resumo é o que sobra espaço pra arte.
    const compacto = fichaTemAlgo(ficha, modelo);

    const X0 = M + 4;
    const LIMITE_TABELAS = W * 0.58;   // depois disto não sobra corpo pro desenho
    let colX = X0;
    let yTab = yCorpo + 4;
    let larguraCol = 0;         // largura da coluna que está sendo preenchida
    let larguraTabelas = 0;     // quanto o bloco todo ocupa (pra afastar a arte)
    let yTabFundo = yCorpo + 4; // onde a tabela mais baixa termina

    (modelo.caixasSoltas || []).forEach((rot, i) => {
      const marcada = !!(ficha.soltas && ficha.soltas[i]);
      if (compacto && !marcada) return; // no resumo só entra a caixa marcada
      caixa(doc, colX, yTab, 16, 16);
      if (marcada) visto(doc, colX, yTab, 16);
      doc.setFont('Poppins', 'normal'); doc.setFontSize(8.4); doc.setTextColor(...PRETO);
      doc.text(rot, colX + 22, yTab + 11.5);
      yTab += 24;
      larguraCol = Math.max(larguraCol, 120);
    });

    const tabelas = modelo.tabelas || [];
    for (let ti = 0; ti < tabelas.length; ti++) {
      const tab = tabelas[ti];
      const dados = dadosDaTabela(ficha, modelo, ti);
      // Quantas linhas essa tabela vai desenhar (pra decidir a quebra de coluna).
      const nLinhas = linhasDaTabela(tab, dados, compacto).length;
      if (compacto && !nLinhas) continue; // tabela sem nada marcado some no resumo
      const alturaPrevista = 15 + nLinhas * 13.5;
      const comecouAColuna = yTab > yCorpo + 4;
      if (comecouAColuna && yTab + alturaPrevista > yFimCorpo - 6) {
        const proximoX = colX + larguraCol + 12;
        if (proximoX < LIMITE_TABELAS) {
          larguraTabelas = Math.max(larguraTabelas, proximoX - X0);
          colX = proximoX; yTab = yCorpo + 4; larguraCol = 0;
        }
      }
      const r = tabelaCheck(doc, tab, colX, yTab, dados, compacto);
      if (!r) continue;
      yTab += r.altura + 12;
      larguraCol = Math.max(larguraCol, r.largura);
      larguraTabelas = Math.max(larguraTabelas, colX - X0 + larguraCol);
      yTabFundo = Math.max(yTabFundo, yTab);   // onde as tabelas terminam
    }

    // Onde a arte entra. Duas situações:
    //  · tabelas ALTAS (Instalação, vinil): a arte fica ao lado, como sempre.
    //  · tabelas CURTAS (Serralheria, ou qualquer resumo enxuto): a arte DESCE e
    //    usa a largura inteira. Antes ela ficava espremida na coluna da direita
    //    e metade da folha saía vazia -- justo no setor em que o desenho técnico
    //    é o que mais importa.
    const alturaCorpo = yFimCorpo - yCorpo;
    // 0,6 = as tabelas usam menos de 60% da altura do corpo. Acima disso (ex.:
    // Instalação, com 27 linhas) a arte continua ao lado, senão ficaria achatada.
    const tabelasCurtas = larguraTabelas > 0 && (yTabFundo - yCorpo) < alturaCorpo * 0.6;
    const xArte = tabelasCurtas ? M + 8 : M + 8 + (larguraTabelas ? larguraTabelas + 16 : 0);
    const wArte = W - M - 8 - xArte;
    // Com as tabelas curtas o título fica ao lado delas (aproveita o topo) e a
    // arte começa abaixo de tudo.
    const yTopoArte = tabelasCurtas ? yTabFundo + 6 : yCorpo;
    const xTitulo = tabelasCurtas ? M + 8 + larguraTabelas + 16 : xArte;
    const wTitulo = W - M - 8 - xTitulo;
    const hArte = yFimCorpo - yTopoArte - 8;

    // O título e as medidas RESERVAM espaço antes da imagem entrar. Antes eram
    // desenhados por cima da arte (posição fixa), e o texto ficava ilegível em
    // cima do desenho -- justamente o que a produção precisa ler.
    const TIT_FS = 20, TIT_LH = TIT_FS + 4;
    let titLinhas = [];
    if (p.tituloServico) {
      doc.setFont('Poppins', 'bold'); doc.setFontSize(TIT_FS);
      titLinhas = doc.splitTextToSize(String(p.tituloServico).toUpperCase(), wTitulo).slice(0, 2);
    }
    // Com as tabelas curtas o título fica ao LADO delas, então não rouba altura
    // da arte; com as tabelas altas ele fica em cima da arte e reserva espaço.
    const altTitulo = (titLinhas.length && !tabelasCurtas) ? titLinhas.length * TIT_LH + 6 : 0;

    // Medidas: encolhe até TODAS as linhas caberem (medida cortada faz a
    // produção cortar material a menos).
    let medLinhas = [], medFs = 9;
    if (p.medidas) {
      doc.setFont('Poppins', 'normal');
      const alturaDisp = 96;
      doc.setFontSize(medFs);
      medLinhas = doc.splitTextToSize(String(p.medidas), wArte);
      while (medLinhas.length * (medFs + 2.4) > alturaDisp && medFs > 5) {
        medFs -= 0.4; doc.setFontSize(medFs);
        medLinhas = doc.splitTextToSize(String(p.medidas), wArte);
      }
    }
    const altMedidas = medLinhas.length ? medLinhas.length * (medFs + 2.4) + 8 : 0;

    // Título: ao lado das tabelas (curtas) ou no topo da coluna da arte (altas).
    if (titLinhas.length) {
      doc.setFont('Poppins', 'bold'); doc.setFontSize(TIT_FS); doc.setTextColor(...PRETO);
      titLinhas.forEach((l, i) => doc.text(l, xTitulo, yCorpo + TIT_FS + i * TIT_LH));
    }

    // A imagem fica no que sobrou ENTRE o título e as medidas.
    const yImg = yTopoArte + altTitulo;
    const hImg = Math.max(40, hArte - altTitulo - altMedidas);
    let xMedidas = xArte;   // as medidas acompanham a arte, não a margem
    if (p.imagem) {
      const dims = await medirImagem(p.imagem);
      const prop = dims ? dims.h / dims.w : 0.72;
      let w = wArte, h = w * prop;
      if (h > hImg) { h = hImg; w = h / prop; }
      const ix = xArte + (wArte - w) / 2, iy = yImg + (hImg - h) / 2;
      try { doc.addImage(p.imagem, 'JPEG', ix, iy, w, h, undefined, 'FAST'); } catch {}
      // Moldura fina: a arte fica com cara de peça, não de imagem solta na folha.
      doc.setDrawColor(...BORDA); doc.setLineWidth(0.8);
      doc.rect(ix, iy, w, h);
      xMedidas = ix;
    } else {
      // SEM arte a prancha é pra desenhar à mão: demarca a área com um quadro
      // pontilhado, em vez de deixar um vazio sem referência na folha.
      const mx = xArte + 4, my = yImg + 4;
      const mw = Math.max(60, wArte - 8), mh = Math.max(40, hImg - 8);
      doc.setDrawColor(190, 190, 190); doc.setLineWidth(0.8);
      doc.setLineDashPattern([4, 4], 0);
      doc.rect(mx, my, mw, mh);
      doc.setLineDashPattern([], 0);
      doc.setFont('Poppins', 'normal'); doc.setFontSize(8); doc.setTextColor(170, 170, 170);
      doc.text('espaço para o desenho', mx + mw / 2, my + mh / 2, { align: 'center' });
      xMedidas = mx;
    }

    // Medidas logo abaixo da arte, alinhadas com ela. Antes ficavam presas à
    // margem esquerda e apareciam soltas num canto, longe do desenho.
    if (medLinhas.length) {
      doc.setFont('Poppins', 'normal'); doc.setFontSize(medFs); doc.setTextColor(...CINZA_TXT);
      doc.text(medLinhas, xMedidas, yFimCorpo - 8 - medLinhas.length * (medFs + 2.4) + medFs);
    }

    // Carimbos são opcionais: só saem quando o designer marca na prévia
    if (p.urgente) carimboUrgente(doc, W - 78, yCorpo + 56);
    if (p.espelhado) carimboEspelhado(doc, W * 0.42, yFimCorpo - 130);
    rodapeLiberacao(doc, modelo.rodape, H - 14);
  }

  async function gerarPdf(pranchas, cfg) {
    const doc = novoDoc();
    for (let i = 0; i < pranchas.length; i++) {
      if (i > 0) doc.addPage('a4', 'landscape');
      await desenhar(doc, pranchas[i], cfg);
    }
    return doc;
  }

  // `setoresPadrao` = os de fábrica; `todosModelos(cfg)` = padrão + admin.
  // `hexParaRgb/rgbParaHex` ajudam o editor do admin a converter cor.
  return {
    gerarPdf, desenhar, novoDoc, modeloDe, todosModelos,
    modelosPadrao: MODELOS, setoresPadrao: Object.keys(MODELOS),
    hexParaRgb, rgbParaHex, W, H
  };
})();
