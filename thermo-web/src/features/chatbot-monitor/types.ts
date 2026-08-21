export type MonitorSummary = Record<string, number>
export type MonitorRow = Record<string, unknown>
export type ChatbotMonitor = { ok: true; generatedAt: string; knowledgeLevel?: string; summary: MonitorSummary; learningReport?: { faqPorArea?: { area: string; total: number }[]; lacunasPorMotivo?: { motivo: string; total: number }[]; statusManuais?: { status: string; total: number }[] }; unresolvedQuestions?: MonitorRow[]; recentErrors?: MonitorRow[] }
export type MonitorDetails = { ok: true; dataset: string; total?: number; page?: number; pageSize?: number; rows?: MonitorRow[]; [key: string]: unknown }
