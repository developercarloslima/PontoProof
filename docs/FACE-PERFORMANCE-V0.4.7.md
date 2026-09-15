# Desempenho facial — v0.4.7

## Meta

- câmera: abertura imediata após a permissão do navegador;
- cadastro facial com instância já ativa: alvo de 3–8 s;
- login/marcação facial: deadline interno de 8,5 s para a inferência do backend;
- nenhuma marcação facial é aprovada por timeout: se o motor seguro exceder o prazo, a operação retorna erro e deve ser repetida.

## Mudanças

1. O navegador não carrega mais modelos Human para registrar ponto.
2. A selfie é compactada no cliente e enviada imediatamente.
3. O backend mantém três pipelines independentes: detector, descriptor leve e seguro.
4. Os pipelines leves são pré-aquecidos assim que a API abre a porta HTTP.
5. Cadastro: apenas a foto frontal gera embedding; esquerda/direita fazem validação rápida de face/qualidade.
6. Marcação: o backend calcula embedding, face match, liveness, antispoof e gesto. O cliente não fornece scores confiáveis.
7. Login facial: uma captura usa o pipeline seguro e a segunda usa o descriptor leve, em paralelo.
8. Fila de cadastro é acionada imediatamente no upload e também consultada a cada 500 ms.
9. Imagens são redimensionadas internamente para 224–320 px antes da inferência.
10. Enquanto o app fica aberto, um health ping periódico evita que uma jornada ativa deixe a instância ociosa.

## Limite do Render Free

O Blueprint continua em `plan: free` para não gerar cobrança automática. Esse plano possui somente 0,1 CPU / 512 MB e entra em sleep depois de 15 minutos sem tráfego. O cold start não faz parte do SLA de 10 s do motor facial.

Para exigir <=10 s de ponta a ponta mesmo após períodos ociosos, altere o Web Service para um plano always-on. O plano `0.5c-512mb` (antigo Starter) já fornece 0,5 CPU; para maior folga de inferência, `1c-2g` oferece 1 CPU e 2 GB.

## Como medir

O cadastro grava `processingMs` em `FaceEnrollmentSubmission.reasonsJson`/auditoria. Para medições de produção, acompanhe também o tempo HTTP de `/auth/face/verify` e `POST /punches`.
