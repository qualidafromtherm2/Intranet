export type CalendarNotice = { id: number; data: string; texto: string; criadoPor: string; destinatarios: string[] };
export type CalendarReservation = {
  id: number; data: string; tipo: string; tema: string; inicio: string; fim: string;
  repetir: boolean; repetirTodosMeses: boolean; diasSemana: string[]; cafe: boolean;
  descricao?: string | null; visitantes?: string | null; linkReuniao?: string | null;
  criadoPor: string; podeEditar: boolean; participantes: string[]; realizada: boolean; cancelada: boolean;
};
export type ReservationPayload = {
  data: string; tipo: string; tema: string; inicio: string; fim: string; repetir: boolean;
  repetirTodosMeses: boolean; diasSemana: string[]; cafe: boolean; avisoEmail: boolean;
  avisoWhatsapp: boolean; criadoPor: string; participantes: string[];
  participantesAvisos: Record<string, { email: boolean; whatsapp: boolean }>;
  descricao: string | null; visitantes: string | null; linkReuniao: string | null;
  anexoUrl: null; anexoNome: null; aplicarEm?: 'este_dia' | 'todos_futuros';
};
export type MeetingMinute = { id: number; reserva_id: number; tema: string; conteudo: string; criado_por: string; criado_em_fmt: string; excluido: boolean; tarefas: Array<{ id: number; texto: string; concluida: boolean; prazo: string | null }> };
export type MeetingNote = { id: number; usuario: string; texto: string; anexo_url?: string | null; anexo_nome?: string | null; visivel_todos: boolean; proprio: boolean; criado_em: string };
export type Attendance = { id: number; data_fmt: string; hora_inicio: string; participantes: string[]; ausentes: string[]; registrado_por: string; criado_em_fmt: string };
export type ReservationAttachment = { id: number; url: string; nome: string; enviado_por: string; enviado_em_fmt: string };

type Fetcher = typeof fetch;
async function request<T>(fetcher: Fetcher, url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, { credentials: 'include', ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || `Falha na requisição (${response.status})`);
  return data as T;
}
function confirmed(value: true | undefined) { if (value !== true) throw new Error('Confirmação obrigatória para alterar o calendário.'); }
const json = (body: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function createCalendarGateway(fetcher: Fetcher = fetch) {
  return {
    async listMonth(year: number, month: number, user = '') {
      const qs = `ano=${year}&mes=${month}`;
      const [r, l] = await Promise.all([
        request<{ reservas: CalendarReservation[] }>(fetcher, `/api/rh/reservas?${qs}`),
        request<{ lembretes: CalendarNotice[] }>(fetcher, `/api/rh/lembretes?${qs}&user=${encodeURIComponent(user)}`),
      ]);
      return { reservations: r.reservas || [], notices: l.lembretes || [] };
    },
    listUsers: () => request<Array<string | { username?: string; nome?: string }>>(fetcher, '/api/users/ativos'),
    createReservation: (payload: ReservationPayload, confirm?: true) => { confirmed(confirm); return request<{ ok: true; ids: number[] }>(fetcher, '/api/rh/reservas', { method: 'POST', ...json(payload) }); },
    updateReservation: (id: number, payload: ReservationPayload, confirm?: true) => { confirmed(confirm); return request<{ ok: true; id?: number }>(fetcher, `/api/rh/reservas/${id}`, { method: 'PUT', ...json(payload) }); },
    listMinutes: (id: number) => request<{ atas: MeetingMinute[] }>(fetcher, `/api/rh/atas?reserva_id=${id}`).then(x => x.atas || []),
    createMinute: (body: { reserva_id: number; tema: string; conteudo: string }, confirm?: true) => { confirmed(confirm); return request<{ id: number }>(fetcher, '/api/rh/atas', { method: 'POST', ...json(body) }); },
    listNotes: (id: number) => request<{ notas: MeetingNote[] }>(fetcher, `/api/rh/notas?reserva_id=${id}`).then(x => x.notas || []),
    createNote: (body: { reserva_id: number; texto: string; anexo_url: string | null; anexo_nome: string | null; visivel_todos: boolean }, confirm?: true) => { confirmed(confirm); return request<{ id: number }>(fetcher, '/api/rh/notas', { method: 'POST', ...json(body) }); },
    listAttendance: (id: number) => request<{ registros: Attendance[] }>(fetcher, `/api/rh/reservas/${id}/presenca`).then(x => x.registros || []),
    setAttendance: (id: number, body: { participantes: string[]; ausentes: string[]; data_reuniao: string }, confirm?: true) => { confirmed(confirm); return request<{ realizada: boolean }>(fetcher, `/api/rh/reservas/${id}/realizada`, { method: 'POST', ...json(body) }); },
    listAttachments: (id: number) => request<ReservationAttachment[]>(fetcher, `/api/rh/reservas/${id}/anexos`),
    addAttachment: (id: number, body: { url: string; nome: string }, confirm?: true) => { confirmed(confirm); return request<ReservationAttachment>(fetcher, `/api/rh/reservas/${id}/anexos`, { method: 'POST', ...json(body) }); },
    createNotice: (body: { data: string; texto: string; destinatarios: string[]; apenas_mencionados?: boolean; ata_id?: number }, confirm?: true) => { confirmed(confirm); return request<{ id: number }>(fetcher, '/api/rh/lembretes', { method: 'POST', ...json(body) }); },
  };
}
export const calendarGateway = createCalendarGateway();
