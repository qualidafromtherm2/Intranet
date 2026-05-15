import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  ClipboardList,
  Filter,
  Image,
  LayoutGrid,
  Loader2,
  PackageSearch,
  ShoppingCart,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchProducts } from './lib/api';
import type { Product, ProductFilters, PurchaseCartItem, SeparationCartItem } from './types';

const PAGE_SIZE = 48;

type AppView = 'produtos' | 'compras' | 'separacao';

type CartCounts = {
  compras: number;
  separacao: number;
};

const initialFilters: ProductFilters = {
  q: '',
  searchMode: 'tags',
  inativo: ['N'],
  familia: [],
  estoque: [],
  utilidade: [],
};

function asNumber(value: Product['quantidade_estoque']) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatStock(product: Product) {
  const amount = asNumber(product.quantidade_estoque);
  const unit = product.unidade || 'UN';
  return `${amount.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit}`;
}

function formatMinimum(product: Product) {
  const minimum = asNumber(product.estoque_minimo);
  if (minimum <= 0) return 'Sem minimo';
  const unit = product.unidade || 'UN';
  return `Min. ${minimum.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit}`;
}

function formatQuantity(value: string | number | null | undefined, unit = '') {
  const amount = asNumber(value);
  const formatted = amount.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return unit ? `${formatted} ${unit}` : formatted;
}

function imageSrc(product: Product) {
  const value = product.primeira_imagem?.trim();
  if (!value) return '';
  return value;
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function ProductImage({ product }: { product: Product }) {
  const src = imageSrc(product);
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-100 text-slate-400">
        <PackageSearch aria-hidden="true" size={30} strokeWidth={1.5} />
      </div>
    );
  }

  return (
    <img
      alt=""
      className="h-full w-full object-contain bg-white"
      loading="lazy"
      src={src}
      onError={() => setFailed(true)}
    />
  );
}

function ProductStatus({ product }: { product: Product }) {
  const inactive = product.inativo === 'S';
  const blocked = product.bloqueado === true || product.bloqueado === 'S';
  const stock = asNumber(product.quantidade_estoque);

  if (inactive) {
    return <span className="badge badge-muted">Inativo</span>;
  }

  if (blocked) {
    return <span className="badge badge-danger">Bloqueado</span>;
  }

  if (stock <= 0) {
    return <span className="badge badge-warning">Sem estoque</span>;
  }

  return <span className="badge badge-success">Disponivel</span>;
}

function ProductUtility({ product }: { product: Product }) {
  const description = String(product.descricao || '').trim().toUpperCase();
  const minimum = asNumber(product.estoque_minimo);

  if (description.startsWith('OBSOLETO')) {
    return <span className="badge badge-danger">Obsoleto</span>;
  }

  if (description.startsWith('ENGENHARIA')) {
    return <span className="badge badge-muted">Engenharia</span>;
  }

  if (minimum <= 0) {
    return <span className="badge badge-muted">Sem minimo</span>;
  }

  return null;
}

function ProductCard({
  product,
  onOpen,
  onPreviewImage,
  onAction,
}: {
  product: Product;
  onOpen: (product: Product) => void;
  onPreviewImage: (product: Product) => void;
  onAction: (product: Product, kind: ProductActionKind) => void;
}) {
  return (
    <article className="product-card flex min-h-[96px]">
      <button
        aria-label={`Expandir foto do produto ${product.codigo}`}
        className="image-preview-button"
        type="button"
        onClick={() => onPreviewImage(product)}
      >
        <ProductImage product={product} />
        <span className="image-preview-overlay">
          <Image size={16} />
          Ver foto
        </span>
      </button>

      <div className="grid min-w-0 flex-1 gap-2 p-3 md:grid-cols-[1fr_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-slate-950">{product.codigo || 'Sem codigo'}</p>
            <ProductStatus product={product} />
            <ProductUtility product={product} />
          </div>
          <p className="mt-1 line-clamp-1 text-sm leading-5 text-slate-700">
            {product.descricao || 'Produto sem descricao'}
          </p>

          <div className="mt-2 flex flex-wrap gap-2">
            <span className="soft-pill">{product.descricao_familia || 'Sem familia'}</span>
            <span className="soft-pill">{formatStock(product)}</span>
            <span className="soft-pill">{formatMinimum(product)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 md:justify-end">
          <button
            aria-label={`Adicionar ${product.codigo} ao carrinho de compras`}
            className="row-icon-button row-icon-button-buy"
            title="Carrinho de compras"
            type="button"
            onClick={() => onAction(product, 'compra')}
          >
            <ShoppingCart size={20} />
          </button>
          <button
            aria-label={`Adicionar ${product.codigo} a separacao`}
            className="row-icon-button row-icon-button-separation"
            title="Separacao"
            type="button"
            onClick={() => onAction(product, 'separacao')}
          >
            <ClipboardList size={20} />
          </button>
          <button className="row-action-button" type="button" onClick={() => onOpen(product)}>
            Detalhes
          </button>
          <a className="row-action-button" href="http://localhost:5001/menu_produto.html#produto-dados">
            Legado
          </a>
        </div>
      </div>
    </article>
  );
}

type ProductActionKind = 'compra' | 'separacao';

type PendingAction = {
  kind: ProductActionKind;
  product: Product;
} | null;

function ImagePreview({ product, onClose }: { product: Product | null; onClose: () => void }) {
  if (!product) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <section
        aria-modal="true"
        className="w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-2xl"
        role="dialog"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Foto do produto</p>
            <h2 className="truncate text-base font-bold text-slate-950">{product.codigo}</h2>
          </div>
          <button aria-label="Fechar foto" className="icon-button" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="h-[70vh] bg-slate-50">
          <ProductImage product={product} />
        </div>
      </section>
    </div>
  );
}

function ProductDetail({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  if (!product) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/70 p-0 sm:items-center sm:p-6">
      <section
        aria-modal="true"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-white shadow-2xl sm:mx-auto sm:max-w-3xl sm:rounded-lg"
        role="dialog"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Produto</p>
            <h2 className="truncate text-lg font-bold text-slate-950">{product.codigo}</h2>
          </div>
          <button
            aria-label="Fechar detalhes"
            className="icon-button"
            type="button"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-5 p-5 md:grid-cols-[240px_1fr]">
          <div className="h-64 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            <ProductImage product={product} />
          </div>

          <div className="space-y-5">
            <div>
              <div className="mb-3 flex flex-wrap gap-2">
                <ProductStatus product={product} />
                <ProductUtility product={product} />
                <span className="soft-pill">{product.descricao_familia || 'Sem familia'}</span>
              </div>
              <h3 className="text-xl font-bold leading-7 text-slate-950">{product.descricao}</h3>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <Info label="Codigo Omie" value={String(product.codigo_produto || '-')} />
              <Info label="Integracao" value={product.codigo_produto_integracao || '-'} />
              <Info label="Unidade" value={product.unidade || '-'} />
              <Info label="Estoque" value={formatStock(product)} />
              <Info label="Estoque minimo" value={formatMinimum(product)} />
              <Info label="Marca" value={product.marca || '-'} />
              <Info label="Modelo" value={product.modelo || '-'} />
              <Info label="NCM" value={product.ncm || '-'} />
              <Info label="Tipo item" value={product.tipoitem || '-'} />
            </dl>

          </div>
        </div>
      </section>
    </div>
  );
}

function QuantityActionDialog({
  action,
  onClose,
  onOptimisticAdd,
  onSettled,
  onError,
}: {
  action: PendingAction;
  onClose: () => void;
  onOptimisticAdd: (kind: ProductActionKind) => void;
  onSettled: () => void;
  onError: (message: string) => void;
}) {
  const [quantity, setQuantity] = useState('1');
  const [message, setMessage] = useState('');

  if (!action) return null;

  const { product, kind } = action;
  const isPurchase = kind === 'compra';
  const title = isPurchase ? 'COMPRA' : 'SEPARACAO';
  const subtitle = isPurchase
    ? 'Adicionar ao carrinho de compras'
    : 'Adicionar ao carrinho de separacao';

  async function submit() {
    const quantidade = Number(quantity.replace(',', '.'));
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      setMessage('Informe uma quantidade valida.');
      return;
    }

    setMessage('');
    onOptimisticAdd(kind);
    onClose();

    try {
      const payload =
        kind === 'separacao'
          ? {
              codigo: product.codigo,
              descricao: product.descricao,
              quantidade,
              unidade: product.unidade || 'UN',
            }
          : {
              produto_codigo: product.codigo,
              produto_descricao: product.descricao,
              quantidade,
              familia_nome: product.descricao_familia || null,
              codigo_produto_omie: product.codigo_produto || null,
              codigo_omie: product.codigo_produto || null,
              objetivo_compra: 'Compra via nova lista de produtos',
            };

      const response = await fetch(
        isPurchase ? '/api/compras/carrinho' : '/api/logistica/separacao',
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Nao foi possivel concluir a acao.');
    } finally {
      onSettled();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/70 p-0 sm:items-center sm:p-6">
      <section
        aria-modal="true"
        className="w-full rounded-t-lg bg-white p-5 text-slate-950 shadow-2xl sm:mx-auto sm:max-w-md sm:rounded-lg"
        role="dialog"
      >
        <div className={`action-dialog-heading ${isPurchase ? 'action-dialog-buy' : 'action-dialog-separation'}`}>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/15">
            {isPurchase ? <ShoppingCart size={24} /> : <ClipboardList size={24} />}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-85">{subtitle}</p>
            <h2 className="mt-0.5 text-2xl font-black tracking-wide">{title}</h2>
          </div>
          <button aria-label="Fechar quantidade" className="icon-button" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 min-w-0">
          <h3 className="truncate text-lg font-bold">{product.codigo}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{product.descricao}</p>
        </div>

        <label className="mt-5 block text-sm font-bold text-slate-700">
          Quantidade
          <input
            className="quantity-input mt-2"
            inputMode="decimal"
            placeholder="Ex.: 1"
            type="text"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>

        {message ? <p className="mt-3 text-sm font-semibold text-slate-700">{message}</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button className="secondary-button border-slate-300 bg-white text-slate-800 hover:bg-slate-100" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className={`primary-button ${isPurchase ? '' : 'primary-button-separation'}`} type="button" onClick={submit}>
            <Check size={16} />
            Adicionar
          </button>
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function FilterPanel({
  filters,
  families,
  onChange,
  onClear,
  onClose,
}: {
  filters: ProductFilters;
  families: string[];
  onChange: (filters: ProductFilters) => void;
  onClear: () => void;
  onClose?: () => void;
}) {
  function toggleValue<T extends string>(values: T[], value: T) {
    return values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value];
  }

  return (
    <div className="space-y-5">
      <FilterGroup title="Status" defaultOpen>
        <CheckboxFilter
          checked={filters.inativo.includes('N')}
          label="Ativos"
          onChange={() => onChange({ ...filters, inativo: toggleValue(filters.inativo, 'N') })}
        />
        <CheckboxFilter
          checked={filters.inativo.includes('S')}
          label="Inativos"
          onChange={() => onChange({ ...filters, inativo: toggleValue(filters.inativo, 'S') })}
        />
      </FilterGroup>

      <FilterGroup title="Estoque">
        <CheckboxFilter
          checked={filters.estoque.includes('com-estoque')}
          label="Com estoque"
          onChange={() =>
            onChange({ ...filters, estoque: toggleValue(filters.estoque, 'com-estoque') })
          }
        />
        <CheckboxFilter
          checked={filters.estoque.includes('sem-estoque')}
          label="Sem estoque"
          onChange={() =>
            onChange({ ...filters, estoque: toggleValue(filters.estoque, 'sem-estoque') })
          }
        />
      </FilterGroup>

      <FilterGroup title="Utilidade">
        <CheckboxFilter
          checked={(filters.utilidade || []).includes('obsoleto')}
          label="Obsoleto"
          onChange={() =>
            onChange({ ...filters, utilidade: toggleValue(filters.utilidade || [], 'obsoleto') })
          }
        />
        <CheckboxFilter
          checked={(filters.utilidade || []).includes('engenharia')}
          label="Engenharia"
          onChange={() =>
            onChange({ ...filters, utilidade: toggleValue(filters.utilidade || [], 'engenharia') })
          }
        />
        <CheckboxFilter
          checked={(filters.utilidade || []).includes('sem-minimo')}
          label="Sem minimo"
          onChange={() =>
            onChange({ ...filters, utilidade: toggleValue(filters.utilidade || [], 'sem-minimo') })
          }
        />
      </FilterGroup>

      <FilterGroup title="Familia">
        <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
          {families.length ? (
            families.map((family) => (
              <CheckboxFilter
                key={family}
                checked={filters.familia.includes(family)}
                label={family}
                onChange={() =>
                  onChange({ ...filters, familia: toggleValue(filters.familia, family) })
                }
              />
            ))
          ) : (
            <p className="text-sm text-slate-500 lg:text-slate-400">Carregue produtos para listar familias.</p>
          )}
        </div>
      </FilterGroup>

      <button className="secondary-button w-full" type="button" onClick={onClear}>
        <RotateCcw size={16} />
        Limpar filtros
      </button>

      <button className="secondary-button w-full md:hidden" type="button" onClick={onClose}>
        Aplicar filtros
      </button>
    </div>
  );
}

function FilterGroup({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="filter-section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="space-y-2 pt-3">{children}</div>
    </details>
  );
}

function CheckboxFilter({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="checkbox-filter">
      <input checked={checked} type="checkbox" onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function CartScreen({
  kind,
  onBack,
  onCountChange,
}: {
  kind: Exclude<AppView, 'produtos'>;
  onBack: () => void;
  onCountChange: (kind: Exclude<AppView, 'produtos'>, count: number) => void;
}) {
  const isPurchase = kind === 'compras';
  const [purchaseItems, setPurchaseItems] = useState<PurchaseCartItem[]>([]);
  const [separationItems, setSeparationItems] = useState<SeparationCartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');

  async function loadCart(signal?: AbortSignal) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(isPurchase ? '/api/compras/carrinho' : '/api/logistica/carrinho', {
        credentials: 'include',
        signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      if (isPurchase) {
        const itens = Array.isArray(data.itens) ? data.itens : [];
        setPurchaseItems(itens);
        onCountChange('compras', itens.length);
      } else {
        const itens = Array.isArray(data.itens) ? data.itens : [];
        setSeparationItems(itens);
        onCountChange('separacao', itens.length);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Nao foi possivel carregar o carrinho.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadCart(controller.signal);
    return () => controller.abort();
  }, [kind]);

  async function removeItem(id: number) {
    setBusyId(id);
    setError('');
    try {
      const response = await fetch(
        isPurchase ? `/api/compras/carrinho/${id}` : `/api/logistica/carrinho/${id}`,
        { credentials: 'include', method: 'DELETE' },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      await loadCart();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel remover o item.');
    } finally {
      setBusyId(null);
    }
  }

  const items = isPurchase ? purchaseItems : separationItems;
  const totalQuantity = items.reduce((sum, item) => sum + asNumber(item.quantidade), 0);

  return (
    <section className="mx-auto max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">
            {isPurchase ? 'Carrinho de compra' : 'Carrinho de separacao'}
          </p>
          <h2 className="text-xl font-bold text-white">
            {isPurchase ? 'Revisao dos itens de compra' : 'Revisao dos itens para separacao'}
          </h2>
        </div>
        <div className="flex gap-2">
          <button className="secondary-button" type="button" onClick={onBack}>
            <ArrowLeft size={17} />
            Produtos
          </button>
          <button className="secondary-button" disabled={loading} type="button" onClick={() => loadCart()}>
            <RefreshCw className={loading ? 'animate-spin' : ''} size={17} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Metric label="Itens no carrinho" value={String(items.length)} />
        <Metric label="Quantidade total" value={formatQuantity(totalQuantity)} />
      </div>

      {error ? (
        <div className="state-box border-red-400/40 bg-red-950/40 text-red-100">
          <AlertCircle size={22} />
          <div>
            <h2 className="font-bold">Erro no carrinho</h2>
            <p className="mt-1 text-sm text-red-100/80">{error}</p>
          </div>
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="state-box border-white/10 bg-panel text-slate-200">
          <Loader2 className="animate-spin" size={22} />
          Carregando carrinho...
        </div>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <div className="state-box border-white/10 bg-panel text-slate-200">
          {isPurchase ? <ShoppingCart size={24} /> : <ClipboardList size={24} />}
          <div>
            <h2 className="font-bold text-white">Carrinho vazio</h2>
            <p className="mt-1 text-sm text-slate-400">
              Adicione itens pela lista de produtos para revisar aqui.
            </p>
          </div>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="space-y-3">
          {isPurchase
            ? purchaseItems.map((item) => (
                <article className="cart-row" key={item.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-slate-950">{item.produto_codigo || 'Sem codigo'}</strong>
                      <span className="badge badge-warning">Compra</span>
                      <span className="soft-pill">{formatQuantity(item.quantidade)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-700">{item.produto_descricao}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.familia_produto ? <span className="soft-pill">{item.familia_produto}</span> : null}
                      {item.grupo_requisicao ? <span className="soft-pill">{item.grupo_requisicao}</span> : null}
                    </div>
                  </div>
                  <button
                    aria-label={`Remover ${item.produto_codigo} do carrinho de compras`}
                    className="danger-icon-button"
                    disabled={busyId === item.id}
                    type="button"
                    onClick={() => removeItem(item.id)}
                  >
                    {busyId === item.id ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
                  </button>
                </article>
              ))
            : separationItems.map((item) => (
                <article className="cart-row" key={item.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-slate-950">{item.codigo_produto || 'Sem codigo'}</strong>
                      <span className="badge badge-success">Separacao</span>
                      <span className="soft-pill">
                        {formatQuantity(item.quantidade, item.unidade || 'UN')}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-700">{item.descricao}</p>
                    {item.comentario ? (
                      <p className="mt-2 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                        {item.comentario}
                      </p>
                    ) : null}
                  </div>
                  <button
                    aria-label={`Remover ${item.codigo_produto} do carrinho de separacao`}
                    className="danger-icon-button"
                    disabled={busyId === item.id}
                    type="button"
                    onClick={() => removeItem(item.id)}
                  >
                    {busyId === item.id ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
                  </button>
                </article>
              ))}
        </div>
      ) : null}
    </section>
  );
}

function CartBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return <span className="cart-badge">+{count > 99 ? '99' : count}</span>;
}

function FloatingCartActions({
  counts,
  activeView,
  onOpen,
}: {
  counts: CartCounts;
  activeView: AppView;
  onOpen: (view: Exclude<AppView, 'produtos'>) => void;
}) {
  return (
    <div className="floating-cart-actions" aria-label="Carrinhos">
      <button
        aria-label={`Abrir carrinho de compras com ${counts.compras} itens`}
        className={activeView === 'compras' ? 'is-active' : ''}
        title="Carrinho de compras"
        type="button"
        onClick={() => onOpen('compras')}
      >
        <ShoppingCart size={24} />
        <CartBadge count={counts.compras} />
      </button>
      <button
        aria-label={`Abrir carrinho de separacao com ${counts.separacao} itens`}
        className={activeView === 'separacao' ? 'is-active' : ''}
        title="Carrinho de separacao"
        type="button"
        onClick={() => onOpen('separacao')}
      >
        <ClipboardList size={24} />
        <CartBadge count={counts.separacao} />
      </button>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<AppView>('produtos');
  const [filters, setFilters] = useState<ProductFilters>(initialFilters);
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [imagePreview, setImagePreview] = useState<Product | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [cartCounts, setCartCounts] = useState<CartCounts>({ compras: 0, separacao: 0 });
  const [toastMessage, setToastMessage] = useState('');
  const debouncedQuery = useDebouncedValue(filters.q, 350);
  const requestFilters = useMemo(
    () => ({ ...filters, q: debouncedQuery }),
    [filters.searchMode, filters.inativo, filters.familia, filters.estoque, filters.utilidade, debouncedQuery],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');

    fetchProducts({ page, limit: PAGE_SIZE, filters: requestFilters, signal: controller.signal })
      .then((data) => {
        setProducts(Array.isArray(data.itens) ? data.itens : []);
        setTotal(Number(data.total || 0));
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Erro inesperado ao carregar produtos.');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [requestFilters, page]);

  async function refreshCartCounts() {
    try {
      const [purchaseResponse, separationResponse] = await Promise.all([
        fetch('/api/compras/carrinho', { credentials: 'include' }),
        fetch('/api/logistica/carrinho', { credentials: 'include' }),
      ]);
      const [purchaseData, separationData] = await Promise.all([
        purchaseResponse.json().catch(() => ({})),
        separationResponse.json().catch(() => ({})),
      ]);

      setCartCounts({
        compras: Array.isArray(purchaseData.itens) ? purchaseData.itens.length : 0,
        separacao: Array.isArray(separationData.itens) ? separationData.itens.length : 0,
      });
    } catch {
      // Contador e apenas apoio visual; a tela do carrinho busca os dados completos.
    }
  }

  useEffect(() => {
    refreshCartCounts();
  }, []);

  function updateCartCount(kind: Exclude<AppView, 'produtos'>, count: number) {
    setCartCounts((current) => ({ ...current, [kind]: count }));
  }

  function optimisticAddToCart(kind: ProductActionKind) {
    setToastMessage(kind === 'compra' ? 'Item enviado ao carrinho de compra.' : 'Item enviado a separacao.');
    setCartCounts((current) =>
      kind === 'compra'
        ? { ...current, compras: current.compras + 1 }
        : { ...current, separacao: current.separacao + 1 },
    );
    window.setTimeout(() => setToastMessage(''), 1800);
  }

  function showActionError(message: string) {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(''), 3200);
  }

  const families = useMemo(() => {
    return Array.from(
      new Set(products.map((product) => product.descricao_familia).filter(Boolean) as string[]),
    ).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [products]);

  const visibleProducts = useMemo(() => {
    return products.filter((product) => {
      if (filters.familia.length && !filters.familia.includes(product.descricao_familia || '')) {
        return false;
      }

      if (filters.estoque.length === 1) {
        const stock = asNumber(product.quantidade_estoque);
        if (filters.estoque[0] === 'com-estoque') return stock > 0;
        if (filters.estoque[0] === 'sem-estoque') return stock <= 0;
      }

      return true;
    });
  }, [products, filters.familia, filters.estoque]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFilterCount =
    (filters.q.trim() ? 1 : 0) +
    (filters.inativo.length === 1 ? 1 : 0) +
    filters.familia.length +
    (filters.estoque.length === 1 ? 1 : 0) +
    (filters.utilidade?.length || 0);
  const activeFilterLabel =
    activeFilterCount === 1 ? '1 filtro ativo' : `${activeFilterCount} filtros ativos`;

  function updateFilters(next: ProductFilters) {
    setPage(1);
    setFilters(next);
  }

  function clearFilters() {
    setPage(1);
    setFilters(initialFilters);
  }

  return (
    <main className="min-h-screen bg-ink text-white">
      <header className="border-b border-white/10 bg-panel/95">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600">
                <Boxes aria-hidden="true" size={22} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">
                  Piloto nova interface
                </p>
                <h1 className="text-xl font-bold text-white sm:text-2xl">Lista de produtos</h1>
              </div>
            </div>

            <a className="legacy-link" href="http://localhost:5001/menu_produto.html#lista-produtos">
              Abrir tela antiga
            </a>
          </div>

          <nav className="pilot-nav" aria-label="Areas do piloto">
            <button
              className={view === 'produtos' ? 'is-active' : ''}
              type="button"
              onClick={() => setView('produtos')}
            >
              <PackageSearch size={18} />
              Produtos
            </button>
            <button
              className={view === 'compras' ? 'is-active' : ''}
              type="button"
              onClick={() => setView('compras')}
            >
              <ShoppingCart size={18} />
              Compra
              <CartBadge count={cartCounts.compras} />
            </button>
            <button
              className={view === 'separacao' ? 'is-active' : ''}
              type="button"
              onClick={() => setView('separacao')}
            >
              <ClipboardList size={18} />
              Separacao
              <CartBadge count={cartCounts.separacao} />
            </button>
          </nav>

          {view === 'produtos' ? <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="relative block">
              <span className="sr-only">Pesquisar produtos</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={18}
              />
              <input
                className="search-field"
                placeholder={
                  filters.searchMode === 'tags'
                    ? 'Ex.: CAIXA BRANCO'
                    : 'Pesquisar codigo ou descricao'
                }
                type="search"
                value={filters.q}
                onChange={(event) => updateFilters({ ...filters, q: event.target.value })}
              />
            </label>

            <div className="search-mode-group" role="group" aria-label="Modo de pesquisa">
              <button
                className={filters.searchMode === 'tags' ? 'is-active' : ''}
                type="button"
                onClick={() => updateFilters({ ...filters, searchMode: 'tags' })}
              >
                Tags
              </button>
              <button
                className={filters.searchMode === 'contains' ? 'is-active' : ''}
                type="button"
                onClick={() => updateFilters({ ...filters, searchMode: 'contains' })}
              >
                Contem
              </button>
              <button
                className={filters.searchMode === 'starts' ? 'is-active' : ''}
                type="button"
                onClick={() => updateFilters({ ...filters, searchMode: 'starts' })}
              >
                Comeca
              </button>
            </div>

            <button className="primary-button md:hidden" type="button" onClick={() => setDrawerOpen(true)}>
              <SlidersHorizontal size={18} />
              Filtros
            </button>
          </div> : null}
        </div>
      </header>

      {view !== 'produtos' ? (
        <CartScreen
          kind={view}
          onBack={() => setView('produtos')}
          onCountChange={updateCartCount}
        />
      ) : (
        <>
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[260px_1fr] lg:px-8">
        <aside className="hidden rounded-lg border border-white/10 bg-panel p-4 lg:block">
          <div className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
            <Filter size={16} />
            Filtros
          </div>
          <FilterPanel
            filters={filters}
            families={families}
            onChange={updateFilters}
            onClear={clearFilters}
          />
        </aside>

        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between rounded-lg border border-white/10 bg-panel px-3 py-2 text-sm text-slate-200 lg:hidden">
            <span>
              <strong className="text-white">{visibleProducts.length}</strong> de{' '}
              <strong className="text-white">{total.toLocaleString('pt-BR')}</strong>
            </span>
            <span>
              Pag. <strong className="text-white">{page}</strong>/<strong className="text-white">{totalPages}</strong>
            </span>
          </div>

          <div className="mb-4 hidden gap-3 rounded-lg border border-white/10 bg-panel p-4 sm:grid-cols-3 lg:grid">
            <Metric label="Total encontrado" value={total.toLocaleString('pt-BR')} />
            <Metric label="Nesta pagina" value={visibleProducts.length.toLocaleString('pt-BR')} />
            <Metric label="Pagina" value={`${page} de ${totalPages}`} />
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <span className="summary-chip">{activeFilterLabel}</span>
              {filters.q.trim() ? <span className="summary-chip">Busca: {filters.q.trim()}</span> : null}
              {filters.familia.map((family) => (
                <span className="summary-chip" key={family}>{family}</span>
              ))}
              {(filters.utilidade || []).map((item) => (
                <span className="summary-chip" key={item}>{item}</span>
              ))}
            </div>
            {activeFilterCount ? (
              <button className="ghost-button" type="button" onClick={clearFilters}>
                Limpar tudo
              </button>
            ) : null}
          </div>

          {error ? (
            <div className="state-box border-red-400/40 bg-red-950/40 text-red-100">
              <AlertCircle size={22} />
              <div>
                <h2 className="font-bold">Nao foi possivel carregar os produtos</h2>
                <p className="mt-1 text-sm text-red-100/80">{error}</p>
              </div>
            </div>
          ) : null}

          {loading && visibleProducts.length === 0 ? (
            <div className="state-box border-white/10 bg-panel text-slate-200">
              <Loader2 className="animate-spin" size={22} />
              Carregando produtos...
            </div>
          ) : null}

          {!loading && !error && visibleProducts.length === 0 ? (
            <div className="state-box border-white/10 bg-panel text-slate-200">
              <PackageSearch size={24} />
              <div>
                <h2 className="font-bold text-white">Nenhum produto encontrado</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Ajuste a busca ou remova filtros para ver mais itens.
                </p>
              </div>
            </div>
          ) : null}

          {!error && visibleProducts.length > 0 ? (
            <>
            <div className="space-y-3">
              {loading ? (
                <div className="refresh-strip">
                  <Loader2 className="animate-spin" size={16} />
                  Atualizando filtros...
                </div>
              ) : null}
              {visibleProducts.map((product) => (
                  <ProductCard
                    key={`${product.codigo_produto || product.codigo}-${product.codigo}`}
                    product={product}
                    onOpen={setSelected}
                    onPreviewImage={setImagePreview}
                    onAction={(product, kind) => setPendingAction({ product, kind })}
                  />
                ))}
              </div>

              <div className="mt-5 flex flex-col items-stretch justify-between gap-3 rounded-lg border border-white/10 bg-panel p-3 sm:flex-row sm:items-center">
                <button
                  className="secondary-button"
                  disabled={page <= 1 || loading}
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ArrowLeft size={18} />
                  Anterior
                </button>

                <div className="flex items-center justify-center gap-2 text-sm text-slate-300">
                  <LayoutGrid size={16} />
                  {PAGE_SIZE} itens por pagina
                </div>

                <button
                  className="secondary-button"
                  disabled={page >= totalPages || loading}
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  Proxima
                  <ArrowRight size={18} />
                </button>
              </div>
            </>
          ) : null}
        </section>
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 bg-slate-950/70 lg:hidden">
          <aside className="ml-auto h-full w-full max-w-sm overflow-y-auto bg-white p-5 text-slate-950">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-base font-bold">
                <Filter size={18} />
                Filtros
              </div>
              <button
                aria-label="Fechar filtros"
                className="icon-button"
                type="button"
                onClick={() => setDrawerOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <FilterPanel
              filters={filters}
              families={families}
              onChange={updateFilters}
              onClear={clearFilters}
              onClose={() => setDrawerOpen(false)}
            />
          </aside>
        </div>
      ) : null}
        </>
      )}

      <ProductDetail product={selected} onClose={() => setSelected(null)} />
      <ImagePreview product={imagePreview} onClose={() => setImagePreview(null)} />
      <FloatingCartActions
        activeView={view}
        counts={cartCounts}
        onOpen={(nextView) => setView(nextView)}
      />
      {toastMessage ? <div className="toast-message">{toastMessage}</div> : null}
      <QuantityActionDialog
        action={pendingAction}
        onClose={() => setPendingAction(null)}
        onError={showActionError}
        onOptimisticAdd={optimisticAddToCart}
        onSettled={refreshCartCounts}
      />
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white/5 p-3">
      <CheckCircle2 aria-hidden="true" className="text-cyan-300" size={20} />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-lg font-bold text-white">{value}</p>
      </div>
    </div>
  );
}
