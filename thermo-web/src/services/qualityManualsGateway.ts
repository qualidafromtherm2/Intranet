import type { MainManual, MasterDocument, MasterVersion, ProductManual, ProductSearchResult } from "../features/quality-manuals/types";
const base = import.meta.env.VITE_API_BASE_URL || "";
export class QualityManualsError extends Error { readonly status?: number; constructor(message: string, status?: number) { super(message); this.status = status; } }
async function request<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers); headers.set("Accept", "application/json");
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  let response: Response;
  try { response = await fetch(`${base}${path}`, { ...init, headers, credentials: "include", cache: "no-store" }); }
  catch (error) { throw new QualityManualsError(error instanceof Error ? error.message : "Falha de conexão."); }
  const raw = await response.text(); let data: Record<string, unknown> = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
  if (!response.ok || data.ok === false) throw new QualityManualsError(typeof data.error === "string" ? data.error : `Falha HTTP ${response.status}`, response.status);
  return data as T;
}
const requirePhrase = (actual: string, expected: string) => { if (actual !== expected) throw new QualityManualsError(`Confirme digitando: ${expected}`); };
export const loadMainManuals = () => request<{ ok: true; bucket?: string; pasta?: string; itens: MainManual[] }>("/api/qualidade/manuais-principais");
export const loadProductManuals = () => request<{ ok: true; manuais: ProductManual[]; total: number }>("/api/produtos/manuais/todos");
export const searchManualProducts = (query: string) => request<{ ok: true; produtos?: ProductSearchResult[]; items?: ProductSearchResult[] }>(`/api/produtos/search?q=${encodeURIComponent(query)}&limit=10`);
export function linkProduct(manualId: number, code: string, phrase: string) { requirePhrase(phrase, `VINCULAR PRODUTO ${code} AO MANUAL ${manualId}`); return request(`/api/manuais-chatbot/${manualId}/produtos`, { method: "POST", body: JSON.stringify({ codigo_produto: code }) }); }
export function unlinkProduct(manualId: number, code: string, phrase: string) { requirePhrase(phrase, `REMOVER PRODUTO ${code} DO MANUAL ${manualId}`); return request(`/api/manuais-chatbot/${manualId}/produtos/${encodeURIComponent(code)}`, { method: "DELETE" }); }
export const loadMasterDocuments = () => request<{ ok: true; itens: MasterDocument[] }>("/api/qualidade/lista-mestra");
export const loadMasterDocumentFile = (id: number) => request<{ ok: true; item: MasterDocument; historico: MasterVersion[] }>(`/api/qualidade/lista-mestra/${id}/arquivo`);
export const masterFileUrl = (id: number, preview = false, historyId?: number) => `${base}/api/qualidade/lista-mestra/${id}/download?${historyId ? `historico_id=${historyId}` : preview ? "preview=1" : ""}`;
export function uploadMasterRevision(id: number, file: File, description: string, phrase: string) { requirePhrase(phrase, `ENVIAR REVISAO ${id}`); const body = new FormData(); body.set("arquivo", file); body.set("descricao_alteracao", description.trim()); return request<{ ok: true; item: MasterDocument; historico: MasterVersion[] }>(`/api/qualidade/lista-mestra/${id}/arquivo`, { method: "POST", body }); }
