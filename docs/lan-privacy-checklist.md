# LAN Privacy Checklist (Host-Authoritative)

## Setup rápido
1. Terminal A (servidor LAN):
   - `node ./server/lan-server.mjs`
2. Terminal B (cliente web):
   - `npm run dev -- --host`
3. Abra 2 janelas do navegador (ou 2 máquinas):
   - Janela 1 = Host (Player A)
   - Janela 2 = Player B
4. Conecte ambos no mesmo room code e inicie partida com 2+ jogadores.

## Critério de aprovação global
- Nenhum cliente não-autorizado deve ver cartas reais da mão de outro jogador.
- Apenas o jogador autorizado vê cartas reais quando o efeito permite.
- Clientes em atraso devem sincronizar sem revelar informação oculta.

## Caso 1 — Visibilidade básica de mão
1. Inicie a partida.
2. Em Player A, observe o painel de Player B.
3. Em Player B, observe o painel de Player A.

Esperado:
- Cada jogador vê apenas a própria mão real.
- Mão alheia aparece só como quantidade (ou placeholders), nunca cartas reais.

## Caso 2 — Future Reveal (efeito principal)
1. Player A joga carta Future que revela mão de Player B.
2. Durante a janela de reveal, observe A e B simultaneamente.

Esperado:
- Player A vê as cartas reveladas de B.
- Player B NÃO vê as próprias cartas no bloco de reveal de A.
- Outros players/spectators também NÃO veem cartas reveladas.

## Caso 3 — Request/response autoritativo
1. Em Player B, faça uma ação válida (play/draw/reaction).
2. Verifique se o estado muda de forma consistente em ambos clientes.

Esperado:
- Ação entra como request para o host.
- Estado final aplicado vem por state_update do host.
- Sem divergência de turno/fase entre clientes.

## Caso 4 — Discard selection sem vazamento
1. Force fase de DISCARD_SELECTION para um jogador que não seja você.
2. Observe o painel de descarte no cliente não-ativo.

Esperado:
- Cliente não-ativo não recebe lista clicável de cartas reais do outro.
- Deve aparecer apenas mensagem de espera.

## Caso 5 — Action selection sem vazamento
1. Force ACTION_SELECTION para outro jogador (Rewrite/Time Swap/etc.).
2. Observe o cliente não-ativo.

Esperado:
- Cliente não-ativo não recebe alvo baseado em informação oculta indevida.
- Deve ver apenas estado de espera quando não é sua vez de selecionar.

## Caso 6 — Resync snapshot
1. Com a partida em andamento, clique Resync Snapshot em Player B.
2. Compare estado antes/depois.

Esperado:
- Cliente ressincroniza com seq atual.
- Continua sem acesso a mãos ocultas.

## Caso 7 — Reconnect
1. Desconecte Player B (feche aba/rede) e reconecte com o mesmo nick.
2. Observe estado após retorno.

Esperado:
- Reentrada no assento correto.
- Estado recuperado sem revelar mãos de terceiros.

## Caso 8 — Spectator privacy
1. Entre como spectator numa terceira aba.
2. Observe painéis durante turnos e Future Reveal.

Esperado:
- Spectator não vê mãos reais dos jogadores.
- Spectator não vê cartas do Future Reveal (apenas contexto textual, se houver).

## Caso 9 — Checagem de regressão visual
1. Valide overlays (chat/log), lock de interação e banner de reveal.
2. Verifique se nenhum painel “quebra” durante state_update.

Esperado:
- UI estável; sem flicker crítico.
- Sem travamento de botões após sync.

## Resultado final
Aprovar somente se TODOS os casos acima passarem.
Se falhar, anote:
- Caso
- Cliente afetado (Host / Player B / Spectator)
- Passos mínimos de reprodução
- Seq aproximado no momento da falha
