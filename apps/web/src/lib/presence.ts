export async function collectBluetoothName(){
  const nav:any=navigator;if(!nav.bluetooth)throw new Error('Web Bluetooth não é suportado neste navegador.');
  const device=await nav.bluetooth.requestDevice({acceptAllDevices:true});return device?.name||'';
}
export async function collectNfcTag(){
  const Reader=(window as any).NDEFReader;if(!Reader)throw new Error('Web NFC não é suportado neste navegador.');
  const reader=new Reader();await reader.scan();return new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Tempo limite para leitura NFC')),12000);reader.addEventListener('reading',(ev:any)=>{clearTimeout(timer);resolve(ev.serialNumber||'');},{once:true});reader.addEventListener('readingerror',()=>{clearTimeout(timer);reject(new Error('Falha ao ler NFC'));},{once:true});});
}
export async function collectNetworkGatewayToken(){
  const url=import.meta.env.VITE_NETWORK_ATTEST_URL;if(!url)return '';
  const response=await fetch(url,{credentials:'include'});if(!response.ok)throw new Error('Gateway de rede local não respondeu.');const data=await response.json();return data.token||'';
}
