import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LogisticsReportScreen } from './LogisticsReportScreen'
import * as gateway from '../../services/logisticsReportGateway'
vi.mock('../../services/logisticsReportGateway')
describe('LogisticsReportScreen', () => { it('renders audited KPI data after loading', async () => { vi.mocked(gateway.loadLogisticsReport).mockResolvedValue({ ok: true, mes: '2026-08', periodo: 'Ago/2026', modo: 'mes', evolucao_tipo: 'semana', kpis: { total_itens: 4, abertos: 1, concluidos: 3, urgentes: 2 }, por_status_separacao: [], por_status_transferencia: [], rotas_transferencia: [], por_status_ajuste: [], por_tipo_ajuste: [], por_etapa_recebimento: [], por_status_envio: [], por_metodo_envio: [], envios_por_executor: [], por_armazem: [], top_produtos_separacao: [], tempo_envio: [], evolucao_semanal: [], evolucao_mensal: [] }); render(<LogisticsReportScreen />); await waitFor(() => expect(screen.getByText('Relatório Gerencial — Logística')).toBeTruthy()); expect(screen.getByText('4')).toBeTruthy(); expect(gateway.loadLogisticsReport).toHaveBeenCalledWith('mes') }) })
