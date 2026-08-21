import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SeparationWorkspace } from './SeparationWorkspace'

vi.mock('./SeparationCartScreen', () => ({ SeparationCartScreen: () => <div>Carrinho real</div> }))
vi.mock('./SeparationKanbanScreen', () => ({ SeparationKanbanScreen: () => <div>Kanban real</div> }))

describe('SeparationWorkspace', () => {
  it('starts in the cart and switches to the isolated kanban', () => {
    render(<SeparationWorkspace />)
    expect(screen.getByText('Carrinho real')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Kanban' }))
    expect(screen.getByText('Kanban real')).toBeInTheDocument()
  })
})
