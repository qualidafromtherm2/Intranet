import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { FirstPieceScreen } from "./FirstPieceScreen";

const response = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
it("does no reads when permission is denied", () => {
  render(<FirstPieceScreen allowed={false} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Acesso não permitido");
  expect(fetch).not.toHaveBeenCalled();
});
it("renders evidence and keeps the decision blocked until all checks and confirmation", async () => {
  vi.mocked(fetch)
    .mockImplementationOnce(() =>
      response({
        ok: true,
        codigo_produto: "10",
        descricao: "Produto",
        itens: [
          {
            id: 1,
            o_que_verificar: "Dimensão",
            especificacao: "10 mm",
            arquivo_url: "https://example.test/evidence.jpg",
          },
        ],
      }),
    )
    .mockImplementationOnce(() => response({ usuarios: [{ username: "qa" }] }));
  const user = userEvent.setup();
  render(<FirstPieceScreen />);
  await user.type(screen.getByLabelText("Código ou ID Omie do produto"), "A1");
  await user.click(screen.getByRole("button", { name: "Buscar" }));
  expect(await screen.findByAltText("Evidência: Dimensão")).toBeInTheDocument();
  const submit = screen.getByRole("button", { name: "Registrar verificação" });
  expect(submit).toBeDisabled();
  await user.type(screen.getByLabelText("Número da OP *"), "OP-1");
  await user.click(screen.getByRole("button", { name: "OK" }));
  expect(submit).toBeDisabled();
  await user.click(screen.getByRole("checkbox"));
  expect(submit).toBeEnabled();
  expect(fetch).toHaveBeenCalledTimes(2);
});
