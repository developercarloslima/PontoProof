# Render fix — PontoProof v0.4.1

Esta versão corrige a falha de inicialização do Render:

`Error: Cannot find module '@tensorflow/tfjs-node'`

## O que mudou

- O worker de reconhecimento facial do backend não usa mais a entrada Node padrão do `@vladmandic/human`, que depende de binários nativos do `@tensorflow/tfjs-node`.
- O processamento assíncrono usa o bundle `human.node-wasm` com TensorFlow.js WASM.
- O motor facial é carregado apenas quando existir um job biométrico para analisar; uma falha no motor não derruba mais o servidor HTTP.
- Foram adicionadas dependências WASM explícitas (`tfjs-core`, `tfjs-converter`, `tfjs-backend-wasm`).
- A limpeza do campo JSON `reasonsJson` usa `Prisma.DbNull`.

## Deploy

Substitua os arquivos do repositório pela v0.4.1, faça commit/push e no Render use **Manual Deploy > Deploy latest commit** caso o auto-deploy não tenha iniciado.

O deploy esperado deve passar por `prisma db push`, `db:seed` e iniciar a API antes do worker facial processar qualquer imagem.
