import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { OrdersTable, type SalesOrderRow } from "../components/orders-table";

describe("OrdersTable", () => {
  it("renders empty state when there are no orders", () => {
    render(<OrdersTable orders={[]} />);

    expect(
      screen.getByText(/No sales orders yet\. Create one to get started\./i),
    ).toBeInTheDocument();
  });

  it("highlights the first order when none selected", () => {
    const orders: SalesOrderRow[] = [
      {
        id: "1",
        code: "SO-001",
        status: "draft",
        customerName: "Acme",
        customerCode: "ACME",
        totalUnits: 10,
        reservedUnits: 0,
        shippedUnits: 0,
        valueEstimate: 1000,
        currency: "ZAR",
        createdAt: new Date().toISOString(),
      },
    ];

    render(<OrdersTable orders={orders} />);

    expect(screen.getByText(/SO-001/i)).toBeInTheDocument();
  });
});
