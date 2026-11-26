# Roteiro de correções do ZernFlow

Origem: auditoria de 26/11/2026 (5 revisões por área + verificação manual dos achados críticos).
Estado de partida: `npm test` 125/125 ok, `tsc` ok, `next build` ok, lint com 11 erros de React Compiler (sem efeito visível).

## Regra de trabalho

Um bloco por vez. Cada bloco tem seu plano detalhado (`2026-11-26-bloco-N-*.md`), escrito só quando o anterior estiver validado, porque o código muda no caminho.
Cada tarefa: teste que reproduz o bug → correção → teste passa → commit.
Cada bloco termina com: `npm test`, `npx tsc --noEmit`, `npx eslint .` (sem erros novos), `npx next build`, revisão independente da branch e validação com você. Só então o próximo bloco começa.

## Blocos (ordem de execução)

### Bloco 1 — Motor de fluxos (o produto principal)  ← plano detalhado pronto
Fluxos montados no editor não rodam como desenhados.
- Palavra-chave global salva em Configurações quebra toda a automação (crítico)
- Condição e Teste A/B nunca seguem nenhuma saída; fluxo termina em silêncio (crítico)
- Campos da Condição (tag, campo personalizado, variável, última interação) não funcionam (crítico)
- Teste A/B com valores padrão trava a sessão (crítico)
- Nó de IA não vê a mensagem do usuário e falha no primeiro contato (crítico)
- "Ir para fluxo" pode entrar em loop infinito e deixa a sessão pendurada (alto)
- Fluxo com vários gatilhos sempre começa pelo primeiro (alto)
- Atraso "Esperar até data" ignorado; timeout do Smart Delay não salvo por padrão; variáveis perdidas após pausa; cabeçalhos HTTP vazios/sem variáveis (médio)
- Painel de Teste esconde esses bugs (simulador diverge do motor) (médio)

### Bloco 2 — Workspace certo e segurança
- As ~33 rotas `/api/v1` usam o "primeiro" workspace e ignoram o selecionado (alto) — base para os blocos seguintes
- Qualquer membro lê e troca as chaves (Zernio, IA, segredo do webhook) pelo navegador; RLS sem checagem de papel (alto)
- "Criar workspace" sempre falha (alto)
- Membro comum cadastra webhook externo e recebe dados; SSRF nos webhooks de saída (médio-alto)
- Funções SQL `SECURITY DEFINER` chamáveis por anônimos (médio)
- Convite: link não aparece na UI e se perde após login/cadastro (alto)

### Bloco 3 — Broadcasts, sequências e agendamento
- Agendar `/api/cron/jobs`, `/sequences`, `/broadcasts` (Vercel Schedules) — hoje nada chama essas rotas (crítico, a confirmar com você)
- Segmento por tag: "não tem a tag X" envia para todos; "tem a tag X" para ninguém (crítico)
- Segmento por campo personalizado nunca bate (alto)
- Segmentos limitados a 1000 contatos; erros de consulta engolidos (alto)
- Broadcast preso em "enviando"; envio duplicado em falha parcial ou clique duplo (alto)
- Broadcast agendado não existe na prática; broadcasts grandes atrasam os delays dos fluxos (alto)
- Sequências: sem trava (envio duplicado), falhas silenciosas, pausar cancela inscritos, não permite reinscrever, ignora descadastro e janela de 24h (alto/médio)

### Bloco 4 — Recebimento de mensagens (webhook)
- Contador de não lidas volta para 2 a cada mensagem (médio)
- Corrida na primeira mensagem de um contato novo: contato duplicado, fluxo de boas-vindas 2x (médio)
- Botões no Telegram/WhatsApp não acionam gatilhos (médio)
- Comentário "sequestra" sessão de DM em espera (alto)
- Canal desativado nunca reativa; excluir canal já removido no Zernio dá erro 502 (médio)
- Resposta da própria página no Facebook pode re-disparar o fluxo (médio)
- Evento marcado como processado antes de processar: falha perde a mensagem (médio)
- Mensagens recebidas não são gravadas localmente (afeta IA e histórico)

### Bloco 5 — Telas do painel
- Restaurar versão não atualiza o editor e o próximo Salvar desfaz a restauração (alto)
- Editor sem aviso de alterações não salvas; Publicar segue mesmo se Salvar falhou (médio)
- Republicar reativa regras de crescimento pausadas (médio)
- Cabeçalho da inbox não atualiza após Fechar/Adiar/Reabrir (médio)
- Filtro de segmento na página de contatos não filtra; lista parada em 100 (médio)
- Configurações não atualizam após salvar; erros só no console (baixo)

### Bloco 6 — Funcionalidades anunciadas sem tela ou sem backend (decisão sua)
Precisam de conversa antes do plano, porque são construção nova e não correção:
tomada humana e atribuição na inbox, respostas salvas, links de referência/QR, importar/exportar contatos, editar tags e campos do contato, chaves de API (criadas mas nenhuma rota aceita), endpoints de webhook, campos do bot, agendamento de broadcast, "voltar ao fluxo anterior" no "Ir para fluxo", sentido real das palavras-chave globais.

### Fora dos blocos (limpeza)
Os 11 erros de lint do React Compiler e as ~20 mensagens de erro da API em inglês. Entram como última tarefa do Bloco 5.
