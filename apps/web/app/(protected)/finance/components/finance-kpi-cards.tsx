import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type FinanceKpi = {
  invoicesIssuedToday: number;
  valueIssuedToday: number;
  paymentsReceivedToday: number;
  openArTotal: number;
};

const KPI_CONFIG: Array<{
  key: keyof FinanceKpi;
  label: string;
  format: "count" | "currency";
}> = [
  { key: "invoicesIssuedToday", label: "Invoices issued today", format: "count" },
  { key: "valueIssuedToday", label: "Value issued today", format: "currency" },
  { key: "paymentsReceivedToday", label: "Payments received today", format: "currency" },
  { key: "openArTotal", label: "Open AR total", format: "currency" },
];

export function FinanceKpiCards({ data }: { data: FinanceKpi }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {KPI_CONFIG.map((item) => {
        const value = Number(data[item.key] ?? 0);
        const display =
          item.format === "currency"
            ? value.toLocaleString(undefined, {
                style: "currency",
                currency: "ZAR",
                maximumFractionDigits: value >= 1000 ? 0 : 2,
              })
            : value.toLocaleString();

        return (
          <Card key={item.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {item.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-foreground">{display}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
