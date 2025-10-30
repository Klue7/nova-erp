import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  addInvoiceLineSchema,
  applyPaymentSchema,
  receivePaymentSchema,
} from "../components/finance-tabs";

describe("finance schemas", () => {
  it("rejects negative invoice quantity", () => {
    const result = addInvoiceLineSchema.safeParse({
      invoiceId: randomUUID(),
      productId: randomUUID(),
      sku: "SKU-001",
      quantityUnits: -5,
      unitPrice: 10,
      taxRate: 0.15,
    });

    expect(result.success).toBe(false);
  });

  it("rejects negative payment amount", () => {
    const result = receivePaymentSchema.safeParse({
      code: "PAY-001",
      customerId: randomUUID(),
      amount: -100,
      currency: "ZAR",
      method: "EFT",
      reference: "ref",
      receivedAt: "2025-01-10",
    });

    expect(result.success).toBe(false);
  });

  it("parses positive application amount", () => {
    const result = applyPaymentSchema.safeParse({
      paymentId: randomUUID(),
      invoiceId: randomUUID(),
      amount: "250",
    });

    expect(result.success).toBe(true);
    expect(result.data.amount).toBe(250);
  });
});
