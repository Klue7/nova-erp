import { createServerSupabaseClient } from "@/utils/supabase/server";
import { logEvent } from "@/lib/events";
import { getUserProfile } from "@/lib/rbac";

const VIEW_MISSING_CODE = "42P01";

function ensurePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
}

function ensureNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} cannot be negative.`);
  }
}

async function assertProfile() {
  const { profile } = await getUserProfile();
  if (!profile) {
    throw new Error("Profile required for finance operations.");
  }
  return profile;
}

async function fetchInvoice(invoiceId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, tenant_id, code, status, currency")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Invoice not found.");
  }

  return data;
}

async function fetchPayment(paymentId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("payments")
    .select("id, tenant_id, code, amount, status")
    .eq("tenant_id", tenantId)
    .eq("id", paymentId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Payment not found.");
  }

  return data;
}

export async function createInvoice({
  code,
  customerId,
  currency = "ZAR",
}: {
  code: string;
  customerId: string;
  currency?: string;
}) {
  const trimmedCode = code.trim();
  if (!trimmedCode) {
    throw new Error("Invoice code is required.");
  }

  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", profile.tenant_id)
    .eq("id", customerId)
    .maybeSingle();

  if (customerError) {
    throw new Error(customerError.message);
  }
  if (!customer) {
    throw new Error("Customer not found.");
  }

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      tenant_id: profile.tenant_id,
      code: trimmedCode,
      customer_id: customer.id,
      currency: currency?.trim() || "ZAR",
      status: "draft",
    })
    .select("id, code")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to create invoice.");
  }

  await logEvent(supabase, {
    aggregateType: "invoice",
    aggregateId: data.id,
    eventType: "INVOICE_CREATED",
    payload: {
      invoiceId: data.id,
      invoiceCode: data.code,
      customerId: customer.id,
      currency: currency?.trim() || "ZAR",
    },
  });

  return data;
}

export async function addInvoiceLine({
  invoiceId,
  productId,
  sku,
  quantityUnits,
  unitPrice,
  taxRate,
}: {
  invoiceId: string;
  productId: string;
  sku: string;
  quantityUnits: number;
  unitPrice: number;
  taxRate: number;
}) {
  ensurePositive(quantityUnits, "Quantity");
  ensureNonNegative(unitPrice, "Unit price");

  const profile = await assertProfile();
  const invoice = await fetchInvoice(invoiceId, profile.tenant_id);

  if (invoice.status === "void" || invoice.status === "cancelled") {
    throw new Error("Cannot modify lines on cancelled or void invoices.");
  }

  const supabase = await createServerSupabaseClient();

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, sku")
    .eq("tenant_id", profile.tenant_id)
    .eq("id", productId)
    .maybeSingle();

  if (productError) {
    throw new Error(productError.message);
  }
  if (!product) {
    throw new Error("Product not found.");
  }

  await logEvent(supabase, {
    aggregateType: "invoice",
    aggregateId: invoice.id,
    eventType: "INVOICE_LINE_ADDED",
    payload: {
      invoiceId: invoice.id,
      productId: product.id,
      sku: sku.trim() || product.sku,
      quantityUnits,
      unitPrice,
      taxRate,
    },
  });
}

export async function removeInvoiceLine({
  invoiceId,
  productId,
  sku,
  quantityUnits,
  unitPrice,
  taxRate,
}: {
  invoiceId: string;
  productId: string;
  sku: string;
  quantityUnits: number;
  unitPrice: number;
  taxRate: number;
}) {
  ensurePositive(quantityUnits, "Quantity");

  const profile = await assertProfile();
  const invoice = await fetchInvoice(invoiceId, profile.tenant_id);
  if (invoice.status !== "draft") {
    throw new Error("Can only remove lines from draft invoices.");
  }

  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "invoice",
    aggregateId: invoice.id,
    eventType: "INVOICE_LINE_REMOVED",
    payload: {
      invoiceId: invoice.id,
      productId,
      sku: sku.trim(),
      quantityUnits,
      unitPrice,
      taxRate,
    },
  });
}

export async function issueInvoice({
  invoiceId,
  termsDays = 30,
  issueDate,
}: {
  invoiceId: string;
  termsDays?: number;
  issueDate?: string | Date;
}) {
  const profile = await assertProfile();
  const invoice = await fetchInvoice(invoiceId, profile.tenant_id);
  if (invoice.status !== "draft") {
    throw new Error("Only draft invoices can be issued.");
  }

  const baseIssueDate =
    typeof issueDate === "string"
      ? new Date(issueDate)
      : issueDate instanceof Date
        ? issueDate
        : new Date();

  if (Number.isNaN(baseIssueDate.getTime())) {
    throw new Error("Issue date is invalid.");
  }

  const dueDate = new Date(baseIssueDate);
  dueDate.setDate(dueDate.getDate() + termsDays);

  const issueDateIso = baseIssueDate.toISOString().slice(0, 10);
  const dueDateIso = dueDate.toISOString().slice(0, 10);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("invoices")
    .update({
      status: "issued",
      issue_date: issueDateIso,
      due_date: dueDateIso,
    })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", invoice.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "invoice",
    aggregateId: invoice.id,
    eventType: "INVOICE_ISSUED",
    payload: {
      invoiceId: invoice.id,
      issueDate: issueDateIso,
      dueDate: dueDateIso,
      termsDays,
    },
  });
}

export async function voidInvoice({
  invoiceId,
  reason,
}: {
  invoiceId: string;
  reason?: string | null;
}) {
  const profile = await assertProfile();
  const invoice = await fetchInvoice(invoiceId, profile.tenant_id);
  if (invoice.status === "void") {
    return;
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("invoices")
    .update({ status: "void", cancelled_at: new Date().toISOString() })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", invoice.id);
  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "invoice",
    aggregateId: invoice.id,
    eventType: "INVOICE_VOIDED",
    payload: {
      invoiceId: invoice.id,
      reason: reason?.trim() || null,
    },
  });
}

export async function receivePayment({
  code,
  customerId,
  amount,
  currency = "ZAR",
  method,
  reference,
  receivedAt,
}: {
  code: string;
  customerId: string;
  amount: number;
  currency?: string;
  method?: string | null;
  reference?: string | null;
  receivedAt?: string | Date | null;
}) {
  const trimmedCode = code.trim();
  if (!trimmedCode) {
    throw new Error("Payment code is required.");
  }
  ensurePositive(amount, "Payment amount");

  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", profile.tenant_id)
    .eq("id", customerId)
    .maybeSingle();

  if (customerError) {
    throw new Error(customerError.message);
  }
  if (!customer) {
    throw new Error("Customer not found.");
  }

  const receivedAtIso =
    receivedAt instanceof Date
      ? receivedAt.toISOString()
      : typeof receivedAt === "string" && receivedAt.trim() !== ""
        ? new Date(receivedAt).toISOString()
        : new Date().toISOString();

  const { data, error } = await supabase
    .from("payments")
    .insert({
      tenant_id: profile.tenant_id,
      code: trimmedCode,
      customer_id: customer.id,
      amount,
      currency: currency?.trim() || "ZAR",
      method: method?.trim() || null,
      reference: reference?.trim() || null,
      received_at: receivedAtIso,
      status: "open",
    })
    .select("id, code")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to record payment.");
  }

  await logEvent(supabase, {
    aggregateType: "payment",
    aggregateId: data.id,
    eventType: "PAYMENT_RECEIVED",
    payload: {
      paymentId: data.id,
      paymentCode: data.code,
      customerId: customer.id,
      amount,
      currency: currency?.trim() || "ZAR",
      method: method?.trim() || null,
      reference: reference?.trim() || null,
      receivedAt: receivedAtIso,
    },
  });

  return data;
}

export async function applyPayment({
  paymentId,
  invoiceId,
  amount,
}: {
  paymentId: string;
  invoiceId: string;
  amount: number;
}) {
  ensurePositive(amount, "Applied amount");

  const profile = await assertProfile();
  const payment = await fetchPayment(paymentId, profile.tenant_id);
  await fetchInvoice(invoiceId, profile.tenant_id);

  if (payment.status === "reversed") {
    throw new Error("Cannot apply a reversed payment.");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("payment_applications")
    .insert({
      tenant_id: profile.tenant_id,
      payment_id: payment.id,
      invoice_id: invoiceId,
      amount_applied: amount,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to apply payment.");
  }

  await logEvent(supabase, {
    aggregateType: "payment",
    aggregateId: payment.id,
    eventType: "PAYMENT_APPLIED",
    payload: {
      paymentId: payment.id,
      invoiceId,
      amount,
      applicationId: data.id,
    },
  });

  const { data: totalAppliedRow, error: totalAppliedError } = await supabase
    .from("payment_applications")
    .select("amount_applied")
    .eq("tenant_id", profile.tenant_id)
    .eq("payment_id", payment.id);

  if (totalAppliedError && totalAppliedError.code !== VIEW_MISSING_CODE) {
    throw new Error(totalAppliedError.message);
  }

  const totalApplied = (totalAppliedRow ?? []).reduce(
    (sum, row) => sum + Number(row.amount_applied ?? 0),
    0,
  );

  if (totalApplied >= Number(payment.amount)) {
    const { error: statusError } = await supabase
      .from("payments")
      .update({ status: "applied" })
      .eq("tenant_id", profile.tenant_id)
      .eq("id", payment.id);

    if (statusError) {
      throw new Error(statusError.message);
    }
  }

  return data;
}

export async function unapplyPayment({ applicationId }: { applicationId: string }) {
  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();

  const { data: application, error: fetchError } = await supabase
    .from("payment_applications")
    .select("id, payment_id, invoice_id, amount_applied")
    .eq("tenant_id", profile.tenant_id)
    .eq("id", applicationId)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }
  if (!application) {
    throw new Error("Payment application not found.");
  }

  const { error: deleteError } = await supabase
    .from("payment_applications")
    .delete()
    .eq("tenant_id", profile.tenant_id)
    .eq("id", application.id);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  await logEvent(supabase, {
    aggregateType: "payment",
    aggregateId: application.payment_id,
    eventType: "PAYMENT_UNAPPLIED_ADJUSTED",
    payload: {
      applicationId: application.id,
      paymentId: application.payment_id,
      invoiceId: application.invoice_id,
      amount: Number(application.amount_applied ?? 0),
    },
  });

  const payment = await fetchPayment(application.payment_id, profile.tenant_id);

  const { data: remainingApps, error: remainingError } = await supabase
    .from("payment_applications")
    .select("amount_applied")
    .eq("tenant_id", profile.tenant_id)
    .eq("payment_id", payment.id);

  if (remainingError && remainingError.code !== VIEW_MISSING_CODE) {
    throw new Error(remainingError.message);
  }

  const appliedSum = (remainingApps ?? []).reduce(
    (sum, row) => sum + Number(row.amount_applied ?? 0),
    0,
  );

  const nextStatus = appliedSum > 0 ? "applied" : "open";
  if (nextStatus !== payment.status) {
    const { error: updateError } = await supabase
      .from("payments")
      .update({ status: nextStatus })
      .eq("tenant_id", profile.tenant_id)
      .eq("id", payment.id);

    if (updateError) {
      throw new Error(updateError.message);
    }
  }
}

export async function reversePayment({
  paymentId,
  reason,
}: {
  paymentId: string;
  reason?: string | null;
}) {
  const profile = await assertProfile();
  const payment = await fetchPayment(paymentId, profile.tenant_id);
  if (payment.status === "reversed") {
    return;
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("payments")
    .update({ status: "reversed" })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", payment.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "payment",
    aggregateId: payment.id,
    eventType: "PAYMENT_REVERSED",
    payload: {
      paymentId: payment.id,
      reason: reason?.trim() || null,
    },
  });
}

export async function invoiceFromShipment({
  shipmentId,
  invoiceCode,
  customerId,
  currency = "ZAR",
}: {
  shipmentId: string;
  invoiceCode: string;
  customerId: string;
  currency?: string;
}) {
  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();

  const { data: picks, error: picksError } = await supabase
    .from("shipment_picks_by_order_v")
    .select("sku, net_units")
    .eq("tenant_id", profile.tenant_id)
    .eq("shipment_id", shipmentId)
    .gt("net_units", 0);

  if (picksError && picksError.code !== VIEW_MISSING_CODE) {
    throw new Error(picksError.message);
  }

  const pickRows = picks ?? [];
  if (pickRows.length === 0) {
    throw new Error("No picked units found for this shipment.");
  }

  const invoice = await createInvoice({
    code: invoiceCode,
    customerId,
    currency,
  });

  const skuList = Array.from(new Set(pickRows.map((row) => row.sku).filter(Boolean)));

  if (skuList.length === 0) {
    return invoice;
  }

  const { data: productRows, error: productsError } = await supabase
    .from("products")
    .select("id, sku")
    .eq("tenant_id", profile.tenant_id)
    .in("sku", skuList);

  if (productsError) {
    throw new Error(productsError.message);
  }

  const productMap = new Map<string, string>();
  (productRows ?? []).forEach((row) => {
    productMap.set(row.sku, row.id);
  });

  const { data: priceRows, error: priceError } = await supabase
    .from("current_product_price_v")
    .select("product_id, unit_price, currency")
    .eq("tenant_id", profile.tenant_id);

  if (priceError && priceError.code !== VIEW_MISSING_CODE) {
    throw new Error(priceError.message);
  }

  const priceMap = new Map<string, { unitPrice: number; currency: string | null }>();
  (priceRows ?? []).forEach((row) => {
    priceMap.set(row.product_id, {
      unitPrice: Number(row.unit_price ?? 0),
      currency: row.currency ?? currency,
    });
  });

  for (const pick of pickRows) {
    if (!pick.sku) continue;
    const productId = productMap.get(pick.sku);
    if (!productId) {
      console.warn("invoiceFromShipment: missing product for sku", pick.sku);
      continue;
    }
    const priceInfo = priceMap.get(productId);
    if (!priceInfo || priceInfo.unitPrice <= 0) {
      console.warn("invoiceFromShipment: no price for product", productId);
      continue;
    }
    const quantity = Number(pick.net_units ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    await addInvoiceLine({
      invoiceId: invoice.id,
      productId,
      sku: pick.sku,
      quantityUnits: quantity,
      unitPrice: priceInfo.unitPrice,
      taxRate: 0,
    });
  }

  const { data: totalsRow, error: totalsError } = await supabase
    .from("invoice_totals_v")
    .select("subtotal, tax_total, grand_total")
    .eq("tenant_id", profile.tenant_id)
    .eq("invoice_id", invoice.id)
    .maybeSingle();

  if (totalsError && totalsError.code !== VIEW_MISSING_CODE) {
    throw new Error(totalsError.message);
  }

  return {
    invoiceId: invoice.id,
    totals: {
      subtotal: Number(totalsRow?.subtotal ?? 0),
      tax: Number(totalsRow?.tax_total ?? 0),
      grandTotal: Number(totalsRow?.grand_total ?? 0),
    },
  };
}

export async function getAgingSummary() {
  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();

  const [agingRes, customerRes, kpiRes] = await Promise.all([
    supabase
      .from("ar_aging_v")
      .select("invoice_id, invoice_code, customer_id, balance_due, bucket, days_past_due, due_date")
      .eq("tenant_id", profile.tenant_id),
    supabase
      .from("customer_ar_balance_v")
      .select("customer_id, open_balance")
      .eq("tenant_id", profile.tenant_id),
    supabase
      .from("finance_kpi_today")
      .select("invoices_issued_today, value_issued_today, payments_received_today, open_ar_total")
      .eq("tenant_id", profile.tenant_id)
      .maybeSingle(),
  ]);

  const tolerateViewMissing = (error: unknown) =>
    !error || (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === VIEW_MISSING_CODE);

  if (!tolerateViewMissing(agingRes.error)) {
    throw agingRes.error;
  }
  if (!tolerateViewMissing(customerRes.error)) {
    throw customerRes.error;
  }
  if (!tolerateViewMissing(kpiRes.error)) {
    throw kpiRes.error;
  }

  const bucketTotals = new Map<string, number>();
  const agingRows = agingRes.data ?? [];

  agingRows.forEach((row) => {
    const bucket = row.bucket ?? "0-30";
    const balance = Number(row.balance_due ?? 0);
    bucketTotals.set(bucket, (bucketTotals.get(bucket) ?? 0) + balance);
  });

  return {
    buckets: bucketTotals,
    aging: agingRows,
    customerExposure: customerRes.data ?? [],
    kpi: {
      invoicesIssuedToday: Number(kpiRes.data?.invoices_issued_today ?? 0),
      valueIssuedToday: Number(kpiRes.data?.value_issued_today ?? 0),
      paymentsReceivedToday: Number(kpiRes.data?.payments_received_today ?? 0),
      openArTotal: Number(kpiRes.data?.open_ar_total ?? 0),
    },
  };
}
