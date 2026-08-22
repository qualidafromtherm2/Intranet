import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PreparationsScreen, preparationStation } from "./PreparationsScreen";
it("maps current and first planned preparation stations", () => {
  const stations = [
    { id: 1, nome: "Corte" },
    { id: 2, nome: "Dobra" },
  ];
  const op = { id: 7, identificacao: "OP" };
  expect(
    preparationStation(
      op,
      [
        {
          id: 1,
          op_producao_id: 7,
          status: "Dobra",
          postos: ["Corte", "Dobra"],
        },
      ],
      stations,
    ),
  ).toBe(2);
  expect(
    preparationStation(
      op,
      [
        {
          id: 1,
          op_producao_id: 7,
          status: "Programado",
          postos: ["Corte", "Dobra"],
        },
      ],
      stations,
    ),
  ).toBe(1);
});
it("does no reads without permission", () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<PreparationsScreen allowed={false} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Acesso não permitido");
  expect(fetch).not.toHaveBeenCalled();
});
