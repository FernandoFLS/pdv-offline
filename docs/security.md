# Segurança do projeto

## 1. Objetivo

Registrar as regras de segurança da aplicação, os limites do ambiente do navegador e os cuidados que devem ser observados no desenvolvimento do PDV offline.

## 2. Limitações do login por PIN em aplicação local

O login por PIN é útil para distinguir operadores e controlar acesso ao sistema, mas possui limitações importantes quando a aplicação roda em um navegador local.

### Limitações relevantes
- O navegador não é um ambiente de execução seguro para segredos.
- O dispositivo local pode ser acessado por terceiros.
- O processo de autenticação do navegador não substitui a proteção física do computador.
- Um usuário com acesso físico ao dispositivo pode contornar algumas limitações da aplicação se o sistema não for robusto.

### Regras mínimas
- O PIN não deve ser salvo em texto puro.
- O sistema deve usar mecanismos de autenticação local simples, mas com documentação clara sobre o limite da segurança.
- A interface pode exigir PIN para facilitar identificação do operador, mas a proteção real de dados locais não deve ser confundida com segurança criptográfica forte.

## 3. Autenticação, autorização e regras de negócio

### Autenticação de interface
- Identifica quem está operando.
- Pode bloquear acesso ao painel ou às ações sem perfil adequado.

### Autorização de negócio
- Define se determinada ação é permitida.
- Exemplos:
  - somente administrador pode aplicar desconto;
  - operador não pode cancelar venda sem autorização;
  - caixa fechado bloqueia abertura de venda;
  - ações sensíveis exigem reautenticação ou nível de privilégio.

Importante: a autenticação da interface não substitui a autorização nas regras de negócio.

## 4. Proteção contra acesso a dados locais

O sistema deve prever que o ambiente local pode ser usado em computador compartilhado ou pouco protegido.

Medidas esperadas:
- evitar exportação de dados sensíveis sem necessidade;
- limitar exibição de informações financeiras sensíveis;
- evitar logs de dados críticos;
- separar a autenticação de interface da lógica de autorização da aplicação;
- não incluir credenciais reais no repositório.

## 5. Dados sensíveis e política de logs

A política de logs deve evitar registrar:
- PINs;
- tokens;
- chaves de acesso;
- dados financeiros completos;
- conteúdo de pagamentos em claro.

Os logs devem conter apenas:
- identificadores internos seguros;
- status da operação;
- timestamps;
- códigos de falha úteis para diagnóstico;
- informações administrativas necessárias para auditoria.

## 6. Credenciais e acesso externo

O frontend não deve armazenar segredos de integração como se fossem seguros.

A integração com serviços externos, inclusive o Google Sheets, deve usar uma solução apropriada para proteção do segredo, fora do navegador, quando essa integração for implementada.

A arquitetura atual preserva essa separação:
- frontend local opera com dados do usuário e do caixa;
- integração externa, quando existir, será tratada em uma camada separada e segura.

## 7. Regras de segurança do PDV

- Nenhum dado real de clientes, produtos, vendas ou pagamentos deve entrar no repositório público.
- O repositório deve conter somente dados fictícios ou exemplos genéricos.
- As operações críticas devem ficar auditadas.
- O cancelamento e os ajustes financeiros devem estar protegidos por autorização.
- O acesso administrativo deve ser separado do uso operacional comum.
- Cancelamentos não devem remover o histórico da venda. Em vez disso, devem gerar registros de reversão e compensação coerentes para caixa e estoque.

## 8. Níveis de proteção esperados

A aplicação local deve considerar três níveis:

1. Proteção da interface
   - PIN para identificação do operador.
   - Perfis e permissões.

2. Proteção de regras de negócio
   - validações internas;
   - auditoria e autorização;
   - restrição de operações sensíveis.

3. Proteção de infraestrutura externa
   - o segredo de integração não fica no frontend;
   - a camada externa deve usar autenticação segura em backend, serverless ou serviço controlado.

## 9. Decisão em aberto

Ainda não será escolhida a tecnologia específica para integração externa. A arquitetura atual reconhece que o aplicativo local e a camada externa devem ser separados por segurança.

A decisão final sobre backend, função serverless ou Google Apps Script dependerá da avaliação futura de:
- segurança;
- custo;
- manutenção;
- confiabilidade;
- necessidade operacional.

## 10. Implementação local do PIN e da sessão de usuário

### Credencial

- O PIN é texto numérico com pelo menos 6 dígitos; zeros à esquerda são preservados.
- O banco guarda apenas a derivação PBKDF2-HMAC-SHA-256, salt aleatório individual de 16 bytes, versão do formato, algoritmo e número de iterações. O PIN original nunca é persistido nem registrado em logs.
- A configuração inicial usa 600.000 iterações. A OWASP recomenda Argon2id quando disponível e registra 600.000 iterações PBKDF2-HMAC-SHA-256 no cenário de uso de PBKDF2 com requisito FIPS; esse projeto usa PBKDF2 pela disponibilidade nativa no Web Crypto e não declara conformidade FIPS. O parâmetro deve ser reavaliado se a experiência ficar lenta em computadores mais modestos. [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- No runtime Node.js 24 disponível durante o desenvolvimento, três medições da implementação completa deram medianas de 392 ms para criar a credencial e 364 ms para validar um PIN. Isso não é uma medição do Chrome no computador de operação; faça essa validação antes de considerar o parâmetro definitivo.
- PBKDF2 aumenta o custo de tentativas offline, mas um PIN de seis dígitos continua tendo baixa entropia. Sem um segredo mantido fora do navegador, a derivação não impede tentativa offline se alguém copiar os dados locais.
- A derivação usa Web Crypto. Em navegadores, essa API exige contexto seguro; a aplicação deve ser servida por `localhost` durante desenvolvimento e HTTPS quando publicada. [MDN: `SubtleCrypto.deriveKey`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)

### Tentativas e bloqueio

- `failedPinAttempts`, `lockoutLevel` e `lockedUntil` são persistidos no registro do usuário no IndexedDB e atualizados em transação. Recarregar a página não zera o bloqueio.
- Após cinco falhas consecutivas, o bloqueio inicial dura 30 segundos. Cada bloqueio subsequente dobra a duração até o máximo de 15 minutos. Uma autenticação correta zera o contador, o nível e o prazo.
- O bloqueio é uma barreira de uso normal, não uma proteção contra o proprietário do perfil do navegador. Como a aplicação é local e offline, alguém com acesso às ferramentas do navegador pode alterar ou apagar o IndexedDB, e adiantar o relógio pode encurtar um bloqueio. A aplicação não pode oferecer resistência equivalente a um serviço de autenticação remoto.

### Sessão e primeiro administrador

- O primeiro administrador só pode ser cadastrado enquanto não existir nenhum registro de usuário. Não há PIN padrão nem recuperação automática do administrador nesta etapa.
- A sessão autenticada existe apenas em memória. Atualizar ou fechar a página exige autenticação novamente.
- Logout e bloqueio após cinco minutos sem atividade limpam a sessão em memória. Eles não fecham nem alteram uma sessão de caixa aberta.
- O logout manual é propagado às outras abas abertas do mesmo perfil por `BroadcastChannel`; o prazo de inatividade é controlado individualmente em cada aba.
- Apagar os dados locais remove também a identidade do primeiro administrador; a configuração inicial poderá aparecer novamente. Proteção contra adulteração ou remoção do perfil local não é garantida.

### Gerenciamento de usuários

- Somente uma sessão de administrador ativa pode listar ou alterar usuários. Os casos de uso repetem a validação do papel e do estado do administrador no IndexedDB durante a transação, pois esconder controles na interface não é autorização suficiente.
- A tela administrativa recebe somente identificador, nome, papel, estado e data de cadastro; derivação do PIN e estado de bloqueio não são retornados.
- Cadastro, atualização, redefinição de PIN, ativação/desativação e respectivo registro de auditoria são gravados na mesma transação. Auditorias não incluem PIN nem derivação da credencial.
- Desativar uma conta é uma mudança lógica de estado. Ela não remove o usuário nem registros de caixa associados. Não é permitido desativar a própria conta ou remover/rebaixar o último administrador ativo.
- Redefinir PIN ou alterar papel/estado encerra as sessões daquele usuário nas abas abertas. A sessão é apenas em memória; esse aviso não protege contra quem altera diretamente o IndexedDB ou executa código no perfil local.

### Exclusão permanente de conta

- A operação administrativa remove o registro e a credencial de `users`, mas arquiva somente os metadados de identidade necessários para manter a autoria dos registros históricos. O arquivo não é uma conta e não permite login.
- A criação do arquivo, a exclusão da conta e a auditoria `user.deleted` são atômicas. Se o arquivo ou a auditoria falhar, a transação mantém a conta original.
- O evento de exclusão registra administrador responsável, ID afetado, data/hora e uma cópia mínima do nome/papel/estado; não contém PIN, hash, salt nem parâmetros da credencial.
- A exclusão da própria conta é bloqueada. A verificação de último administrador ocorre dentro da transação de escrita. Sessões do usuário excluído são invalidadas nas outras abas; serviços críticos ainda revalidam a existência e o estado ativo no banco.
- A migração versionada cria `userIdentityArchive` sem editar ou excluir os dados existentes. Ela retém metadados pessoais mínimos enquanto houver registros históricos que dependem do ID; apagar também esse arquivo quebraria a atribuição histórica.
