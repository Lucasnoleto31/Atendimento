import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/\r$/,"").replace(/^["']|["']$/g,"")];}));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const norm = (d)=>{ d=(d||"").replace(/\D/g,""); if(!d)return null; if(d.length<=11)return d.padStart(11,"0"); if(d.length<=14)return d.padStart(14,"0"); return d; };

// 1. normaliza customers
const cli=[]; for(let de=0;de<50000;de+=1000){const {data}=await db.from("customers").select("id, documento").not("documento","is",null).range(de,de+999);if(!data?.length)break;cli.push(...data);if(data.length<1000)break;}
let padC=0;
for(const c of cli){ const n=norm(c.documento); if(n && n!==c.documento){ await db.from("customers").update({documento:n}).eq("id",c.id); padC++; } }
console.log(`Clientes normalizados (zero recolocado): ${padC}`);

// 2. normaliza leads
const lds=[]; for(let de=0;de<50000;de+=1000){const {data}=await db.from("leads").select("id, documento").not("documento","is",null).range(de,de+999);if(!data?.length)break;lds.push(...data);if(data.length<1000)break;}
let padL=0;
for(const l of lds){ const n=norm(l.documento); if(n && n!==l.documento){ await db.from("leads").update({documento:n}).eq("id",l.id); padL++; } }
console.log(`Leads normalizados: ${padL}`);

// 3. religa leads sem cliente cujo documento agora casa
const docParaCliente = new Map();
for(const c of (await (async()=>{const r=[];for(let de=0;de<50000;de+=1000){const {data}=await db.from("customers").select("id, documento").not("documento","is",null).range(de,de+999);if(!data?.length)break;r.push(...data);if(data.length<1000)break;}return r;})())) docParaCliente.set(norm(c.documento), c.id);
const semCliente = (await (async()=>{const r=[];for(let de=0;de<50000;de+=1000){const {data}=await db.from("leads").select("id, nome, documento, customer_id, status").not("documento","is",null).is("customer_id",null).range(de,de+999);if(!data?.length)break;r.push(...data);if(data.length<1000)break;}return r;})());
let religados=0;
for(const l of semCliente){ const cid=docParaCliente.get(norm(l.documento)); if(cid){ await db.from("leads").update({customer_id:cid, cliente_confirmado_em:new Date().toISOString()}).eq("id",l.id); religados++; console.log(`   religado: "${l.nome}" → cliente ${cid.slice(0,8)}`); } }
console.log(`Leads religados ao cliente: ${religados}`);

// 4. confere o Evandro
const { data: ev } = await db.from("leads").select("nome, documento, customer_id, status").eq("telefone_e164","5569992664365").maybeSingle();
console.log(`\nEvandro agora: doc=${ev?.documento} cliente=${ev?.customer_id?"SIM ✓":"NÃO ✗"} status=${ev?.status}`);
