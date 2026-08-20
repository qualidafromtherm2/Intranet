import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModalShell } from './App'

describe('ModalShell', () => {
  it('fecha ao clicar no backdrop explícito', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <ModalShell open title="Navegação operacional" onClose={onClose}>
        <div>Conteúdo do painel</div>
      </ModalShell>,
    )

    await user.click(screen.getByRole('button', { name: 'Fechar Navegação operacional pelo fundo' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('não fecha ao clicar dentro do painel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <ModalShell open title="Navegação operacional" onClose={onClose}>
        <button type="button">Ação interna</button>
      </ModalShell>,
    )

    await user.click(screen.getByRole('button', { name: 'Ação interna' }))

    expect(onClose).not.toHaveBeenCalled()
  })
})
