import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { RunTable } from "../components/run-table";

describe("Extrusion RunTable", () => {
  it("renders empty state when there are no runs", () => {
    render(<RunTable runs={[]} />);

    expect(
      screen.getByText(/No planned or active runs yet./i),
    ).toBeInTheDocument();
  });
});
