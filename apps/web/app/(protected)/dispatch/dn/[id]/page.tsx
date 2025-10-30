import { redirect } from "next/navigation";

import { guardRoute } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const ALLOWED_ROLES = ["dispatch_clerk", "admin"] as const;
const VIEW_MISSING_CODE = "42P01";

function isViewMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === VIEW_MISSING_CODE
  );
}

function numberOrZero(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export default async function DeliveryNotePage({ params }: { params: { id: string } }) {
  const { profile } = await guardRoute();
  if (!profile) {
    redirect("/login");
  }

  if (!ALLOWED_ROLES.includes(profile.role as typeof ALLOWED_ROLES[number])) {
    redirect("/dashboard?toast=access-denied");
  }

  const supabase = await createServerSupabaseClient();

  const summaryQuery = supabase
    .from("shipment_summary_v")
    .select(
      "shipment_id, code, status, customer_code, customer_name, carrier, vehicle_reg, trailer_reg, seal_no, net_kg_estimate, created_at, dispatched_at",
    )
    .eq("tenant_id", profile.tenant_id)
    .eq("shipment_id", params.id)
    .maybeSingle();

  const shipmentQuery = supabase
    .from("shipments")
    .select("delivery_address")
    .eq("tenant_id", profile.tenant_id)
    .eq("id", params.id)
    .maybeSingle();

  const picksQuery = supabase
    .from("shipment_picks_v")
    .select("pallet_id, picked_units")
    .eq("tenant_id", profile.tenant_id)
    .eq("shipment_id", params.id)
    .gt("picked_units", 0);

  const [summaryRes, shipmentRes, picksRes] = await Promise.all([
    summaryQuery,
    shipmentQuery,
    picksQuery,
  ]);

  if (summaryRes.error) {
    throw new Error(summaryRes.error.message);
  }
  if (!summaryRes.data) {
    redirect("/dispatch");
  }

  if (shipmentRes.error) {
    throw new Error(shipmentRes.error.message);
  }

  if (picksRes.error && !isViewMissing(picksRes.error)) {
    throw new Error(picksRes.error.message);
  }

  const pickRows = picksRes.data ?? [];
  const palletIds = pickRows.map((row) => row.pallet_id);

  let palletMeta = new Map<string, { code: string; productSku: string | null; grade: string | null }>();
  if (palletIds.length > 0) {
    const palletRes = await supabase
      .from("pallet_inventory_v")
      .select("pallet_id, code, product_sku, grade")
      .eq("tenant_id", profile.tenant_id)
      .in("pallet_id", palletIds);

    if (palletRes.error && !isViewMissing(palletRes.error)) {
      throw new Error(palletRes.error.message);
    }

    palletMeta = new Map(
      (palletRes.data ?? []).map((row) => [
        row.pallet_id,
        { code: row.code, productSku: row.product_sku ?? null, grade: row.grade ?? null },
      ]),
    );
  }

  const lines = pickRows.map((row) => {
    const meta = palletMeta.get(row.pallet_id);
    return {
      palletCode: meta?.code ?? row.pallet_id,
      productSku: meta?.productSku ?? null,
      grade: meta?.grade ?? null,
      quantity: numberOrZero(row.picked_units),
    };
  });

  const deliveryAddress = (shipmentRes.data?.delivery_address ?? null) as Record<string, unknown> | null;
  const addressLines = formatAddress(deliveryAddress);

  return (
    <html lang="en">
      <head>
        <title>{`Delivery Note • ${summaryRes.data.code}`}</title>
        <style>{printStyles}</style>
      </head>
      <body>
        <main className="dn-container">
          <header className="dn-header">
            <div>
              <h1>Delivery Note</h1>
              <p className="dn-meta">Shipment {summaryRes.data.code}</p>
              <p className="dn-meta">Status: {summaryRes.data.status}</p>
            </div>
            <div className="dn-print">
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") window.print();
                }}
              >
                Print
              </button>
            </div>
          </header>
          <section className="dn-section">
            <div className="dn-column">
              <h2>Customer</h2>
              <p>{summaryRes.data.customer_name ?? "—"}</p>
              <p>{summaryRes.data.customer_code ?? ""}</p>
            </div>
            <div className="dn-column">
              <h2>Delivery address</h2>
              {addressLines.length === 0 ? (
                <p>Not provided</p>
              ) : (
                addressLines.map((line) => <p key={line}>{line}</p>)
              )}
            </div>
            <div className="dn-column">
              <h2>Carrier</h2>
              <p>{summaryRes.data.carrier ?? "—"}</p>
              <p>Vehicle: {summaryRes.data.vehicle_reg ?? "—"}</p>
              <p>Trailer: {summaryRes.data.trailer_reg ?? "—"}</p>
              <p>Seal: {summaryRes.data.seal_no ?? "—"}</p>
            </div>
          </section>

          <section className="dn-section">
            <h2>Pick list</h2>
            {lines.length === 0 ? (
              <p>No units picked.</p>
            ) : (
              <table className="dn-table">
                <thead>
                  <tr>
                    <th>Pallet</th>
                    <th>SKU</th>
                    <th>Grade</th>
                    <th>Quantity (units)</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.palletCode}>
                      <td>{line.palletCode}</td>
                      <td>{line.productSku ?? "—"}</td>
                      <td>{line.grade ?? "—"}</td>
                      <td className="dn-number">{line.quantity.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="dn-section">
            <div className="dn-column">
              <h2>Totals</h2>
              <p>Total units: {lines.reduce((sum, line) => sum + line.quantity, 0).toFixed(0)}</p>
              <p>Net kg estimate: {formatNumber(summaryRes.data.net_kg_estimate)}</p>
            </div>
            <div className="dn-column">
              <h2>Signatures</h2>
              <div className="dn-signature">
                <span>Dispatch</span>
              </div>
              <div className="dn-signature">
                <span>Driver</span>
              </div>
            </div>
            <div className="dn-column">
              <h2>QR</h2>
              <div className="dn-qr">QR code placeholder</div>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}

function formatAddress(address: Record<string, unknown> | null) {
  if (!address) return [] as string[];
  return [address.line1, address.line2, address.city, address.state, address.postalCode, address.country]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function formatNumber(value: unknown) {
  if (value === null || value === undefined) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const printStyles = `
  :root {
    color-scheme: light;
    font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  body {
    margin: 0;
    background: #fff;
    color: #111827;
  }
  .dn-container {
    padding: 2rem 3rem;
    display: grid;
    gap: 2rem;
  }
  .dn-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }
  .dn-header h1 {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
  }
  .dn-meta {
    margin: 0;
    font-size: 0.9rem;
    color: #6b7280;
  }
  .dn-print button {
    border: 1px solid #d1d5db;
    background: #f9fafb;
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    cursor: pointer;
  }
  @media print {
    .dn-print { display: none; }
    body { padding: 0; }
    .dn-container { padding: 0; }
  }
  .dn-section {
    display: grid;
    gap: 1.5rem;
  }
  .dn-column {
    display: grid;
    gap: 0.3rem;
  }
  .dn-column h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .dn-column p {
    margin: 0;
    font-size: 0.95rem;
  }
  .dn-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
  }
  .dn-table th,
  .dn-table td {
    border: 1px solid #e5e7eb;
    padding: 0.5rem 0.75rem;
    text-align: left;
  }
  .dn-table thead {
    background: #f3f4f6;
  }
  .dn-number {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .dn-signature {
    margin-top: 0.75rem;
    border-bottom: 1px solid #d1d5db;
    padding-bottom: 1.5rem;
    width: 12rem;
    font-size: 0.85rem;
    color: #6b7280;
  }
  .dn-qr {
    width: 120px;
    height: 120px;
    border: 1px dashed #d1d5db;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    color: #9ca3af;
  }
`;
