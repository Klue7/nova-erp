import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { BatchTable } from "../components/batch-table";

describe("BatchTable", () => {
  it("renders empty state when there are no batches", () => {
    render(<BatchTable batches={[]} />);

    expect(
      screen.getByText(/No planned or active batches yet./i),
    ).toBeInTheDocument();
  });
});
