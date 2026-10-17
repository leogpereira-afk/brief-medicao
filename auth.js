// auth.js — o login da equipe, conferido no SERVIDOR.
//
// POR QUE ISTO EXISTE
// Até aqui, a conta de cada pessoa morava dentro do pacote de configuração que
// todo aparelho baixa (cfg.usuarios), com a SENHA EM TEXTO PURO, e a conferência
// acontecia aqui no navegador. Como o TOKEN que autoriza esse download vai no
// bundle público do site, qualquer pessoa que abrisse o endereço lia o usuário e
// a senha da equipe inteira. Agora a senha é PBKDF2 no banco, a conferência é do
// outro lado, e o que fica no aparelho é um CRACHÁ assinado.
//
// O CRACHÁ VALE 30 DIAS de propósito: o vendedor entra uma vez com internet e
// segue trabalhando na rua sem sinal. Ele não é conferido aqui (o aparelho não
// tem o segredo) — quem confere é o servidor. Aqui ele só destranca a tela,
// exatamente o mesmo grau de confiança de antes, com a diferença de que a senha
// não anda mais junto.

const AUTH = (() => {
  const URL_AUTH = API_BASE + '/equipe-auth';
  const SISTEMA = 'brief';
  const K_TOKEN = 'app_sync_cracha';

  const pegar = () => localStorage.getItem(K_TOKEN) || '';
  const guardar = t => { if (t) localStorage.setItem(K_TOKEN, t); };
  const esquecer = () => localStorage.removeItem(K_TOKEN);
  // O crachá agora também autoriza os DADOS (brief-sync), não só a tela.

  async function chamar(acao, corpo, comCracha) {
    const cab = { 'Content-Type': 'application/json' };
    if (comCracha) cab['Authorization'] = 'Bearer ' + pegar();
    const r = await fetch(URL_AUTH, {
      method: 'POST', headers: cab,
      body: JSON.stringify(Object.assign({ acao, sistema: SISTEMA }, corpo || {})),
    });
    let dados = {};
    try { dados = await r.json(); } catch { /* resposta sem corpo */ }
    if (!r.ok) throw Object.assign(new Error(dados.erro || ('HTTP ' + r.status)), { status: r.status, erro: dados.erro });
    return dados;
  }

  return {
    temCracha: () => !!pegar(),
    cracha: pegar,
    esquecer,

    async login(usuario, senha) {
      const r = await chamar('login', { usuario, senha });
      guardar(r.token);
      return r;
    },

    // O Painel grava o crachá; a identidade vem da validação no servidor.
    async restaurarSessaoPainel() {
      const token = pegar();
      const anterior = STORE.getUser();
      if (!token) { STORE.setUser(null); return { estado: 'painel' }; }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const marca = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
      const r = await this.eu();
      // Não aplicar resposta de um token anterior após logout/troca no Painel.
      if (pegar() !== token) return { estado: 'painel' };
      if (r === false) { esquecer(); STORE.setUser(null); return { estado: 'expirada' }; }
      if (r === null) {
        if (anterior?._painelMarca === marca && anterior._painelExp > Date.now() / 1000)
          return { estado: 'offline', usuario: anterior };
        return { estado: 'indisponivel' };
      }
      if (r.sistema !== 'brief' || !r.usuario || !['admin','designer','vendedor','medidor'].includes(r.papel)) {
        STORE.setUser(null); return { estado: 'sem-acesso' };
      }
      const usuario = { usuario: r.usuario, nome: r.nome || r.usuario, papel: r.papel,
        trocarSenha: r.trocarSenha === true || (anterior?.usuario === r.usuario && anterior.trocarSenha === true),
        _painelMarca: marca, _painelExp: r.exp };
      STORE.setUser(usuario);
      return { estado: 'ok', usuario };
    },

    // Confere o crachá com o servidor. Sem internet devolve null — e quem chama
    // decide seguir com o que já está no aparelho (é o caso do campo).
    async eu() {
      try { return await chamar('eu', {}, true); } catch (e) { return (e.status === 401 || e.status === 403) ? false : null; }
    },

    trocarMinhaSenha(senhaAtual, novaSenha) {
      return chamar('trocarMinhaSenha', { senhaAtual, novaSenha }, true);
    },

    listarContas() { return chamar('listarContas', {}, true); },
    salvarConta(c) { return chamar('salvarConta', c, true); },
    removerConta(usuario) { return chamar('removerConta', { usuario }, true); },
  };
})();
