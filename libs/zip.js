// zip.js — Monta um .zip no próprio navegador, sem biblioteca externa.
//
// Serve pro designer baixar de uma vez todas as fotos de um briefing, com os
// nomes já organizados (item, tipo de foto). Os arquivos entram SEM compressão
// (método "store"): foto JPEG já vem comprimida, então zipar de novo só gastaria
// tempo do celular sem diminuir o tamanho.

const ZIP = (() => {
  const TABELA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // Data/hora no formato MS-DOS que o zip usa
  function dosDataHora(d) {
    const data = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    return { data: data & 0xFFFF, hora: hora & 0xFFFF };
  }

  function escritor(tamanho) {
    const buf = new Uint8Array(tamanho);
    let pos = 0;
    return {
      u16(v) { buf[pos++] = v & 0xFF; buf[pos++] = (v >>> 8) & 0xFF; },
      u32(v) { buf[pos++] = v & 0xFF; buf[pos++] = (v >>> 8) & 0xFF; buf[pos++] = (v >>> 16) & 0xFF; buf[pos++] = (v >>> 24) & 0xFF; },
      bytes(b) { buf.set(b, pos); pos += b.length; },
      get pos() { return pos; },
      buf
    };
  }

  // arquivos: [{ nome, dados: Uint8Array }] · quando: Date
  function criar(arquivos, quando) {
    const enc = new TextEncoder();
    const dt = dosDataHora(quando || new Date());
    const itens = arquivos.map(a => {
      const nome = enc.encode(a.nome);
      return { nome, dados: a.dados, crc: crc32(a.dados) };
    });

    const TAM_LOCAL = 30, TAM_CENTRAL = 46, TAM_FIM = 22;
    let total = TAM_FIM;
    for (const it of itens) total += TAM_LOCAL + it.nome.length + it.dados.length + TAM_CENTRAL + it.nome.length;

    const w = escritor(total);
    const offsets = [];

    // Cabeçalho local + conteúdo de cada arquivo
    for (const it of itens) {
      offsets.push(w.pos);
      w.u32(0x04034b50);
      w.u16(20);          // versão necessária
      w.u16(0x0800);      // nome em UTF-8
      w.u16(0);           // método 0 = sem compressão
      w.u16(dt.hora); w.u16(dt.data);
      w.u32(it.crc);
      w.u32(it.dados.length); // comprimido
      w.u32(it.dados.length); // original
      w.u16(it.nome.length);
      w.u16(0);           // sem campo extra
      w.bytes(it.nome);
      w.bytes(it.dados);
    }

    // Diretório central
    const inicioCentral = w.pos;
    itens.forEach((it, i) => {
      w.u32(0x02014b50);
      w.u16(20); w.u16(20);
      w.u16(0x0800);
      w.u16(0);
      w.u16(dt.hora); w.u16(dt.data);
      w.u32(it.crc);
      w.u32(it.dados.length);
      w.u32(it.dados.length);
      w.u16(it.nome.length);
      w.u16(0); w.u16(0);  // extra, comentário
      w.u16(0);            // disco
      w.u16(0); w.u32(0);  // atributos
      w.u32(offsets[i]);
      w.bytes(it.nome);
    });
    const tamanhoCentral = w.pos - inicioCentral;

    // Fim do diretório central
    w.u32(0x06054b50);
    w.u16(0); w.u16(0);
    w.u16(itens.length); w.u16(itens.length);
    w.u32(tamanhoCentral);
    w.u32(inicioCentral);
    w.u16(0);

    return new Blob([w.buf], { type: 'application/zip' });
  }

  // "data:image/jpeg;base64,..." ou base64 puro → Uint8Array
  function base64ParaBytes(b64) {
    const limpo = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
    const bin = atob(limpo);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  return { criar, base64ParaBytes };
})();
