import { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FinanceTabs } from "../components/finance-tabs";

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/finance",
  useSearchParams: () => mockSearchParams,
}));

function wrapper(children: ReactNode) {
  return render(<>{children}</>);
}

const baseProps = {
  invoices: [
    {
      id: "inv1",
      code: "INV-001",
      status: "draft",
      customerId: "cust1",
      customerName: "Acme Brick",
      issueDate: null,
      dueDate: null,
      grandTotal: 1000,
      balanceDue: 800,
      amountApplied: 200,
      currency: "ZAR",
    },
  ],
  invoiceLines: [
    {
      invoiceId: "inv1",
      productId: "prod1",
      sku: "BRICK-A",
      quantityUnits: 100,
      netAmount: 1000,
      taxAmount: 0,
    },
  ],
  invoiceTotals: [
    {
      invoiceId: "inv1",
      subtotal: 1000,
      taxTotal: 0,
      grandTotal: 1000,
      applied: 200,
      balance: 800,
    },
  ],
  customers: [
    {
      id: "cust1",
      code: "CUST1",
      name: "Acme Brick",
    },
  ],
  products: [
    {
      id: "prod1",
      sku: "BRICK-A",
      name: "Brick A",
    },
  ],
  shipments: [
    {
      id: "ship1",
      code: "SHIP-1",
      status: "dispatched",
    },
  ],
  payments: [
    {
      id: "pay1",
      code: "PAY-001",
      customerId: "cust1",
      customerName: "Acme Brick",
      amount: 500,
      currency: "ZAR",
      method: "EFT",
      reference: "ref",
      receivedAt: new Date().toISOString(),
      status: "open",
      appliedAmount: 200,
    },
  ],
  paymentApplications: [
    {
      id: "app1",
      paymentId: "pay1",
      invoiceId: "inv1",
      invoiceCode: "INV-001",
      amountApplied: 200,
    },
  ],
  agingBuckets: [
    { bucket: "0-30", total: 300 },
    { bucket: "31-60", total: 200 },
  ],
  agingRows: [
    {
      invoiceId: "inv1",
      invoiceCode: "INV-001",
      customerId: "cust1",
      customerName: "Acme Brick",
      dueDate: "2025-01-10",
      daysPastDue: 10,
      bucket: "0-30",
      balanceDue: 300,
    },
  ],
  customerExposure: [
    {
      customerId: "cust1",
      customerName: "Acme Brick",
      openBalance: 300,
    },
  ],
};

describe("FinanceTabs", () => {
  afterEach(() => {
    mockSearchParams = new URLSearchParams();
  });

  it("renders invoice balance after application", () => {
    mockSearchParams = new URLSearchParams("");
    wrapper(<FinanceTabs {...baseProps} />);

    const balanceLabel = screen.getByText(/Balance due/i);
    const balanceContainer = balanceLabel.closest("div");
    expect(balanceContainer).toHaveTextContent("800");
  });

  it("renders applied amount within payments tab", () => {
    mockSearchParams = new URLSearchParams("tab=payments&payment=pay1");
    wrapper(<FinanceTabs {...baseProps} />);

    const appliedLabel = screen.getByText(/^Applied$/i);
    const appliedContainer = appliedLabel.closest("div");
    expect(appliedContainer).toHaveTextContent("200");
  });
});
