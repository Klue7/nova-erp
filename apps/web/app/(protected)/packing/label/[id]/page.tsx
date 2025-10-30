import { notFound, redirect } from "next/navigation";

import { guardRoute } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const ALLOWED_ROLES = ["packing_operator", "admin"] as const;

function PrintButton() {
  "use client";
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") {
          window.print();
        }
      }}
      className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      Print
    </button>
  );
}

export default async function PackingLabelPage({
  params,
}: {
  params: { id: string };
}) {
  const { profile } = await guardRoute();

  if (!profile) {
    redirect("/login");
  }

  if (!ALLOWED_ROLES.includes(profile.role as typeof ALLOWED_ROLES[number])) {
    redirect("/dashboard?toast=access-denied");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("pallets")
    .select("id, code, product_sku, grade, status, created_at")
    .eq("tenant_id", profile.tenant_id)
    .eq("id", params.id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    notFound();
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 bg-white p-8 text-gray-900">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pallet label</h1>
          <p className="text-sm text-muted-foreground">
            Print and attach to the pallet for downstream tracking.
          </p>
        </div>
        <PrintButton />
      </div>
      <div className="grid gap-4 rounded-lg border border-dashed border-gray-300 bg-white p-6">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">{data.code}</h2>
          <p className="text-sm uppercase tracking-wide text-gray-500">
            SKU: {data.product_sku ?? "—"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Grade</p>
            <p className="font-medium text-gray-900">{data.grade ?? "—"}</p>
          </div>
          <div>
            <p className="text-gray-500">Status</p>
            <p className="font-medium text-gray-900">{data.status}</p>
          </div>
          <div>
            <p className="text-gray-500">Created</p>
            <p className="font-medium text-gray-900">
              {data.created_at ? new Date(data.created_at).toLocaleString() : "—"}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Pallet ID</p>
            <p className="font-mono text-sm text-gray-900">{data.id}</p>
          </div>
        </div>
        <div className="flex min-h-[160px] items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50">
          <span className="text-xs uppercase tracking-widest text-gray-400">
            QR code placeholder
          </span>
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Nova Bricks ERP • Packing label • {new Date().toLocaleDateString()}
      </p>
    </div>
  );
}
