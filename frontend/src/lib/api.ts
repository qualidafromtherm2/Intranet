import type { ProductFilters, ProductsResponse } from '../types';

type FetchProductsParams = {
  page: number;
  limit: number;
  filters: ProductFilters;
  signal?: AbortSignal;
};

export async function fetchProducts({
  page,
  limit,
  filters,
  signal,
}: FetchProductsParams): Promise<ProductsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });

  if (filters.q.trim()) params.set('q', filters.q.trim());
  params.set('searchMode', filters.searchMode);
  if (filters.inativo.length === 1) params.set('inativo', filters.inativo[0]);
  if (filters.utilidade.length) params.set('utilidade', filters.utilidade.join(','));

  const response = await fetch(`/api/produtos/lista?${params.toString()}`, {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Falha ao carregar produtos: HTTP ${response.status}`);
  }

  return response.json();
}
