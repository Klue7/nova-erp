import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { QuickActions } from "../quick-actions";

describe("QuickActions", () => {
  it("renders all quick action cards", () => {
    render(<QuickActions />);

    expect(
      screen.getByRole("heading", {
        name: /Move faster with curated workflows/i,
      }),
    ).toBeInTheDocument();

    const workflowLinks = screen.getAllByRole("link", {
      name: /Open workflow/i,
    });

    expect(workflowLinks).toHaveLength(6);
  });
});
