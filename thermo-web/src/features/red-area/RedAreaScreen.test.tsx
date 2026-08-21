import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RedAreaScreen } from "./RedAreaScreen";
it("does no reads without permission", () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<RedAreaScreen allowed={false} />);
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
        text: () => Promise.resolve(JSON.stringify({ ok: true, itens: [] })),
      } as Response),
    ),
  );
  render(<RedAreaScreen />);
  expect(
    screen.queryByRole("button", { name: "Registrar NIQ" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/Modo somente consulta/)).toBeInTheDocument();
});
