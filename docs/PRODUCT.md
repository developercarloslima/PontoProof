# Produto — PontoProof

## 1. Visão

O PontoProof não é apresentado apenas como “relógio de ponto”. Ele é um **sistema operacional da jornada de trabalho** que conecta:

**marcação → prova → apuração → prevenção → ajuste auditável → fechamento → folha → auditoria**.

## 2. Problema

Sistemas tradicionais resolvem coleta e cálculo, mas RH e trabalhador ainda enfrentam quatro fricções:

1. discutir se uma marcação é confiável;
2. descobrir inconsistências apenas no fechamento;
3. alterar/corrigir jornadas sem uma narrativa auditável simples;
4. entender por que um saldo, adicional ou alerta existe.

## 3. Proposta de valor

### Para o colaborador
- bater ponto em poucos segundos;
- comprovante imediato;
- enxergar a força da prova daquele registro;
- receber lembretes sem marcação automática;
- solicitar ajustes pelo app;
- entender saldo e divergências em linguagem natural;
- confirmar o “Jornada Espelho” antes do fechamento.

### Para supervisor
- visão de equipe em tempo real;
- alertas de esquecimento e excesso de jornada;
- fila de aprovações;
- previsão de hora extra/custo;
- trilha clara de cada exceção.

### Para RH/DP
- regras por empresa, filial, sindicato/CCT e escala;
- fechamento preventivo;
- ajustes em fluxo, não por sobrescrita;
- auditoria e exportações fiscais;
- integrações com folha/ERP;
- indicadores de risco e custo.

### Para auditor/compliance
- ledger de eventos;
- cadeia de integridade;
- acesso somente leitura;
- exportação verificável;
- histórico de decisões e aprovadores.

## 4. Módulos

### 4.1 Registro
- Web/PWA
- Android/iOS (fase de produção)
- quiosque/tablet
- QR Code dinâmico
- integração REP-C
- API para coletores autorizados
- offline-first

### 4.2 Proof Engine
Evidências possíveis:
- timestamp do servidor;
- hora do dispositivo;
- GPS + precisão;
- geofence;
- device fingerprint;
- Play Integrity / App Attest;
- detecção de mock location;
- selfie + face match;
- liveness;
- Wi-Fi/IP de unidade;
- Bluetooth beacon;
- hash do payload offline.

A ausência de uma evidência não impede automaticamente a marcação. Ela reduz a confiança e pode gerar alerta conforme política da empresa. Isso evita transformar controles antifraude em bloqueios ilegítimos de registro.

### 4.3 Ledger de Jornada
- registro original imutável;
- NSR interno sequencial;
- previousHash + integrityHash;
- auditoria de criação, ajuste, aprovação e exportação;
- verificador de cadeia.

### 4.4 Ajustes
- colaborador solicita inclusão/correção;
- sistema preserva o registro original;
- gestor/RH aprova ou rejeita;
- aprovação cria evento corretivo ligado à solicitação;
- antes/depois fica rastreável.

### 4.5 Jornada Espelho
Checklist pré-fechamento:
- marcação ímpar;
- intervalo ausente/curto;
- jornada excessiva;
- hora extra fora do padrão;
- ausência/atraso;
- registros de baixa confiança;
- ajustes pendentes;
- divergências de escala/CCT;
- confirmação do trabalhador quando aplicável.

### 4.6 Ponto IA
A IA nunca “inventa” ponto. Funções:
- explicar o cálculo;
- resumir divergências;
- priorizar riscos;
- simular impacto financeiro;
- preparar respostas ao colaborador;
- indicar dados faltantes;
- pesquisar políticas internas e CCTs conectadas no futuro.

## 5. Perfis e permissões

- ADMIN: configura organização, integrações, políticas e acessos.
- RH: pessoas, escalas, apuração, ajustes, fechamento e relatórios.
- SUPERVISOR: equipe subordinada, aprovações e alertas.
- EMPLOYEE: próprio ponto, jornada, documentos e solicitações.
- AUDITOR: somente leitura + exportações e integridade.

## 6. Monetização sugerida

### Start
Até 30 colaboradores, coleta + espelho + ajustes + relatórios essenciais.

### Pro
ProofScore, geofence, antifraude avançado, escalas, banco de horas, integrações.

### Enterprise
SSO, SCIM, multi-CNPJ, CCT engine, BI, API, auditoria avançada, SLA, white label e chaves gerenciadas pelo cliente.

Modelo principal: preço por colaborador ativo/mês + módulos premium.

## 7. Métricas de produto

- tempo médio para registrar ponto;
- taxa de sincronização offline bem-sucedida;
- % de marcações ProofScore >= 85;
- divergências por 100 colaboradores;
- tempo de fechamento da folha;
- ajustes por colaborador/mês;
- alertas resolvidos antes do fechamento;
- redução de retrabalho;
- NPS do colaborador/RH.
