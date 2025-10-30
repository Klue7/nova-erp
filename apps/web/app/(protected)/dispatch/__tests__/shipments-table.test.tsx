import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ShipmentsTable } from "../components/shipments-table";

describe("ShipmentsTable", () => {
  it("shows empty state when no shipments", () => {
    render(<ShipmentsTable shipments={[]} />);

    expect(
      screen.getByText(/No shipments yet/i),
    ).toBeInTheDocument();
  });
});
