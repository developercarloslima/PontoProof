import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import jpeg from 'jpeg-js';
import { FacePose, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { encryptJson, readEncryptedImage, removeEncryptedEvidence, saveEncryptedImageDataUrl } from './biometric-storage.service.js';
import { getOrCreateSecuritySettings } from './security-settings.service.js';

export type EnrollmentPhoto = { pose: FacePose; imageDataUrl: string };
type StoredPhoto = { pose: FacePose; storageKey: string };
type ProcessedPhoto = StoredPhoto & { embedding:number[]; quality:number; liveness:number; antiSpoof:number; faceCount:number };

type HumanConstructor = new (config?: any) => any;

const require = createRequire(import.meta.url);
let humanPromise: Promise<any> | null = null;
let humanCtor: HumanConstructor | null = null;
let workerBusy = false;

function clamp(v:number){ return Math.max(0,Math.min(1,v)); }
function cosine(a:number[],b:number[]){
  if(!a.length||a.length!==b.length)return 0;
  let dot=0,aa=0,bb=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
  return aa&&bb?clamp(dot/(Math.sqrt(aa)*Math.sqrt(bb))):0;
}

function humanPackagePaths(){
  // Resolve only the package's public/default entry. This is always allowed by
  // Node package exports. From that absolute filesystem path we can safely
  // address the WASM Node bundle without asking Node to resolve a blocked
  // package subpath such as "@vladmandic/human/dist/human.node-wasm.js".
  const defaultEntry=require.resolve('@vladmandic/human');
  const distDir=path.dirname(defaultEntry);
  const wasmEntry=path.join(distDir,'human.node-wasm.js');
  const modelsDir=path.resolve(distDir,'../models');
  if(!fs.existsSync(wasmEntry))throw new Error(`Motor facial Human/WASM não encontrado em ${wasmEntry}`);
  if(!fs.existsSync(modelsDir))throw new Error(`Modelos faciais Human não encontrados em ${modelsDir}`);
  return {defaultEntry,distDir,wasmEntry,modelsDir};
}

function humanModelsUrl(){
  const {modelsDir}=humanPackagePaths();
  return pathToFileURL(modelsDir).href.replace(/\/$/,'')+'/';
}

function wasmFilesPath(){
  try {
    const entry=require.resolve('@tensorflow/tfjs-backend-wasm');
    return path.dirname(entry)+path.sep;
  } catch {
    return path.resolve(process.cwd(),'node_modules/@tensorflow/tfjs-backend-wasm/dist')+path.sep;
  }
}

function getHumanConstructor():HumanConstructor{
  if(humanCtor)return humanCtor;
  // IMPORTANT: do not import a package subpath here. Some published Human builds
  // do not expose ./dist/human.node-wasm.js through package.json "exports",
  // which causes ERR_PACKAGE_PATH_NOT_EXPORTED on Node 22/Render. Requiring the
  // already-resolved absolute file bypasses that export-map limitation while
  // still loading the package's own WASM Node bundle.
  const {wasmEntry}=humanPackagePaths();
  const mod:any=require(wasmEntry);
  const ctor=mod?.default??mod?.Human;
  if(typeof ctor!=='function')throw new Error('Motor facial Human/WASM não pôde ser inicializado');
  humanCtor=ctor as HumanConstructor;
  return humanCtor;
}

async function buildHuman(){
  const Human=getHumanConstructor();
  const human:any=new Human({
    backend:'wasm',
    wasmPath:wasmFilesPath(),
    wasmPlatformFetch:false,
    modelBasePath:humanModelsUrl(),
    cacheModels:false,
    validateModels:false,
    async:true,
    warmup:'none',
    debug:false,
    filter:{enabled:false,equalization:false,flip:false},
    face:{
      enabled:true,
      detector:{rotation:true,maxDetected:2,minConfidence:0.45},
      mesh:{enabled:false},
      iris:{enabled:false},
      description:{enabled:true},
      antispoof:{enabled:true},
      liveness:{enabled:true},
      emotion:{enabled:false}
    },
    body:{enabled:false},hand:{enabled:false},object:{enabled:false},gesture:{enabled:false}
  } as any);
  await human.load();
  return human;
}

async function getServerHuman(){
  if(!humanPromise){
    humanPromise=buildHuman().catch(err=>{
      humanPromise=null;
      humanCtor=null;
      throw err;
    });
  }
  return humanPromise;
}

async function detectDecoded(photo:StoredPhoto,decoded:any,human:any):Promise<ProcessedPhoto>{
  const rgb=new Uint8Array(decoded.width*decoded.height*3);
  for(let s=0,d=0;s<decoded.data.length;s+=4){rgb[d++]=decoded.data[s];rgb[d++]=decoded.data[s+1];rgb[d++]=decoded.data[s+2];}
  const tensor=human.tf.tensor3d(rgb,[decoded.height,decoded.width,3],'int32');
  try{
    const result:any=await human.detect(tensor);
    const faces=result?.face??[];
    if(faces.length!==1)return {...photo,embedding:[],quality:0,liveness:0,antiSpoof:0,faceCount:faces.length};
    const face=faces[0];
    const box=face?.box??[0,0,0,0];
    const minDim=Math.max(1,Math.min(decoded.width,decoded.height));
    const relativeSize=Math.min(Number(box[2]??0),Number(box[3]??0))/minDim;
    const confidence=Number(face?.faceScore??face?.boxScore??0);
    const quality=clamp(confidence*0.72+clamp(relativeSize/0.42)*0.28);
    const rawEmbedding=face?.embedding;
    const embedding=Array.isArray(rawEmbedding)||ArrayBuffer.isView(rawEmbedding)?Array.from(rawEmbedding as ArrayLike<number>,Number):[];
    return {...photo,embedding,quality,liveness:Number(face?.live??0),antiSpoof:Number(face?.real??0),faceCount:faces.length};
  } finally { human.tf.dispose(tensor); }
}

async function analyzePhoto(photo:StoredPhoto):Promise<ProcessedPhoto>{
  const raw=await readEncryptedImage(photo.storageKey);
  const decoded=jpeg.decode(raw,{useTArray:true,formatAsRGBA:true});
  if(!decoded?.width||!decoded?.height||!decoded?.data)throw new Error('Imagem JPEG inválida');
  const human:any=await getServerHuman();
  return detectDecoded(photo,decoded,human);
}

export async function createAsyncFaceEnrollment(input:{tenantId:string;employeeId:string;userId:string;photos:EnrollmentPhoto[]}){
  const required=[FacePose.FRONT,FacePose.LEFT,FacePose.RIGHT];
  if(input.photos.length!==required.length)throw new Error('Envie exatamente 3 fotos: frontal, esquerda e direita');
  for(const pose of required){if(input.photos.filter(p=>p.pose===pose).length!==1)throw new Error(`Foto ${pose} ausente ou duplicada`);}
  const existing=await prisma.faceEnrollmentSubmission.findFirst({where:{tenantId:input.tenantId,employeeId:input.employeeId,status:{in:['PENDING','PROCESSING']}},orderBy:{submittedAt:'desc'}});
  if(existing)return existing;
  const stored:StoredPhoto[]=[];
  try{
    for(const photo of input.photos){
      const saved=await saveEncryptedImageDataUrl(photo.imageDataUrl,`enroll-queue-${input.employeeId}-${photo.pose}`);
      stored.push({pose:photo.pose,storageKey:saved.storageKey});
    }
    return await prisma.$transaction(async tx=>{
      await tx.employee.update({where:{id:input.employeeId},data:{faceEnrollmentStatus:'PENDING',faceEnrolledAt:null}});
      const submission=await tx.faceEnrollmentSubmission.create({data:{tenantId:input.tenantId,employeeId:input.employeeId,userId:input.userId,status:'PENDING',imagesJson:stored as any,progress:5}});
      await tx.auditEvent.create({data:{tenantId:input.tenantId,actorUserId:input.userId,action:'FACE_ENROLLMENT_SUBMITTED',entityType:'FaceEnrollmentSubmission',entityId:submission.id,metadataJson:{poses:required,processing:'ASYNC_SERVER_WASM'}}});
      return submission;
    });
  }catch(err){await Promise.all(stored.map(x=>removeEncryptedEvidence(x.storageKey)));throw err;}
}

function publicSubmission(row:any){
  return {id:row.id,status:row.status,progress:row.progress,reasons:row.reasonsJson??null,submittedAt:row.submittedAt,processedAt:row.processedAt};
}
export { publicSubmission };

async function markNeedsRetake(submission:any, reasons:any[]){
  const images=(submission.imagesJson??[]) as StoredPhoto[];
  await Promise.all(images.map(x=>removeEncryptedEvidence(x.storageKey)));
  await prisma.$transaction([
    prisma.faceEnrollmentSubmission.update({where:{id:submission.id},data:{status:'NEEDS_RETAKE',progress:100,reasonsJson:reasons as any,processedAt:new Date()}}),
    prisma.employee.update({where:{id:submission.employeeId},data:{faceEnrollmentStatus:'NOT_ENROLLED',faceEnrolledAt:null}}),
    prisma.auditEvent.create({data:{tenantId:submission.tenantId,actorUserId:submission.userId,action:'FACE_ENROLLMENT_NEEDS_RETAKE',entityType:'FaceEnrollmentSubmission',entityId:submission.id,metadataJson:{reasons}}})
  ]);
}

async function approveSubmission(submission:any, photos:ProcessedPhoto[]){
  await prisma.$transaction(async tx=>{
    await tx.faceReference.updateMany({where:{tenantId:submission.tenantId,employeeId:submission.employeeId,revokedAt:null},data:{revokedAt:new Date()}});
    for(const p of photos){
      await tx.faceReference.create({data:{tenantId:submission.tenantId,employeeId:submission.employeeId,pose:p.pose,storageKey:p.storageKey,embeddingEncrypted:encryptJson(p.embedding),faceQualityScore:p.quality,livenessScore:p.liveness,antiSpoofScore:p.antiSpoof,createdByUserId:submission.userId}});
    }
    await tx.employee.update({where:{id:submission.employeeId},data:{faceEnrollmentStatus:'ACTIVE',faceEnrolledAt:new Date(),faceTemplateVersion:{increment:1},failedBiometricAttempts:0,biometricLockedUntil:null}});
    await tx.faceEnrollmentSubmission.update({where:{id:submission.id},data:{status:'APPROVED',progress:100,reasonsJson:{message:'As três imagens foram aprovadas pelo processamento facial do servidor'} as any,processedAt:new Date()}});
    await tx.auditEvent.create({data:{tenantId:submission.tenantId,actorUserId:submission.userId,action:'FACE_ENROLLMENT_APPROVED_ASYNC',entityType:'FaceEnrollmentSubmission',entityId:submission.id,metadataJson:{engine:'HUMAN_NODE_WASM',quality:photos.map(p=>({pose:p.pose,quality:p.quality,liveness:p.liveness,antiSpoof:p.antiSpoof}))}}});
  });
}

async function processSubmission(submission:any){
  const claimed=await prisma.faceEnrollmentSubmission.updateMany({where:{id:submission.id,status:'PENDING'},data:{status:'PROCESSING',progress:15,processingStartedAt:new Date(),processingAttempts:{increment:1}}});
  if(!claimed.count)return;
  const row=await prisma.faceEnrollmentSubmission.findUniqueOrThrow({where:{id:submission.id}});
  const policy=await getOrCreateSecuritySettings(row.tenantId);
  const stored=(row.imagesJson??[]) as StoredPhoto[];
  try{
    const processed:ProcessedPhoto[]=[];
    for(let i=0;i<stored.length;i++){
      processed.push(await analyzePhoto(stored[i]));
      await prisma.faceEnrollmentSubmission.update({where:{id:row.id},data:{progress:35+i*20}});
    }
    const reasons:any[]=[];
    for(const p of processed){
      if(p.faceCount===0)reasons.push({pose:p.pose,code:'FACE_NOT_FOUND',message:'Nenhum rosto foi detectado'});
      else if(p.faceCount>1)reasons.push({pose:p.pose,code:'MULTIPLE_FACES',message:'Mais de um rosto apareceu na foto'});
      else if(p.embedding.length<64)reasons.push({pose:p.pose,code:'EMBEDDING',message:'Não foi possível extrair a assinatura facial'});
      else if(p.quality<policy.minFaceQualityScore)reasons.push({pose:p.pose,code:'QUALITY',message:'Foto com pouca qualidade, distância inadequada ou iluminação insuficiente'});
      else if(p.liveness<policy.minLivenessScore)reasons.push({pose:p.pose,code:'LIVENESS',message:'A prova de vida passiva não atingiu a confiança mínima'});
      else if(p.antiSpoof<policy.minAntiSpoofScore)reasons.push({pose:p.pose,code:'ANTISPOOF',message:'A imagem parece não ser uma captura facial confiável'});
    }
    if(!reasons.length){
      const pairs:[[number,number],[number,number],[number,number]]=[[0,1],[0,2],[1,2]];
      for(const [a,b] of pairs){const score=cosine(processed[a].embedding,processed[b].embedding);if(score<Math.max(0.55,policy.minFaceMatchScore-0.12))reasons.push({pose:'ALL',code:'CROSS_MATCH',message:'As fotos não parecem pertencer à mesma pessoa',score:Number(score.toFixed(3))});}
    }
    if(reasons.length)return markNeedsRetake(row,reasons);
    return approveSubmission(row,processed);
  }catch(error){
    const message=error instanceof Error?error.message:'Falha desconhecida no processamento facial';
    await prisma.faceEnrollmentSubmission.update({where:{id:row.id},data:{status:'FAILED',progress:100,reasonsJson:{code:'PROCESSING_ERROR',message} as any,processedAt:new Date()}});
    await prisma.auditEvent.create({data:{tenantId:row.tenantId,actorUserId:row.userId,action:'FACE_ENROLLMENT_PROCESSING_FAILED',entityType:'FaceEnrollmentSubmission',entityId:row.id,metadataJson:{engine:'HUMAN_NODE_WASM',message}}});
  }
}

export async function runFaceEnrollmentWorkerOnce(){
  if(workerBusy)return {busy:true};
  workerBusy=true;
  try{
    // If the process restarted while a job was running, return stale jobs to the queue.
    await prisma.faceEnrollmentSubmission.updateMany({where:{status:'PROCESSING',processingStartedAt:{lt:new Date(Date.now()-10*60_000)}},data:{status:'PENDING',progress:5,processingStartedAt:null}});
    const next=await prisma.faceEnrollmentSubmission.findFirst({where:{status:'PENDING'},orderBy:{submittedAt:'asc'}});
    if(!next)return {processed:false};
    await processSubmission(next);
    return {processed:true,id:next.id};
  }finally{workerBusy=false;}
}

export async function retryFaceEnrollmentSubmission(input:{tenantId:string;userId:string;submissionId:string}){
  const row=await prisma.faceEnrollmentSubmission.findFirst({where:{id:input.submissionId,tenantId:input.tenantId,userId:input.userId}});
  if(!row)throw new Error('Solicitação facial não encontrada');
  if(row.status!=='FAILED')throw new Error('Somente uma análise com erro técnico pode ser reenviada sem novas fotos');
  return prisma.faceEnrollmentSubmission.update({where:{id:row.id},data:{status:'PENDING',progress:5,reasonsJson:Prisma.DbNull,processedAt:null,processingStartedAt:null}});
}
