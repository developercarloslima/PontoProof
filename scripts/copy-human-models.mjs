import { cp, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
const candidates=[path.resolve('node_modules/@vladmandic/human/models'),path.resolve('apps/web/node_modules/@vladmandic/human/models')];
const dst=path.resolve('apps/web/public/models/human');
let src='';
for(const candidate of candidates){try{await access(candidate);src=candidate;break;}catch{}}
if(!src){console.warn('[PontoProof] modelos Human não encontrados após npm install');process.exit(0);}
await mkdir(dst,{recursive:true});await cp(src,dst,{recursive:true,force:true});console.log(`[PontoProof] modelos biométricos Human copiados de ${src} para ${dst}`);
