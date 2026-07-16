# Prateleiras 3D (isolado)

Página estática navegável com Three.js. **Não faz parte** do HTML/layout principal das prateleiras.

## Abrir

- Pela intranet: **Lista de produtos** → guia **Explorar 3D** (depois de Armazém 3D)
- Direto: **`/prateleiras-3d/`** (com barra no final) ou `/prateleiras-3d/?embed=1`
- Sem a barra (`/prateleiras-3d`) o servidor responde 404 — bloqueio de estáticos da raiz.

## Controles

- Clique/toque em **entrar**
- PC: WASD + mouse · Tablet: WASD na tela + arrastar o dedo
- Cenário: porta-pallets laranja das ruas R1–R4 (como na foto do Armazém 3D)

## Se o 3D não abrir (WebGL desligado)

No Chrome deste PC a aceleração de hardware pode estar desligada.

**Opção A:** Menu ⋮ → Configurações → Sistema → ative **Usar aceleração de hardware** → Relançar.

**Opção B:** `./prateleiras-3d/abrir-com-gpu.sh`

## Remover 100% desta feature

1. Apague a pasta `prateleiras-3d/`
2. Remova a guia **Explorar 3D** e o painel `#conteudo-porta-pallet-3d` em `menu_produto.html`
3. Remova o `else if (nome === 'porta-pallet-3d')` em `menu_produto.js` (`showArmazemTab`)
4. Pronto — Armazém 3D (foto) permanece igual
