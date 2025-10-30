import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { BatchTable } from "../components/batch-table";

describe("Kiln BatchTable", () => {
  it("renders empty state when there are no batches", () => {
    render(<BatchTable batches={[]} />);

    expect(
      screen.getByText(/No planned or active kiln batches yet\./i),
    ).toBeInTheDocument();
  });
});
