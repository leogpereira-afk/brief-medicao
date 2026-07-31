// TOKEN — mesma string deve estar aqui E como variável de ambiente TOKEN no Netlify
// (Project settings → Environment variables → TOKEN = <sua-senha-secreta>).
// Atenção: este token vai para o navegador — é autenticação LEVE (barra curiosos,
// não ataque dirigido). Dados muito sensíveis pedem login validado no servidor.
const TOKEN = 'e745b3c735b68e76e0ed680f5842f2d19f52b8aad902b856';

// Backend: Supabase (Edge Functions). Antes eram Netlify Functions em
// /.netlify/functions/. O contrato das ações é o MESMO — só mudou o endereço.
//
// Os nomes levam prefixo "brief-" porque o projeto do Supabase é compartilhado
// com o RH, que ficou com os nomes crus: uma function chamada "sync" seria a
// dele. O app continua pedindo 'os' e 'mubisys'; a tradução é aqui.
const API_BASE = 'https://heveemylixartyijxewh.supabase.co/functions/v1';
const API_FN = { os: 'brief-sync', mubisys: 'brief-mubisys' };
