import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProductionTestsScreen } from "./ProductionTestsScreen";
it("does no reads without permission", () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<ProductionTestsScreen allowed={false} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Acesso não permitido");
  expect(fetch).not.toHaveBeenCalled();
});
