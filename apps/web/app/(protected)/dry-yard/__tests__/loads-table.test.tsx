import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { LoadsTable } from "../components/loads-table";

describe("LoadsTable", () => {
  it("renders empty state when there are no loads", () => {
    render(<LoadsTable loads={[]} />);

    expect(
      screen.getByText(/No planned or active loads yet./i),
    ).toBeInTheDocument();
  });
});
