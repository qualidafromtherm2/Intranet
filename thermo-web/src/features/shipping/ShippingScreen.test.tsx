import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShippingScreen } from './ShippingScreen'

const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

describe('ShippingScreen', () => {
  it('does not call the API when navigation permission is denied', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<ShippingScreen allowed={false} />)
    expect(screen.getByLabelText('Sem permissão para Envio de mercadoria')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders the queue and blocks VIPP generation without id_vipp', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true, rows: [{ id: 9, numero_sep: 'SEP-9', usuario: 'Jair', conteudo: '[{"conteudo":"Bomba","quantidade":2}]', rastreio_status: 'Pendente' }], metricas: { pendentes: 1 } })))
    render(<ShippingScreen />)
    expect(await screen.findByText('SEP-9')).toBeInTheDocument()
    expect(screen.getByText('Bomba')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gerar etiqueta' })).toBeDisabled()
  })

  it('requires confirmation before sending the real status mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ ok: true, rows: [{ id: 11, numero_sep: 'SEP-11', id_vipp: 'V1', rastreio_status: 'Pendente' }] })).mockResolvedValueOnce(json({ ok: true, rastreio_status: 'Enviado' })).mockResolvedValueOnce(json({ ok: true, rows: [] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ShippingScreen />)
    await screen.findByText('SEP-11')
    await userEvent.click(screen.getByRole('button', { name: 'Marcar enviado' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como enviado' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  })
})
