import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { filterAndSortOrders, SalesControlScreen } from "./SalesControlScreen";
import type { SalesFilters, SalesOrder } from "./types";

const gateway = vi.hoisted(() => ({
  loadSalesOrders: vi.fn(),
  loadSalesOrderItems: vi.fn(),
}));
vi.mock("../../services/salesControlGateway", () => gateway);

const orders: SalesOrder[] = [
  {
    codigo_pedido: 2,
    numero_pedido: 102,
    cliente_nome: "Beta",
    etapa: "70",
    etapa_descricao: "Faturado/Entregue",
    created_at: "2026-08-20",
    data_previsao: "2026-08-25",
    origem_pedido: "OC-B",
    valor_total_pedido: 200,
  },
  {
    codigo_pedido: 1,
    numero_pedido: 101,
    cliente_nome: "Alfa",
    etapa: "10",
    etapa_descricao: "Em análise",
    created_at: "2026-08-19",
    data_previsao: "2026-08-24",
    origem_pedido: "OC-A",
    valor_total_pedido: 100,
  },
];

describe("SalesControlScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gateway.loadSalesOrders.mockResolvedValue({ ok: true, rows: orders });
    gateway.loadSalesOrderItems.mockResolvedValue({
      ok: true,
      rows: [
        { codigo: "P1", descricao: "Produto", quantidade: 2, valor_total: 50 },
      ],
    });
  });
  it("bloqueia a consulta sem permissão de navegação", () => {
    render(<SalesControlScreen allowed={false} />);
    expect(screen.getByText(/side:vendas:controle/)).toBeInTheDocument();
    expect(gateway.loadSalesOrders).not.toHaveBeenCalled();
  });
  it("filtra pedidos pelos cinco campos legados e mantém ordenação", () => {
    const empty: SalesFilters = {
      pedido: "",
      cliente: "",
      etapa: "",
      dataCriacao: "",
      origem: "",
    };
    expect(
      filterAndSortOrders(
        orders,
        { ...empty, cliente: "alfa" },
        "pedido",
        "desc",
      ).map((row) => row.codigo_pedido),
    ).toEqual([1]);
    expect(
      filterAndSortOrders(
        orders,
        {
          ...empty,
          etapa: "faturado",
          origem: "oc-b",
          dataCriacao: "20/08/2026",
        },
        "valor_total",
        "asc",
      ).map((row) => row.codigo_pedido),
    ).toEqual([2]);
  });
  it("abre detalhe somente leitura usando o código interno do pedido", async () => {
    const user = userEvent.setup();
    render(<SalesControlScreen />);
    const cards = await screen.findAllByRole("button", { name: /Pedido 102/ });
    await user.click(cards[0]!);
    expect((await screen.findAllByText("Produto")).length).toBeGreaterThan(0);
    expect(gateway.loadSalesOrderItems).toHaveBeenCalledWith(2, expect.any(AbortSignal));
  });
  it("filtra na interface sem nova chamada ao backend", async () => {
    const user = userEvent.setup();
    render(<SalesControlScreen />);
    await screen.findAllByText("Beta");
    await user.type(screen.getByLabelText("Cliente"), "Alfa");
    expect(screen.queryAllByText("Beta")).toHaveLength(0);
    expect(screen.getAllByText("Alfa").length).toBeGreaterThan(0);
    expect(gateway.loadSalesOrders).toHaveBeenCalledTimes(1);
  });
});
