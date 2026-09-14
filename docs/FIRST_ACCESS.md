# Primeiro acesso — PontoProof v0.3.4

## Regra
Nenhum perfil operacional é liberado antes de o próprio titular concluir o onboarding. A regra vale para ADMIN, HR, SUPERVISOR, EMPLOYEE e AUDITOR.

## Fluxo
1. ADM/RH cria nome, matrícula, e-mail, perfil e senha temporária. Nenhuma foto é coletada pelo gestor.
2. Usuário entra com a senha temporária.
3. Usuário troca a senha (mínimo 10 caracteres e diferente da temporária).
4. Usuário lê e reconhece o aviso de tratamento biométrico.
5. Usuário cadastra a própria face pela câmera, com qualidade, liveness e antispoof. A quantidade de referências segue `faceReferenceMin`.
6. Usuário cadastra biometria/passkey de plataforma via WebAuthn (Windows Hello, leitor de impressão digital, Touch ID, Face ID ou autenticador compatível).
7. O backend recalcula o onboarding e somente então libera as rotas operacionais.

## Segurança
- A API retorna HTTP 428 `ONBOARDING_REQUIRED` para rotas operacionais enquanto o onboarding estiver incompleto.
- Rotas de onboarding permanecem disponíveis para o usuário autenticado.
- A impressão digital/Face ID do sistema operacional não é armazenada pelo PontoProof. O servidor guarda apenas a chave pública WebAuthn e os metadados necessários.
- Referências faciais continuam criptografadas e auditadas.
- Revogar o cadastro facial torna o onboarding incompleto novamente até o titular recadastrar a face.

## Teste local
Em banco novo, use `colaborador@demo.com` / `Demo@123`. O painel não deve abrir antes dos quatro passos. Após trocar a senha, reiniciar o projeto não deve restaurar a senha Demo, porque o seed deixa de sobrescrever senhas de usuários existentes.
