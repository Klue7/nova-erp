import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type SalesKpi = {
  openOrders: number;
  unitsOrderedToday: number;
  unitsReserved: number;
  unitsShippedToday: number;
};

const KPI_LABELS: Array<{ key: keyof SalesKpi; label: string; suffix?: string }> = [
  { key: "openOrders", label: "Open orders" },
  { key: "unitsOrderedToday", label: "Units ordered today", suffix: "u" },
  { key: "unitsReserved", label: "Units reserved", suffix: "u" },
  { key: "unitsShippedToday", label: "Units shipped today", suffix: "u" },
];

export function SalesKpiCards({ data }: { data: SalesKpi }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {KPI_LABELS.map((item) => {
        const value = Number(data[item.key] ?? 0);
        return (
          <Card key={item.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {item.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-foreground">
                {value.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                  minimumFractionDigits: value < 10 ? 1 : 0,
                })}
                {item.suffix ? (
                  <span className="ml-1 text-sm text-muted-foreground">{item.suffix}</span>
                ) : null}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
