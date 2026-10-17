const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const source=readFileSync(require('node:path').join(__dirname,'../auth.js'),'utf8');
function setup(token='token-ficticio') {
 const map=new Map(token?[['app_sync_cracha',token]]:[]); let user=null;
 const c=vm.createContext({API_BASE:'https://example.invalid',crypto:webcrypto,TextEncoder,STORE:{getUser:()=>user,setUser:v=>user=v},localStorage:{getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},fetch:async()=>({ok:true,json:async()=>({sistema:'brief',usuario:'teste',nome:'Teste',papel:'designer',exp:Math.floor(Date.now()/1000)+3600})})});
 vm.runInContext(source,c);
 return {c,map,user:()=>user,run:()=>vm.runInContext('AUTH.restaurarSessaoPainel()',c)};
}
(async()=>{
 const a=setup();let r=await a.run();assert.equal(r.estado,'ok');assert.equal(a.user().papel,'designer');assert.ok(a.user()._painelMarca);assert.ok(!JSON.stringify(a.user()).includes('token-ficticio'));
 a.c.fetch=async()=>{throw Error('offline')};r=await a.run();assert.equal(r.estado,'offline');
 a.map.set('app_sync_cracha','outro-token');r=await a.run();assert.equal(r.estado,'indisponivel');assert.equal(r.usuario,undefined);
 const b=setup();b.c.fetch=async()=>({ok:false,status:401,json:async()=>({})});r=await b.run();assert.equal(r.estado,'expirada');assert.equal(b.map.size,0);
 const d=setup(null);r=await d.run();assert.equal(r.estado,'painel');assert.equal(d.user(),null);
 const e=setup();e.c.fetch=async()=>({ok:true,json:async()=>({sistema:'pcp',usuario:'teste',papel:'admin'})});r=await e.run();assert.equal(r.estado,'sem-acesso');
 const f=setup();f.c.fetch=async()=>{f.map.delete('app_sync_cracha');return {ok:true,json:async()=>({sistema:'brief',usuario:'teste',papel:'admin'})}};r=await f.run();assert.equal(r.estado,'painel');assert.equal(f.user(),null);
 const g=setup();await g.run();g.user()._painelExp=1;g.c.fetch=async()=>{throw Error('offline')};assert.equal((await g.run()).estado,'indisponivel');
 console.log('15 verificações de entrada pelo Painel aprovadas.');
})().catch(e=>{console.error(e);process.exitCode=1});
