export type Origin='N'|'I';
export type Family={codigo:string;nome_familia:string;tipo:string}; export type Unit={codigo:string;descricao:string|null}; export type ItemType={value:string;label:string};
export type RegistrationConfig={ok:true;familias:Family[];unidades:Unit[];tipos:ItemType[]};
export type PreviewPayload={familia_codigo:string;familia_tipo:string;familia_nome:string;origem:Origin;filtro?:string;descricao?:string;descricoes?:string[]};
export type PreviewRow={index:number;codigo:string;sequencial:number;descricao:string;origem:Origin};
export type PreviewResponse={ok:true;prefixo:string;origem:Origin;total:number;rows:PreviewRow[];code:string;sequence:number};
export type CreatePayload={codigo_produto_integracao:string;codigo:string;descricao:string;unidade:string;tipoItem:string};
export type CreateResponse={codigo_produto?:number;sincronizado_local?:boolean;aviso?:string|null;faultstring?:string;error?:string;code?:string;retry?:false};
type Fetcher=typeof fetch;
async function req<T>(fetcher:Fetcher,path:string,init?:RequestInit):Promise<T>{const r=await fetcher(path,{credentials:'include',...init});const data=await r.json().catch(()=>({}));if(!r.ok||(data as CreateResponse).faultstring)throw Object.assign(new Error((data as CreateResponse).faultstring||(data as CreateResponse).error||`Falha (${r.status})`),{code:(data as CreateResponse).code,status:r.status});return data as T}
const json=(body:unknown)=>({headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const requireConfirm=(v:true|undefined)=>{if(v!==true)throw new Error('Confirmação obrigatória antes de criar produto.')};
export function normalizeDescription(v:string){return v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 .,/()-]/g,' ').replace(/\s+/g,' ').trim()}
export function defaultItemType(f?:Family){const c=String(f?.codigo||'').padStart(2,'0'),n=normalizeDescription(f?.nome_familia||'');if(['01','02','03','04','05','06'].includes(c))return'01';if(c==='08')return'02';if(c==='09'&&/MOVEIS|MOBILIARIO/.test(n))return'08';if(c==='09')return'07';return''}
export function createProductRegistrationGateway(fetcher:Fetcher=fetch){return{
 loadConfig:()=>req<RegistrationConfig>(fetcher,'/api/produtos/cadastro/config'),
 preview:(p:PreviewPayload)=>req<PreviewResponse>(fetcher,'/api/produtos/cadastro/preview',{method:'POST',...json(p)}),
 create:(p:CreatePayload,confirm?:true)=>{requireConfirm(confirm);return req<CreateResponse>(fetcher,'/api/produtos/incluir-omie',{method:'POST',...json(p)})},
 uploadPhoto:(codigoProduto:number,file:File,descricao:string,confirm?:true)=>{requireConfirm(confirm);const form=new FormData();form.append('foto',file);form.append('nome_foto',file.name||'Foto do produto');form.append('descricao_foto',descricao);return req<{ok:true;url:string}>(fetcher,`/api/produtos/${encodeURIComponent(String(codigoProduto))}/fotos?pos=0`,{method:'POST',body:form})}
}}
export const productRegistrationGateway=createProductRegistrationGateway();
