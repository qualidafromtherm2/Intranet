import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { InspectionRecordsScreen } from "./InspectionRecordsScreen";
it("does not read when permission is denied", () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<InspectionRecordsScreen allowed={false} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Acesso não permitido");
  expect(fetch).not.toHaveBeenCalled();
});
