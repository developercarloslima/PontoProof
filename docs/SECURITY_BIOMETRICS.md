# Segurança biométrica — PontoProof v0.3

## Três domínios separados

### 1. Identidade
Selfie, um único rosto, qualidade, liveness, ação aleatória, antispoof, face match e opcionalmente WebAuthn.

### 2. Presença
GPS, precisão, geocerca, dispositivo confiável, QR dinâmico, gateway de rede local, Bluetooth e NFC.

### 3. Integridade histórica
`clientEventId`, hora do servidor, ledger SHA-256 encadeado, lock transacional e auditoria de decisões posteriores.

Separar os três domínios evita tratar GPS como identidade ou face match como prova de local.

## Face
O navegador executa detecção/embedding/liveness/antispoof com Human. A imagem e o embedding atual são enviados ao backend por TLS. O backend recupera embeddings de referência cifrados e calcula similaridade por cosseno. Referências não são entregues ao colaborador.

O PWA não possui attestation nativa do código como um app Android/iOS; portanto um cliente web totalmente comprometido continua sendo uma classe de risco. O produto não deve prometer impossibilidade absoluta de fraude.

## WebAuthn
É a prova criptográfica adicional do autenticador da plataforma. A API usa challenge de curta duração e exige user verification. A impressão digital/Face ID brutos permanecem no sistema operacional/autenticador.

## Offline
Offline é coleta pendente, não validação equivalente ao online. A fila usa AES-GCM em IndexedDB e um `clientEventId` estável. Ao sincronizar, o servidor revalida o que consegue e envia para revisão conforme política. Nunca recebe o selo máximo automaticamente.

## Localização
O browser não fornece um indicador universal e confiável de “mock GPS”. A v0.3 usa sinais: precisão, idade da posição, velocidade reportada e deslocamento entre marcações. Esses sinais são heurísticos.

## Rede local
Navegadores não expõem SSID Wi-Fi de forma confiável. O Presence Gateway deve existir somente dentro da LAN/VLAN da unidade e emitir token HMAC curto contendo unidade/gateway/expiração/nonce. Em produção, use HTTPS.

## Retenção
- Selfie de punch: arquivo cifrado é removido após `selfieRetentionDays`; o DB preserva a chave histórica e marca `selfiePurgedAt`, mantendo o hash original verificável.
- Tentativa bloqueada: removida após `blockedAttemptRetentionDays`.
- Referência revogada: imagem + embedding são expurgados após `revokedFaceReferenceRetentionDays`, preservando metadados/auditoria.
- Referência facial ativa: permanece necessária para autenticação até revogação/encerramento conforme política da organização.

## Segredos
Não reutilize a mesma chave para tudo. Produção deve ter pelo menos:
- `JWT_SECRET`
- `BIOMETRIC_ENCRYPTION_KEY`
- `AUDIT_PRIVACY_HASH_KEY`
- `PRESENCE_SIGNING_SECRET`

Todos devem ficar fora do repositório.
