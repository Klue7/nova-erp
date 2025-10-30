import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PalletTable } from "../components/pallet-table";

describe("PalletTable", () => {
  it("renders empty state when no pallets exist", () => {
    render(<PalletTable pallets={[]} />);

    expect(
      screen.getByText(/No pallets tracked yet/i),
    ).toBeInTheDocument();
  });
});
