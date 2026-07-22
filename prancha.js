// prancha.js — Gerador da prancha de layout da Impresilk (A4 paisagem).
//
// Mesmo modelo para os dois modos:
//   PRODUÇÃO — uma prancha por setor (Impressão, Recorte, Acabamento…)
//   PROJETO  — uma prancha por arte final aprovada (JPG)
//
// Desenhado direto em vetor com jsPDF (mesma base do resto do app): o texto sai
// nítido em qualquer ampliação da gráfica, coisa que uma captura de HTML não dá.
// Depende de libs/jspdf.umd.min.js e libs/pdf-assets.js (fontes + logo).

const PRANCHA = (() => {
  const INDIGO = [56, 64, 232];
  const INDIGO_ESCURO = [42, 48, 184];
  const LARANJA = [234, 88, 12];        // selo do serviço
  const TINTA = [23, 26, 51];
  const CINZA = [90, 94, 122];
  const CINZA_CLARO = [150, 154, 175];
  const BORDA = [200, 204, 226];
  const FUNDO_SUAVE = [244, 245, 251];

  // A4 paisagem
  const W = 841.89, H = 595.28, M = 22;
  const LARG = W - M * 2;
  const LOGO_PROP = 381 / 760;

  function novoDoc() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape', compress: true });
    doc.addFileToVFS('Poppins-SemiBold.ttf', PDF_FONTES['Poppins-SemiBold']);
    doc.addFont('Poppins-SemiBold.ttf', 'Poppins', 'normal');
    doc.addFileToVFS('Spectral-Regular.ttf', PDF_FONTES['Spectral-Regular']);
    doc.addFont('Spectral-Regular.ttf', 'Spectral', 'normal');
    doc.addFileToVFS('Spectral-SemiBold.ttf', PDF_FONTES['Spectral-SemiBold']);
    doc.addFont('Spectral-SemiBold.ttf', 'Spectral', 'bold');
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
  // Corta o texto na largura disponível, sem estourar a caixa
  function cortar(doc, texto, largura) {
    const t = String(texto == null ? '' : texto);
    if (!t) return '';
    return doc.splitTextToSize(t, largura)[0] || '';
  }

  // ── Um campo rotulado da faixa de dados ───────────────────────────────────
  function campo(doc, rotulo, valor, x, y, largura) {
    doc.setFont('Poppins', 'normal'); doc.setFontSize(5.6); doc.setTextColor(...CINZA_CLARO);
    doc.text(String(rotulo).toUpperCase(), x, y);
    doc.setFont('Spectral', 'bold'); doc.setFontSize(8.4); doc.setTextColor(...TINTA);
    doc.text(cortar(doc, valor || '', largura), x, y + 10);
  }

  // ── Cabeçalho ─────────────────────────────────────────────────────────────
  function cabecalho(doc, p, cfg) {
    const empresa = (cfg && cfg.empresa) || {};
    const TOPO = 74;

    // Faixa indigo com logo e contatos
    doc.setFillColor(...INDIGO);
    doc.rect(0, 0, W, TOPO, 'F');
    doc.setFillColor(...INDIGO_ESCURO);
    doc.rect(0, TOPO - 4, W, 4, 'F');

    // Logo sobre chapa branca (o logo é colorido, não vive bem sobre indigo)
    const lw = 116, lh = lw * LOGO_PROP;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(M, 12, lw + 14, lh + 12, 5, 5, 'F');
    try { doc.addImage(PDF_LOGO, 'PNG', M + 7, 18, lw, lh); } catch {}

    // Contatos da empresa, duas colunas enxutas
    const contatos = [
      ['Instagram', empresa.instagram], ['WhatsApp', empresa.whatsapp],
      ['Telefone', empresa.telefone], ['E-mail', empresa.email]
    ].filter(c => c[1]);
    doc.setTextColor(255, 255, 255);
    let cx = M + lw + 34;
    contatos.forEach((c, i) => {
      const col = i % 2, lin = Math.floor(i / 2);
      doc.setFont('Poppins', 'normal'); doc.setFontSize(5.6);
      doc.text(c[0].toUpperCase(), cx + col * 118, 24 + lin * 20);
      doc.setFontSize(8);
      doc.text(cortar(doc, c[1], 112), cx + col * 118, 34 + lin * 20);
    });
    if (empresa.endereco) {
      doc.setFont('Poppins', 'normal'); doc.setFontSize(5.6);
      doc.text('ENDEREÇO', cx, 64);
      doc.setFontSize(7.6);
      doc.text(cortar(doc, empresa.endereco, 236), cx, 71.5);
    }

    // Selo laranja do serviço, em destaque à direita
    const selo = String(p.seloServico || p.setor || '').toUpperCase();
    if (selo) {
      doc.setFont('Poppins', 'normal'); doc.setFontSize(15);
      const largSelo = Math.max(120, doc.getTextWidth(selo) + 34);
      doc.setFillColor(...LARANJA);
      doc.roundedRect(W - M - largSelo, 16, largSelo, 30, 6, 6, 'F');
      doc.setTextColor(255, 255, 255);
      doc.text(selo, W - M - largSelo / 2, 36, { align: 'center' });
    }

    // Numeração da prancha e O.S., logo abaixo do selo
    doc.setFont('Poppins', 'normal'); doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    const numero = p2(p.numero || 1) + '/' + p2(p.total || 1);
    const os = String(p.osNumero || '').trim() || 'S/N';
    doc.text('PRANCHA ' + numero + '     O.S. ' + os, W - M, 60, { align: 'right' });

    return TOPO;
  }

  // ── Faixa de dados do serviço ─────────────────────────────────────────────
  function faixaDados(doc, p, cfg, y) {
    const ALT = 40;
    doc.setFillColor(...FUNDO_SUAVE);
    doc.rect(0, y, W, ALT, 'F');
    doc.setDrawColor(...BORDA); doc.setLineWidth(0.6);
    doc.line(0, y + ALT, W, y + ALT);

    // 5 colunas: cliente, contato, vendedor, designer, entrega
    const col = LARG / 5;
    const base = y + 16;
    campo(doc, 'Cliente', p.cliente, M, base, col - 12);
    campo(doc, 'Contato', p.contato, M + col, base, col - 12);
    campo(doc, 'Vend.', p.vendedor, M + col * 2, base, col - 12);
    campo(doc, 'Designer', p.designer, M + col * 3, base, col - 12);
    campo(doc, 'Data', fmtData(p.data), M + col * 4, base, (col - 12) / 2 - 4);
    campo(doc, 'Entrega', p.dataEntrega ? fmtData(p.dataEntrega) : '—', M + col * 4 + (col - 12) / 2, base, (col - 12) / 2);
    return y + ALT;
  }

  // ── Linha de endereço e observação ────────────────────────────────────────
  function linhaEndereco(doc, p, y) {
    const ALT = 26;
    doc.setDrawColor(...BORDA); doc.setLineWidth(0.6);
    doc.line(0, y + ALT, W, y + ALT);
    doc.setFont('Poppins', 'normal'); doc.setFontSize(5.6); doc.setTextColor(...CINZA_CLARO);
    doc.text('ENDEREÇO', M, y + 10);
    doc.setFont('Spectral', 'normal'); doc.setFontSize(8); doc.setTextColor(...TINTA);
    doc.text(cortar(doc, p.endereco || '', LARG * 0.52), M + 48, y + 10);

    doc.setFont('Poppins', 'normal'); doc.setFontSize(5.6); doc.setTextColor(...CINZA_CLARO);
    doc.text('OBS', M + LARG * 0.58, y + 10);
    doc.setFont('Spectral', 'normal'); doc.setFontSize(8); doc.setTextColor(...TINTA);
    doc.text(cortar(doc, p.obs || '', LARG * 0.36), M + LARG * 0.58 + 24, y + 10);

    // Linha pontilhada pra escrever à mão quando a obs vem vazia
    if (!p.obs) {
      doc.setDrawColor(...BORDA);
      doc.line(M + LARG * 0.58 + 24, y + 12, W - M, y + 12);
    }
    doc.setFont('Poppins', 'normal'); doc.setFontSize(5.2); doc.setTextColor(...CINZA_CLARO);
    doc.text(cortar(doc, p.textoDireitos || '', LARG), M, y + 21);
    return y + ALT;
  }

  // ── Rodapé: equipe, ferramentas e acessórios ──────────────────────────────
  function tabelaRodape(doc, titulo, colunas, linhas, x, y, largura, altura) {
    doc.setDrawColor(...BORDA); doc.setLineWidth(0.6);
    doc.roundedRect(x, y, largura, altura, 4, 4, 'S');

    // Cabeça
    doc.setFillColor(...FUNDO_SUAVE);
    doc.roundedRect(x, y, largura, 15, 4, 4, 'F');
    doc.rect(x, y + 9, largura, 6, 'F');
    doc.setFont('Poppins', 'normal'); doc.setFontSize(6.4); doc.setTextColor(...INDIGO_ESCURO);
    doc.text(titulo.toUpperCase(), x + 6, y + 10.5);

    const temQtd = colunas > 1;
    const xQtd = x + largura - 34;
    if (temQtd) {
      doc.setFontSize(5.4); doc.setTextColor(...CINZA_CLARO);
      doc.text('QTD', xQtd + 4, y + 10.5);
    }

    // Linhas (preenchidas ou em branco pra escrever à mão)
    const alturaLinha = 14;
    const quantas = Math.max(0, Math.floor((altura - 15) / alturaLinha));
    for (let i = 0; i < quantas; i++) {
      const ly = y + 15 + i * alturaLinha;
      if (i > 0) { doc.setDrawColor(...BORDA); doc.line(x, ly, x + largura, ly); }
      const item = linhas[i];
      if (item) {
        doc.setFont('Spectral', 'normal'); doc.setFontSize(7.6); doc.setTextColor(...TINTA);
        doc.text(cortar(doc, item.nome || item, largura - (temQtd ? 44 : 12)), x + 6, ly + 9.5);
        if (temQtd && item.qtd) {
          doc.setFont('Spectral', 'bold');
          doc.text(String(item.qtd), xQtd + 10, ly + 9.5);
        }
      }
    }
    if (temQtd) { doc.setDrawColor(...BORDA); doc.line(xQtd, y, xQtd, y + altura); }
  }

  function rodape(doc, p, y) {
    const alturaBloco = H - y - M;
    const gap = 10;
    const larg = (LARG - gap * 2) / 3;
    tabelaRodape(doc, 'Equipe de instalação', 1, (p.equipe || []), M, y, larg, alturaBloco);
    tabelaRodape(doc, 'Ferramentas', 2, (p.ferramentas || []), M + larg + gap, y, larg, alturaBloco);
    tabelaRodape(doc, 'Acessórios', 2, (p.acessorios || []), M + (larg + gap) * 2, y, larg, alturaBloco);
  }

  // ── Corpo: imagem em destaque + título do serviço ─────────────────────────
  async function corpo(doc, p, yTopo, yBase) {
    const altura = yBase - yTopo;
    const largTitulo = LARG * 0.30;
    const xImg = M + largTitulo + 14;
    const largImg = LARG - largTitulo - 14;

    // Título grande do serviço, à esquerda
    const titulo = String(p.tituloServico || '').toUpperCase();
    if (titulo) {
      doc.setFont('Poppins', 'normal'); doc.setTextColor(...TINTA);
      let fs = 26;
      doc.setFontSize(fs);
      let linhas = doc.splitTextToSize(titulo, largTitulo);
      while (linhas.length * fs * 1.14 > altura * 0.55 && fs > 12) {
        fs -= 1.5; doc.setFontSize(fs); linhas = doc.splitTextToSize(titulo, largTitulo);
      }
      doc.text(linhas, M, yTopo + 26);
      var yDepoisTitulo = yTopo + 26 + linhas.length * fs * 1.14;
    } else {
      var yDepoisTitulo = yTopo + 10;
    }

    // Medidas do item, quando a prancha veio de um briefing
    if (p.medidas) {
      doc.setFont('Poppins', 'normal'); doc.setFontSize(6); doc.setTextColor(...CINZA_CLARO);
      doc.text('MEDIDAS', M, yDepoisTitulo + 6);
      doc.setFont('Spectral', 'bold'); doc.setFontSize(12); doc.setTextColor(...INDIGO_ESCURO);
      const linhasMed = doc.splitTextToSize(String(p.medidas), largTitulo);
      doc.text(linhasMed.slice(0, 3), M, yDepoisTitulo + 20);
      yDepoisTitulo += 20 + linhasMed.slice(0, 3).length * 13;
    }
    if (p.detalhe) {
      doc.setFont('Spectral', 'normal'); doc.setFontSize(8.4); doc.setTextColor(...CINZA);
      doc.text(doc.splitTextToSize(String(p.detalhe), largTitulo).slice(0, 4), M, yDepoisTitulo + 12);
    }

    // Imagem em destaque, encaixada sem distorcer
    doc.setDrawColor(...BORDA); doc.setLineWidth(0.8);
    doc.roundedRect(xImg, yTopo, largImg, altura, 5, 5, 'S');
    if (p.imagem) {
      const dims = await medirImagem(p.imagem);
      const prop = dims ? dims.h / dims.w : 0.75;
      let w = largImg - 12, h = w * prop;
      if (h > altura - 12) { h = altura - 12; w = h / prop; }
      try {
        doc.addImage(p.imagem, 'JPEG', xImg + (largImg - w) / 2, yTopo + (altura - h) / 2, w, h, undefined, 'FAST');
      } catch {}
    } else {
      doc.setFont('Poppins', 'normal'); doc.setFontSize(9); doc.setTextColor(...CINZA_CLARO);
      doc.text('Sem imagem', xImg + largImg / 2, yTopo + altura / 2, { align: 'center' });
    }
  }

  // ── Desenha UMA prancha na página atual ───────────────────────────────────
  async function desenhar(doc, p, cfg) {
    let y = cabecalho(doc, p, cfg);
    y = faixaDados(doc, p, cfg, y);
    y = linhaEndereco(doc, { ...p, textoDireitos: (cfg && cfg.textoDireitos) || '' }, y);
    const alturaRodape = 92;
    await corpo(doc, p, y + 10, H - M - alturaRodape - 10);
    rodape(doc, p, H - M - alturaRodape);
  }

  // ── Gera o PDF com uma página por prancha ─────────────────────────────────
  // pranchas: lista já montada (ver montarPrancha em app.js)
  async function gerarPdf(pranchas, cfg) {
    const doc = novoDoc();
    for (let i = 0; i < pranchas.length; i++) {
      if (i > 0) doc.addPage('a4', 'landscape');
      await desenhar(doc, pranchas[i], cfg);
    }
    return doc;
  }

  return { gerarPdf, desenhar, novoDoc, W, H };
})();
