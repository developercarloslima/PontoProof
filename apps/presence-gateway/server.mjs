import http from 'node:http';
import crypto from 'node:crypto';

const port=Number(process.env.GATEWAY_PORT??3444);
const worksiteId=process.env.GATEWAY_WORKSITE_ID;
const secret=process.env.PRESENCE_SIGNING_SECRET;
const gatewayId=process.env.GATEWAY_ID;
const allowedOrigin=process.env.WEB_ORIGIN??'http://localhost:5173';
if(!worksiteId||!secret||!gatewayId){console.error('GATEWAY_WORKSITE_ID, GATEWAY_ID e PRESENCE_SIGNING_SECRET são obrigatórios');process.exit(1);}
function sign(value){return crypto.createHmac('sha256',secret).update(value).digest('base64url');}
function token(){const payload=Buffer.from(JSON.stringify({worksiteId,kind:'NETWORK',gatewayId,exp:Math.floor(Date.now()/1000)+60,nonce:crypto.randomUUID()})).toString('base64url');return `${payload}.${sign(payload)}`;}
const server=http.createServer((req,res)=>{
  const origin=String(req.headers.origin??'');
  res.setHeader('Access-Control-Allow-Origin',origin===allowedOrigin?origin:allowedOrigin);
  res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
  if(req.method==='OPTIONS'){res.statusCode=204;res.end();return;}
  if(req.url==='/health'){res.end(JSON.stringify({ok:true,service:'pontoproof-presence-gateway',worksiteId,gatewayId}));return;}
  if(req.url==='/attest'&&req.method==='GET'){
    // Segurança operacional: exponha este serviço somente na LAN/VLAN da unidade ou via proxy local controlado.
    res.end(JSON.stringify({token:token(),worksiteId,expiresInSeconds:60}));return;
  }
  res.statusCode=404;res.end(JSON.stringify({error:'Not found'}));
});
server.listen(port,'0.0.0.0',()=>console.log(`PontoProof Presence Gateway ativo na porta ${port} para ${worksiteId}`));
