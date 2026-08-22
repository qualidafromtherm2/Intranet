import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PurchaseSettingsScreen } from "./PurchaseSettingsScreen";
it("does no reads without permission", () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<PurchaseSettingsScreen allowed={false} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Acesso não permitido");
  expect(fetch).not.toHaveBeenCalled();
});
it("is conservatively read-only by default", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(JSON.stringify({ ok: true, departamentos: [] })),
      } as Response),
    ),
  );
  render(<PurchaseSettingsScreen />);
  expect(
    screen.queryByRole("button", { name: /Novo departamento/i }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/Modo somente consulta/)).toBeInTheDocument();
});
