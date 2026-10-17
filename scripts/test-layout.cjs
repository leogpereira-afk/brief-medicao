const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const handlers={};
const store={getUser:()=>({papel:'admin',nome:'Teste',usuario:'teste'}),on(){},onSync(){},onConflict(){},getAllOS:()=>[],getCFG:()=>({}),filaComErro:()=>0};
const context=vm.createContext({STORE:store,window:{addEventListener:(k,cb)=>handlers[k]=cb},document:{documentElement:{dataset:{sistema:'layout'}}},location:{hash:'#/layout'},console,setTimeout,clearTimeout});
const source=readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8').replace(/boot\(\);\s*$/,'');
vm.runInContext(source,context);
const run=s=>vm.runInContext(s,context);
run("PROD={...prodVazio(),_aberto:true,cliente:'Cliente fictício',setores:['Teste']};PROJ={...projVazio(),_aberto:true,cliente:'Outro fictício'};renderLayoutProducao=()=>{};renderLayoutProjeto=()=>{};ROTA={nome:'layout',modo:'projeto'};renderLayout({});ROTA.modo='producao';renderLayout({});");
assert.equal(run('PROD.cliente'),'Cliente fictício');assert.equal(run('PROJ.cliente'),'Outro fictício');assert.equal(run('PROD._aberto && PROJ._aberto'),true);
for(const papel of ['admin','designer','vendedor','medidor']){run(`SESSAO={papel:'${papel}',nome:'Teste'}`);assert.equal(run('podeUsarLayout()'),['admin','designer'].includes(papel));}
run("SESSAO=null;lerRota()");assert.equal(run('ROTA.nome'),'login');assert.equal(run('ROTA.area'),'layout');assert.equal(run('AREAS.layout.destino'),'#/layout/projeto');
let prevented=false;handlers.beforeunload({preventDefault(){prevented=true}});assert.equal(prevented,true);
run('PROD=prodVazio();PROJ=projVazio()');prevented=false;handlers.beforeunload({preventDefault(){prevented=true}});assert.equal(prevented,false);


run("SESSAO={papel:'admin'};location.hash='#/layout';lerRota()");assert.equal(run('ROTA.modo'),'projeto');

run("location.hash='#/lista';lerRota()");assert.equal(run('ROTA.nome'),'layout');
run("SESSAO={papel:'vendedor'};lerRota()");assert.equal(run('ROTA.nome'),'login');
const legacyLocation={hash:'#/layout/producao',replace(url){this.redirect=url}};
const brief=vm.createContext({STORE:store,window:{addEventListener(){}},document:{},location:legacyLocation,console,setTimeout,clearTimeout});
vm.runInContext(source,brief);vm.runInContext('lerRota()',brief);
assert.equal(legacyLocation.redirect,'layout.html#/layout/producao');
legacyLocation.hash='#/lista';vm.runInContext('lerRota()',brief);
assert.equal(vm.runInContext('ROTA.nome',brief),'lista');
run("SESSAO={papel:'admin'};location.hash='#/layout';lerRota()");
const layoutHeader=run("htmlTopo('Layout')");
assert.ok(!layoutHeader.includes('href="#/lista"'));
assert.ok(!layoutHeader.includes('modulos-brief'));
assert.ok(!vm.runInContext("htmlTopo('Brief')",brief).includes('href="#/layout'));
console.log('20 verificações aprovadas: entradas separadas, rotas antigas, permissões e rascunhos.');
// Ausência de sessão encaminha automaticamente; nunca oferece validação manual.
vm.runInContext("var AUTH={temCracha:()=>false};ACESSO_PAINEL='painel';renderAcessoPainel({innerHTML:''})",brief);
assert.equal(legacyLocation.redirect,'https://leogpereira-afk.github.io/painel-impresilk/');
assert.ok(!source.includes('id="validar-acesso"'));
console.log('Entrada sem sessão: redirecionamento automático e ausência do botão confirmados.');
