// ⚠️ NÃO coloque token nenhum neste arquivo: ele é servido ao navegador e
// qualquer pessoa lê no código-fonte da página.
//
// Até 05/08/2026 havia aqui um `const TOKEN = '...'`, e era ele que autorizava
// os dados no servidor — as medições, os endereços e os telefones dos clientes
// saíam sem login para quem abrisse o código-fonte. Quem autoriza agora é o
// CRACHÁ da pessoa (store.js), assinado por um segredo que só o servidor
// conhece. O token antigo foi girado.

// Backend: Supabase (Edge Functions).
//
// Os nomes levam prefixo "brief-" porque o projeto do Supabase é compartilhado
// com o RH, que ficou com os nomes crus: uma function chamada "sync" seria a
// dele. O app continua pedindo 'os' e 'mubisys'; a tradução é aqui.
const API_BASE = 'https://heveemylixartyijxewh.supabase.co/functions/v1';
const API_FN = { os: 'brief-sync', mubisys: 'brief-mubisys' };
