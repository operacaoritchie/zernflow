# Bloco 1 — Motor de fluxos: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer os fluxos montados no editor rodarem como desenhados (Condição, Teste A/B, gatilhos múltiplos, Atraso, Smart Delay, IA, HTTP, Ir para fluxo) e o painel de Teste mostrar o mesmo que o motor faz.

**Architecture:** Toda decisão de rota e de condição sai do `engine.ts` (acoplado ao Supabase) para funções puras em `lib/flow-engine/routing.ts`, usadas tanto pelo motor quanto pelo simulador. Isso elimina a divergência entre os dois e permite testar com vitest sem banco. O motor aceita os nomes antigos de saída (`yes`/`no`, `split-N`, nome do caminho) e os novos, então fluxos já salvos voltam a funcionar sem migração.

**Tech Stack:** Next.js 16, TypeScript, Supabase, @xyflow/react, vitest.

**Spec:** `docs/superpowers/plans/2026-11-26-roteiro-correcoes.md` (Bloco 1) + relatório da auditoria resumido abaixo em cada tarefa.

## Global Constraints

- Nenhuma migração SQL neste bloco; nenhuma dependência nova.
- Fluxos já salvos têm de continuar funcionando: toda leitura aceita o formato antigo e o novo.
- Toda string nova de interface entra em `lib/i18n/messages/en.json`, `pt-BR.json` e `es.json` (o `i18n.test.ts` falha se faltar).
- Testes ficam ao lado do arquivo testado (`*.test.ts`), no estilo de `lib/flow-engine/normalize-nodes.test.ts`.
- Branch: `fix/bloco-1-motor-de-fluxos`. Um commit por tarefa.

## Review Focus

1. Fluxo salvo antes da correção, com arestas `yes`/`no` e `split-0`/`split-1`: tem de seguir a saída certa sem reabrir o editor (Tarefas 2 e 3).
2. Teste A/B com todos os pesos em 0 ou sem `paths`: não pode lançar exceção; divide por igual (Tarefa 2).
3. Condição de "última interação" para contato sem `last_interaction_at`: resultado `false`, nunca exceção (Tarefa 3).
4. "Esperar até" com data no passado ou texto inválido: não pode agendar para o passado distante nem lançar; passado → agora, inválido → duração (Tarefa 7).
5. Nó de IA no primeiro contato (sem histórico): tem de responder usando a mensagem recebida (Tarefa 8).

---

### Task 1: Palavras-chave globais não podem derrubar a automação

Bug: `settings-view.tsx:127-130` salva `global_keywords` como `string[]`; `app/api/webhooks/late/route.ts:523-529` lê `{keyword, action}[]` e chama `kw.keyword.toLowerCase()` → exceção em toda mensagem.

**Files:**
- Create: `lib/global-keywords.ts`, `lib/global-keywords.test.ts`
- Modify: `app/api/webhooks/late/route.ts:515-535`

**Interfaces:**
- Produces: `parseGlobalKeywords(raw: unknown): GlobalKeyword[]` e `type GlobalKeyword = { keyword: string; action?: "subscribe" | "unsubscribe"; flowId?: string }`

- [ ] **Step 1: Write the failing test** `lib/global-keywords.test.ts`
  - `parseGlobalKeywords(["Promo", " oi "])` → `[{ keyword: "promo" }, { keyword: "oi" }]` (minúsculas, sem espaços)
  - `parseGlobalKeywords([{ keyword: "SAIR", action: "unsubscribe" }])` → `[{ keyword: "sair", action: "unsubscribe" }]`
  - `parseGlobalKeywords(null)`, `parseGlobalKeywords("x")`, `parseGlobalKeywords([1, null, {}, { keyword: "" }])` → `[]`
  - `action` fora de `subscribe`/`unsubscribe` é descartada (o item fica sem `action`)
- [ ] **Step 2:** `npx vitest run lib/global-keywords.test.ts` → FAIL (módulo não existe)
- [ ] **Step 3:** Implementar `parseGlobalKeywords` e trocar o cast em `route.ts` por ela; itens sem `action` são ignorados pelo laço (não fazem nada, não interrompem a mensagem). O sentido de "palavra global dispara fluxo" fica para o Bloco 6.
- [ ] **Step 4:** `npx vitest run lib/global-keywords.test.ts` → PASS
- [ ] **Step 5:** Commit `fix: global keywords saved as strings no longer crash inbound messages`

### Task 2: Saídas de Condição e Teste A/B

Bugs: editor nomeia saídas `yes`/`no` e `split-${i}`; motor procura `true`/`false` e `path.name` (`engine.ts:373,743,1044`). A/B criado sem editar não tem `paths` → `data.paths.reduce` lança (`engine.ts:1037`) e a sessão fica `active` para sempre.

**Files:**
- Create: `lib/flow-engine/routing.ts`, `lib/flow-engine/routing.test.ts`, `components/flow-builder/default-node-data.ts`, `components/flow-builder/default-node-data.test.ts`
- Modify: `lib/flow-engine/engine.ts` (`OUTCOME_HANDLES`/`defaultEdge` em 170-178 passam para `routing.ts`; `traverseNodes` 367-376; `resumeSession` 281; `executeABSplit` 1036-1049), `components/flow-builder/flow-canvas.tsx:62-79` (usa o novo módulo)

**Interfaces:**
- Produces (em `routing.ts`):
  - `defaultEdge(edges: FlowEdge[], nodeId: string): FlowEdge | undefined` (mesmo comportamento atual)
  - `findHandleEdge(edges: FlowEdge[], node: { id: string; data?: unknown }, handle: string): FlowEdge | undefined` — aceita apelidos: `"true"` ↔ `"yes"`, `"false"` ↔ `"no"`, `"split-N"` ↔ `paths[N].name` do nó
  - `pickSplitIndex(paths: Array<{ name: string; weight: number }> | undefined, random: number): number` — `random` em [0,1); retorna -1 se não há caminhos; pesos todos ≤ 0 → divisão igual
  - `DEFAULT_AB_PATHS = [{ name: "A", weight: 50 }, { name: "B", weight: 50 }]`
- Produces (em `default-node-data.ts`): `getDefaultNodeData(type: string, actionType?: string): Record<string, unknown>` — igual ao atual mais `abSplit → { actionType, paths: DEFAULT_AB_PATHS }`

- [ ] **Step 1: Write the failing tests**
  - `routing.test.ts`: aresta com `sourceHandle: "yes"` é achada por `findHandleEdge(edges, node, "true")`; `"no"` por `"false"`; e o inverso (`"true"` salvo em templates) também.
  - Nó A/B com `paths` `[A,B]` e aresta `split-1` é achado por `"split-1"`; aresta antiga com `sourceHandle: "B"` também é achada por `"split-1"`.
  - `pickSplitIndex([{name:"A",weight:50},{name:"B",weight:50}], 0.2)` → 0; `0.7` → 1; `pickSplitIndex([{name:"A",weight:0},{name:"B",weight:0}], 0.7)` → 1; `pickSplitIndex(undefined, 0.5)` → -1.
  - `default-node-data.test.ts`: `getDefaultNodeData("action","abSplit").paths` igual a `DEFAULT_AB_PATHS`.
- [ ] **Step 2:** `npx vitest run lib/flow-engine/routing.test.ts components/flow-builder/default-node-data.test.ts` → FAIL
- [ ] **Step 3:** Implementar. `executeABSplit` passa a receber `paths ?? DEFAULT_AB_PATHS`, retorna `handle:split-${i}`; `traverseNodes` e `resumeSession` usam `findHandleEdge`. Se nenhuma aresta casar, comportamento atual (completa a sessão).
- [ ] **Step 4:** Mesmo comando → PASS; `npx vitest run` inteiro → PASS
- [ ] **Step 5:** Commit `fix: condition and A/B split nodes follow the handles the editor saves`

### Task 3: Campos da Condição

Bug: o painel grava `field: "tag" | "custom_field" | "variable" | "last_interaction"` sem dizer qual tag/campo/variável; o motor só entende `platform`, `is_subscribed`, `tag:<nome>`, `variable:<nome>` ou um slug (`engine.ts:711-735`). "Tag igual a VIP" sempre falso.

**Files:**
- Modify: `lib/flow-engine/routing.ts`, `lib/flow-engine/routing.test.ts`, `lib/flow-engine/types.ts:73-80`, `lib/flow-engine/engine.ts:694-768` (`executeCondition` monta os fatos e chama a função pura; `evaluateCondition` sai daqui), `components/flow-builder/panels/ConditionPanel.tsx`, `components/flow-builder/nodes/condition-node.tsx` (resumo mostra `key`), `lib/i18n/messages/{en,pt-BR,es}.json`

**Interfaces:**
- Produces:
  - Condição passa a ter `key?: string` (slug do campo ou nome da variável).
  - `type ConditionFacts = { platform?: string; isSubscribed: boolean; tags: string[]; customFields: Record<string, string>; variables: Record<string, string>; lastInteractionAt?: string | null; now: Date }`
  - `evaluateConditions(conditions: ConditionNodeData["conditions"], logic: "and" | "or", facts: ConditionFacts): boolean`
- Regras de `evaluateConditions` (cada uma vira um teste):
  - `tag`: `value` = nome da tag; `equals`/`contains` → contato tem a tag; `not_equals` → não tem; `exists` → tem alguma tag
  - `custom_field`: lê `customFields[key]`; `variable`: lê `variables[key]`
  - `last_interaction`: valor = dias inteiros desde `lastInteractionAt` (para `gt`/`lt`); sem data → condição falsa
  - Formatos antigos continuam: `tag:<nome>`, `has_tag` (valor = nome), `variable:<nome>`, qualquer outro texto = slug de campo
  - Lista vazia: `and` → `true`, `or` → `false` (comportamento atual de `every`/`some`)
  - Operadores e `is_phone` idênticos ao `evaluateCondition` atual

- [ ] **Step 1: Write the failing tests** — um `it` por regra acima, incluindo "tag equals VIP com tags ['VIP'] → true" e "last_interaction gt 7 sem data → false".
- [ ] **Step 2:** `npx vitest run lib/flow-engine/routing.test.ts` → FAIL
- [ ] **Step 3:** Implementar `evaluateConditions`; `executeCondition` só monta `ConditionFacts` a partir da linha do contato (`contact_tags.tags.name`, `contact_custom_fields`, `last_interaction_at`) e do contexto.
- [ ] **Step 4:** Painel: para `custom_field` e `variable`, campo de texto "Campo (slug)" / "Nome da variável" gravando `key`; para `tag`, placeholder "Nome da tag"; para `last_interaction`, placeholder "Dias". Chaves i18n novas: `builder.condition.keyField`, `builder.condition.keyVariable`, `builder.condition.tagPlaceholder`, `builder.condition.daysPlaceholder` nas 3 línguas.
- [ ] **Step 5:** `npx vitest run` → PASS (inclui `i18n.test.ts`)
- [ ] **Step 6:** Commit `fix: condition node evaluates tag, custom field, variable and last interaction`

### Task 4: Painel de Teste igual ao motor

Bug: o simulador cai em "qualquer aresta" quando a saída não casa (`simulator.ts:510-518`), avalia condições com regras próprias (`:227-279`) e devolve `true`/`false` enquanto o `TestPanel.tsx:192` espera `yes`/`no`.

**Files:**
- Create: `lib/flow-engine/simulator.test.ts`
- Modify: `lib/flow-engine/simulator.ts`, `components/flow-builder/panels/TestPanel.tsx:192`

**Interfaces:**
- Consumes: `findHandleEdge`, `defaultEdge`, `evaluateConditions`, `pickSplitIndex` (Tarefas 2 e 3)
- `SimulationConfig.mockContact` ganha `lastInteractionAt?: string`; simulador usa `platform: "instagram"` como hoje.

- [ ] **Step 1: Write the failing tests** com `simulateFlow(nodes, edges, config)`:
  - Gatilho → Condição (`tag equals VIP`) com arestas `yes`→Mensagem A e `no`→Mensagem B; `mockContact.tags: ["VIP"]` → passos incluem A e não B; sem tags → B e não A.
  - Condição cuja saída `no` não está ligada e resultado falso → último passo é `flow_end` (sem "qualquer aresta").
  - A/B com `split-0`/`split-1` ligadas → passo seguinte é um dos dois alvos (nunca `flow_end`).
- [ ] **Step 2:** `npx vitest run lib/flow-engine/simulator.test.ts` → FAIL
- [ ] **Step 3:** Simulador passa a usar as funções de `routing.ts`; remove o fallback "qualquer aresta"; condições usam `evaluateConditions`; A/B usa `pickSplitIndex(paths, Math.random())` e `handle split-N`. `TestPanel` traduz `path` `true`→"Sim", `false`→"Não".
- [ ] **Step 4:** `npx vitest run` → PASS
- [ ] **Step 5:** Commit `fix: test panel simulates the same routing as the engine`

### Task 5: Fluxo com vários gatilhos começa no gatilho certo

Bug: `buildDesiredTriggers` cria uma linha por nó de gatilho, mas `executeFlow` sempre usa `nodes.find(type==="trigger")` (`engine.ts:150-155`).

**Files:**
- Modify: `lib/flow-triggers.ts`, `lib/flow-triggers.test.ts`, `lib/flow-engine/routing.ts`, `lib/flow-engine/routing.test.ts`, `lib/flow-engine/engine.ts:149-158`

**Interfaces:**
- Produces: cada `DesiredTrigger.config` ganha `nodeId: string` (id do nó de gatilho de origem; também na linha extra `keyword` do `comment_keyword`).
- Produces: `pickEntryNode(nodes: FlowNode[], triggerNodeId?: string): FlowNode | undefined` — nó de gatilho com esse id; se não houver (flows publicados antes desta correção), o primeiro gatilho.

- [ ] **Step 1: Write the failing tests**: `buildDesiredTriggers` de dois nós `t1`/`t2` → `config.nodeId` `"t1"` e `"t2"`; `pickEntryNode([t1,t2], "t2")` → `t2`; `pickEntryNode([t1,t2], "zzz")` → `t1`; `pickEntryNode([t1,t2])` → `t1`.
- [ ] **Step 2:** `npx vitest run lib/flow-triggers.test.ts lib/flow-engine/routing.test.ts` → FAIL
- [ ] **Step 3:** Implementar; `executeFlow`, quando `context.triggerId` não for vazio, lê `triggers.config.nodeId` dessa linha e passa para `pickEntryNode`. A rota `publish` apaga e recria as linhas de gatilho do editor (`publish/route.ts:82-94`), então o `nodeId` entra no próximo Publicar sem migração; até lá, fluxos antigos usam o primeiro gatilho (comportamento atual). Mencionar isso na descrição do PR.
- [ ] **Step 4:** Mesmo comando → PASS; `npx vitest run` → PASS
- [ ] **Step 5:** Commit `fix: flows with several triggers start at the trigger that matched`

### Task 6: "Ir para fluxo" sem loop infinito e sem sessão pendurada

Bug: `executeGoToFlow` (`engine.ts:986-1000`) chama `executeFlow` recursivamente sem limite; A→A ou A→B→A envia mensagens até estourar o tempo. A sessão de origem fica `active` para sempre. O botão "Voltar depois" é ignorado.

**Files:**
- Modify: `lib/flow-engine/routing.ts`, `lib/flow-engine/routing.test.ts`, `lib/flow-engine/types.ts:172-192`, `lib/flow-engine/engine.ts:986-1000`, `components/flow-builder/panels/ActionPanel.tsx:305-326`, `README.md` (linha "Go To Flow")

**Interfaces:**
- Produces: `FlowExecutionContext.flowStack?: string[]`; `MAX_FLOW_HOPS = 5`; `canEnterFlow(stack: string[] | undefined, flowId: string): boolean` — falso se `flowId` já está na pilha ou se a pilha tem `MAX_FLOW_HOPS` itens.

- [ ] **Step 1: Write the failing tests**: `canEnterFlow([], "b")` → true; `canEnterFlow(["a"], "a")` → false; `canEnterFlow(["a","b"], "a")` → false; `canEnterFlow(["1","2","3","4","5"], "6")` → false.
- [ ] **Step 2:** `npx vitest run lib/flow-engine/routing.test.ts` → FAIL
- [ ] **Step 3:** `executeGoToFlow`: completa a sessão de origem (`completeSession`) antes de entrar; se `canEnterFlow` for falso, registra `analytics_events` `event_type: "flow_loop_blocked"` com `{ fromFlowId, toFlowId }` e para; senão chama `executeFlow` com `flowStack: [...(stack ?? []), context.flowId]`. Esconder a opção "Voltar depois" no painel (o retorno vira item do Bloco 6) e corrigir o README ("with return stack" → sem retorno).
- [ ] **Step 4:** `npx vitest run` → PASS
- [ ] **Step 5:** Commit `fix: go-to-flow cannot loop forever and closes the calling session`

### Task 7: Atraso "Esperar até", timeout padrão do Smart Delay e variáveis após pausa

Bugs: `executeDelay` ignora `waitUntil` (`engine.ts:785`); Smart Delay novo não grava `timeout` (o painel mostra 30 mas salva nada → `engine.ts:923` não agenda); variáveis do "Definir campo" só são salvas na sessão para IA/HTTP/template (`engine.ts:353-362`) e somem após uma pausa.

**Files:**
- Modify: `lib/flow-engine/routing.ts`, `lib/flow-engine/routing.test.ts`, `lib/flow-engine/types.ts:82-85`, `lib/flow-engine/engine.ts` (`executeDelay`; lista de tipos que persistem variáveis), `components/flow-builder/panels/DelayPanel.tsx:160-175`, `components/flow-builder/default-node-data.ts`, `components/flow-builder/default-node-data.test.ts`

**Interfaces:**
- Produces: `DelayNodeData.waitUntil?: string` (ISO 8601 com fuso); `computeDelayRunAt(data: { duration?: number; unit?: string; waitUntil?: string }, now: Date): Date`
  - `waitUntil` válido e futuro → essa data; válido e passado → `now`; inválido/vazio → `now + duration*unit` (unidade desconhecida = segundos, como hoje)
- Produces: `getDefaultNodeData("action","smartDelay")` → `{ actionType: "smartDelay", timeout: 30, timeoutUnit: "minutes" }`

- [ ] **Step 1: Write the failing tests** para os três ramos de `computeDelayRunAt` (com `now` fixo) e para o padrão do Smart Delay.
- [ ] **Step 2:** `npx vitest run lib/flow-engine/routing.test.ts components/flow-builder/default-node-data.test.ts` → FAIL
- [ ] **Step 3:** `executeDelay` usa `computeDelayRunAt`. `DelayPanel` grava `new Date(valorLocal).toISOString()` e mostra o valor convertido de volta para o fuso do navegador (o motor roda em UTC; sem isso "09:00" vira 09:00 UTC). Valores antigos sem fuso são lidos como estão. `setCustomField` entra na lista de tipos que gravam `variables` na sessão.
- [ ] **Step 4:** `npx vitest run` → PASS
- [ ] **Step 5:** Commit `fix: delay wait-until, smart delay default timeout, variables survive pauses`

### Task 8: Nó de IA responde à mensagem recebida

Bug: o histórico vem da tabela local `messages`, mas mensagens recebidas nunca são gravadas lá. No primeiro contato a lista fica vazia e o AI SDK lança "messages must not be empty"; nos demais a IA só vê as próprias respostas (`nodes/ai-response.ts:78-98`). Gravar as mensagens recebidas é do Bloco 4; aqui o nó passa a usar a mensagem do contexto.

**Files:**
- Create: `lib/flow-engine/nodes/ai-messages.ts`, `lib/flow-engine/nodes/ai-messages.test.ts`
- Modify: `lib/flow-engine/nodes/ai-response.ts:76-100`

**Interfaces:**
- Produces: `buildAiMessages(history: Array<{ direction: string; text: string | null }>, incomingText?: string): Array<{ role: "user" | "assistant"; content: string }>` — `history` em ordem cronológica; ignora textos vazios; acrescenta `incomingText` como último `user`, a menos que o último item já seja esse mesmo texto como `user`.

- [ ] **Step 1: Write the failing tests**: histórico vazio + "Oi" → `[{role:"user",content:"Oi"}]`; histórico `[outbound "Olá"]` + "Preço?" → `[assistant "Olá", user "Preço?"]`; histórico terminando em `inbound "Preço?"` + "Preço?" → sem duplicar; vazio e sem texto → `[]`.
- [ ] **Step 2:** `npx vitest run lib/flow-engine/nodes/ai-messages.test.ts` → FAIL
- [ ] **Step 3:** `ai-response.ts` usa `buildAiMessages(chronological, context.incomingMessage.text)`; se o resultado for `[]`, não chama o modelo, registra o erro como hoje e segue para a próxima aresta em vez de cancelar a sessão.
- [ ] **Step 4:** `npx vitest run` → PASS
- [ ] **Step 5:** Commit `fix: AI response node answers the incoming message`

### Task 9: Cabeçalhos do nó HTTP

Bug: "Adicionar cabeçalho" cria `"": ""`; `http.request` recusa nome vazio, o erro só vai para o log e a requisição nunca sai (`ActionPanel.tsx:155`, `engine.ts:966-981`). Valores de cabeçalho não interpolam variáveis (`Bearer {{bot.token}}` vai literal). Variáveis de resposta HTTP não aparecem no seletor porque `NodeConfigSidebar.tsx:66` compara `n.type !== "httpRequest"` e nós do editor são `type: "action"`.

**Files:**
- Modify: `lib/flow-engine/routing.ts`, `lib/flow-engine/routing.test.ts`, `lib/flow-engine/engine.ts:960-970`, `components/flow-builder/panels/NodeConfigSidebar.tsx:66`

**Interfaces:**
- Produces: `buildHttpHeaders(headers: Record<string, string> | undefined, interpolate: (text: string) => string): Record<string, string>` — descarta nomes vazios ou só com espaços, tira espaços do nome e interpola os valores.

- [ ] **Step 1: Write the failing tests**: `{ "": "", "Authorization": "Bearer {{t}}" }` com interpolador que troca `{{t}}` por `abc` → `{ Authorization: "Bearer abc" }`; `undefined` → `{}`.
- [ ] **Step 2:** `npx vitest run lib/flow-engine/routing.test.ts` → FAIL
- [ ] **Step 3:** O motor usa `buildHttpHeaders(data.headers, (s) => interpolateVariables(s, vars))` mantendo o `Content-Type` padrão atual; `NodeConfigSidebar` usa `toEngineNode(n).type`.
- [ ] **Step 4:** `npx vitest run` → PASS
- [ ] **Step 5:** Commit `fix: http request node skips empty headers and interpolates values`

### Task 10: Validação do bloco

- [ ] `npx vitest run` → todos passam (125 antigos + novos)
- [ ] `npx tsc --noEmit` → sem saída
- [ ] `npx eslint .` → no máximo os 11 erros pré-existentes, nenhum novo
- [ ] `NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x npx next build` → conclui
- [ ] Revisão independente da branch inteira (superpowers:requesting-code-review)
- [ ] Roteiro de validação manual para você, num ambiente com Supabase e um canal conectado: (1) Condição por tag, os dois lados; (2) A/B novo sem editar; (3) fluxo com dois gatilhos; (4) Atraso "esperar até" daqui a 2 min; (5) Smart Delay sem resposta; (6) IA no primeiro contato; (7) A→B→A bloqueado; (8) salvar palavra-chave global e mandar mensagem. Também o painel de Teste com o fluxo (1).
- [ ] Marcar o Bloco 1 como concluído no roteiro e só então escrever o plano do Bloco 2.
