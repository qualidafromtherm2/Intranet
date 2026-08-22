import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModalShell } from './components/ModalShell'

describe('ModalShell', () => {
  it('fecha ao clicar no backdrop explícito e preserva painel estreito para drawer', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <ModalShell
        open
        title="Navegação operacional"
        onClose={onClose}
        panelStyle={{ width: '88vw', maxWidth: '24rem', flexShrink: 0 }}
      >
        <div>Conteúdo do painel</div>
      </ModalShell>,
    )

    const panel = screen.getByTestId('modal-panel')
    await user.click(screen.getByRole('button', { name: 'Fechar Navegação operacional pelo fundo' }))

    expect(panel.getAttribute('style')).toContain('width: 88vw')
    expect(panel.getAttribute('style')).toContain('max-width: 24rem')
    expect(panel.getAttribute('style')).toContain('flex-shrink: 0')
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
