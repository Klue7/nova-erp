import { redirect } from "next/navigation";

import { FinanceTabs } from "./components/finance-tabs";
import { FinanceKpiCards, type FinanceKpi } from "./components/finance-kpi-cards";
import { guardRoute, type Role } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const VIEW_MISSING_CODE = "42P01";
const ALLOWED_ROLES: Role[] = ["finance", "admin"];

function isViewMissing(error: unknown) {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === VIEW_MISSING_CODE
  );
}

export default async function FinancePage() {
  const { profile } = await guardRoute();

  if (!profile) {
    return null;
  }

  if (!ALLOWED_ROLES.includes(profile.role)) {
    redirect("/dashboard?toast=access-denied");
  }

  const supabase = await createServerSupabaseClient();
  const tenantId = profile.tenant_id;

  const [
    kpiRes,
    invoicesRes,
    customersRes,
    productsRes,
    paymentsRes,
    shipmentsRes,
    agingRes,
    exposureRes,
  ] = await Promise.all([
    supabase
      .from("finance_kpi_today")
      .select("invoices_issued_today, value_issued_today, payments_received_today, open_ar_total")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("invoices")
      .select(
        "id, code, status, issue_date, due_date, currency, customer:customer_id (id, name, code)",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("customers")
      .select("id, code, name")
      .eq("tenant_id", tenantId)
      .order("name"),
    supabase
      .from("products")
      .select("id, sku, name")
      .eq("tenant_id", tenantId)
      .order("sku"),
    supabase
      .from("payments")
      .select(
        "id, code, amount, currency, method, reference, received_at, status, customer:customer_id (id, name)",
      )
      .eq("tenant_id", tenantId)
      .order("received_at", { ascending: false })
      .limit(25),
    supabase
      .from("shipments")
      .select("id, code, status")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("ar_aging_v")
      .select("invoice_id, invoice_code, customer_id, balance_due, bucket, days_past_due, due_date")
      .eq("tenant_id", tenantId),
    supabase
      .from("customer_ar_balance_v")
      .select("customer_id, open_balance")
      .eq("tenant_id", tenantId),
  ]);

  if (invoicesRes.error) throw invoicesRes.error;
  if (customersRes.error) throw customersRes.error;
  if (productsRes.error) throw productsRes.error;
  if (paymentsRes.error) throw paymentsRes.error;
  if (shipmentsRes.error) throw shipmentsRes.error;
  if (!isViewMissing(agingRes.error) && agingRes.error) throw agingRes.error;
  if (!isViewMissing(exposureRes.error) && exposureRes.error) throw exposureRes.error;

  const invoiceIds = invoicesRes.data?.map((invoice) => invoice.id) ?? [];
  const paymentIds = paymentsRes.data?.map((payment) => payment.id) ?? [];

  const [invoiceBalanceRes, invoiceTotalsRes, invoiceLinesRes, paymentAppsRes] =
    await Promise.all([
      invoiceIds.length
        ? supabase
            .from("invoice_balance_v")
            .select("invoice_id, grand_total, amount_applied, balance_due")
            .eq("tenant_id", tenantId)
            .in("invoice_id", invoiceIds)
        : Promise.resolve({ data: [], error: null, status: 200, statusText: "OK" }),
      invoiceIds.length
        ? supabase
            .from("invoice_totals_v")
            .select("invoice_id, subtotal, tax_total, grand_total")
            .eq("tenant_id", tenantId)
            .in("invoice_id", invoiceIds)
        : Promise.resolve({ data: [], error: null, status: 200, statusText: "OK" }),
      invoiceIds.length
        ? supabase
            .from("invoice_lines_v")
            .select("invoice_id, product_id, sku, quantity_units, net_amount, tax_amount")
            .eq("tenant_id", tenantId)
            .in("invoice_id", invoiceIds)
        : Promise.resolve({ data: [], error: null, status: 200, statusText: "OK" }),
      paymentIds.length
        ? supabase
            .from("payment_applications")
            .select("id, payment_id, invoice_id, amount_applied")
            .eq("tenant_id", tenantId)
            .in("payment_id", paymentIds)
        : Promise.resolve({ data: [], error: null, status: 200, statusText: "OK" }),
    ]);

  if (!isViewMissing(invoiceBalanceRes.error) && invoiceBalanceRes.error) {
    throw invoiceBalanceRes.error;
  }
  if (!isViewMissing(invoiceTotalsRes.error) && invoiceTotalsRes.error) {
    throw invoiceTotalsRes.error;
  }
  if (!isViewMissing(invoiceLinesRes.error) && invoiceLinesRes.error) {
    throw invoiceLinesRes.error;
  }
  if (!isViewMissing(paymentAppsRes.error) && paymentAppsRes.error) {
    throw paymentAppsRes.error;
  }

  const customerMap = new Map(
    (customersRes.data ?? []).map((customer) => [customer.id, customer]),
  );

  const invoiceBalanceMap = new Map(
    (invoiceBalanceRes.data ?? []).map((row) => [row.invoice_id, row]),
  );

  const invoiceTotalsMap = new Map(
    (invoiceTotalsRes.data ?? []).map((row) => [row.invoice_id, row]),
  );

  const invoices = (invoicesRes.data ?? []).map((invoice) => {
    const customer = Array.isArray(invoice.customer)
      ? invoice.customer[0] ?? null
      : (invoice.customer ?? null);
    const balanceRow = invoiceBalanceMap.get(invoice.id);
    return {
      id: invoice.id,
      code: invoice.code,
      status: invoice.status,
      customerId: customer?.id ?? "",
      customerName: customer?.name ?? "Unknown",
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date,
      grandTotal: Number(balanceRow?.grand_total ?? 0),
      balanceDue: Number(balanceRow?.balance_due ?? 0),
      amountApplied: Number(balanceRow?.amount_applied ?? 0),
      currency: invoice.currency ?? "ZAR",
    };
  });

  const invoiceLines = (invoiceLinesRes.data ?? []).map((line) => ({
    invoiceId: line.invoice_id,
    productId: line.product_id,
    sku: line.sku,
    quantityUnits: Number(line.quantity_units ?? 0),
    netAmount: Number(line.net_amount ?? 0),
    taxAmount: Number(line.tax_amount ?? 0),
  }));

  const invoiceTotals = invoices.map((invoice) => {
    const totalsRow = invoiceTotalsMap.get(invoice.id);
    return {
      invoiceId: invoice.id,
      subtotal: Number(totalsRow?.subtotal ?? invoice.grandTotal),
      taxTotal: Number(totalsRow?.tax_total ?? 0),
      grandTotal: Number(totalsRow?.grand_total ?? invoice.grandTotal),
      applied: invoice.amountApplied,
      balance: invoice.balanceDue,
    };
  });

  const payments = (paymentsRes.data ?? []).map((payment) => {
    const customer = Array.isArray(payment.customer)
      ? payment.customer[0] ?? null
      : (payment.customer ?? null);
    const appliedAmount = (paymentAppsRes.data ?? [])
      .filter((app) => app.payment_id === payment.id)
      .reduce((sum, app) => sum + Number(app.amount_applied ?? 0), 0);

    return {
      id: payment.id,
      code: payment.code,
      customerId: customer?.id ?? "",
      customerName: customer?.name ?? "Unknown",
      amount: Number(payment.amount ?? 0),
      currency: payment.currency ?? "ZAR",
      method: payment.method ?? null,
      reference: payment.reference ?? null,
      receivedAt: payment.received_at,
      status: payment.status,
      appliedAmount,
    };
  });

  const paymentApplications = (paymentAppsRes.data ?? []).map((application) => {
    const invoice = invoices.find((row) => row.id === application.invoice_id);
    return {
      id: application.id,
      paymentId: application.payment_id,
      invoiceId: application.invoice_id,
      invoiceCode: invoice?.code ?? null,
      amountApplied: Number(application.amount_applied ?? 0),
    };
  });

  const shipments = (shipmentsRes.data ?? []).map((shipment) => ({
    id: shipment.id,
    code: shipment.code,
    status: shipment.status ?? null,
  }));

  const kpi: FinanceKpi = {
    invoicesIssuedToday: Number(kpiRes.data?.invoices_issued_today ?? 0),
    valueIssuedToday: Number(kpiRes.data?.value_issued_today ?? 0),
    paymentsReceivedToday: Number(kpiRes.data?.payments_received_today ?? 0),
    openArTotal: Number(kpiRes.data?.open_ar_total ?? 0),
  };

  const agingRows = (agingRes.data ?? []).map((row) => ({
    invoiceId: row.invoice_id,
    invoiceCode: row.invoice_code,
    customerId: row.customer_id,
    customerName: customerMap.get(row.customer_id)?.name ?? null,
    dueDate: row.due_date,
    daysPastDue: Number(row.days_past_due ?? 0),
    bucket: row.bucket ?? "0-30",
    balanceDue: Number(row.balance_due ?? 0),
  }));

  const agingBucketMap = new Map<string, number>();
  agingRows.forEach((row) => {
    agingBucketMap.set(row.bucket, (agingBucketMap.get(row.bucket) ?? 0) + row.balanceDue);
  });

  const agingBuckets = Array.from(agingBucketMap.entries()).map(([bucket, total]) => ({
    bucket,
    total,
  }));

  const customerExposure = (exposureRes.data ?? []).map((row) => ({
    customerId: row.customer_id,
    customerName: customerMap.get(row.customer_id)?.name ?? null,
    openBalance: Number(row.open_balance ?? 0),
  }));

  const customers = (customersRes.data ?? []).map((customer) => ({
    id: customer.id,
    code: customer.code,
    name: customer.name,
  }));

  const products = (productsRes.data ?? []).map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
  }));

  return (
    <div className="space-y-8">
      <FinanceKpiCards data={kpi} />
      <FinanceTabs
        invoices={invoices}
        invoiceLines={invoiceLines}
        invoiceTotals={invoiceTotals}
        customers={customers}
        products={products}
        shipments={shipments}
        payments={payments}
        paymentApplications={paymentApplications}
        agingBuckets={agingBuckets}
        agingRows={agingRows}
        customerExposure={customerExposure}
      />
    </div>
  );
}
