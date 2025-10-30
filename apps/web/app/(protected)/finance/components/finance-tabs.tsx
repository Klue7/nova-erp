"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  addInvoiceLineAction,
  applyPaymentAction,
  createInvoiceAction,
  invoiceFromShipmentAction,
  issueInvoiceAction,
  receivePaymentAction,
  removeInvoiceLineAction,
  reversePaymentAction,
  unapplyPaymentAction,
  voidInvoiceAction,
} from "../actions";

type InvoiceSummary = {
  id: string;
  code: string;
  status: string;
  customerId: string;
  customerName: string;
  issueDate: string | null;
  dueDate: string | null;
  grandTotal: number;
  balanceDue: number;
  amountApplied: number;
  currency: string;
};

type InvoiceLine = {
  invoiceId: string;
  productId: string | null;
  sku: string | null;
  quantityUnits: number;
  netAmount: number;
  taxAmount: number;
};

type InvoiceTotals = {
  invoiceId: string;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  applied: number;
  balance: number;
};

type PaymentSummary = {
  id: string;
  code: string;
  customerId: string;
  customerName: string;
  amount: number;
  currency: string;
  method: string | null;
  reference: string | null;
  receivedAt: string;
  status: string;
  appliedAmount: number;
};

type PaymentApplication = {
  id: string;
  paymentId: string;
  invoiceId: string;
  invoiceCode: string | null;
  amountApplied: number;
};

type CustomerOption = {
  id: string;
  code: string;
  name: string;
};

type ProductOption = {
  id: string;
  sku: string;
  name: string | null;
};

type ShipmentOption = {
  id: string;
  code: string;
  status: string | null;
};

type BucketTotal = {
  bucket: string;
  total: number;
};

type AgingRow = {
  invoiceId: string;
  invoiceCode: string | null;
  customerId: string;
  customerName: string | null;
  dueDate: string | null;
  daysPastDue: number;
  bucket: string;
  balanceDue: number;
};

type CustomerExposure = {
  customerId: string;
  customerName: string | null;
  openBalance: number;
};

type FinanceTabsProps = {
  invoices: InvoiceSummary[];
  invoiceLines: InvoiceLine[];
  invoiceTotals: InvoiceTotals[];
  customers: CustomerOption[];
  products: ProductOption[];
  shipments: ShipmentOption[];
  payments: PaymentSummary[];
  paymentApplications: PaymentApplication[];
  agingBuckets: BucketTotal[];
  agingRows: AgingRow[];
  customerExposure: CustomerExposure[];
};

const formError = (form: UseFormReturn<any>, field: string) => {
  const message = form.formState.errors[field]?.message;
  if (!message) return null;
  return <p className="text-xs text-destructive">{String(message)}</p>;
};

const bucketsOrder = ["0-30", "31-60", "61-90", ">90"];

export function FinanceTabs(props: FinanceTabsProps) {
  const searchParams = useSearchParams();
  const currentTab = searchParams?.get("tab") ?? "invoices";

  return (
    <Tabs value={currentTab} className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="invoices">Invoices</TabsTrigger>
        <TabsTrigger value="payments">Payments</TabsTrigger>
        <TabsTrigger value="aging">AR Aging</TabsTrigger>
      </TabsList>
      <TabsContent value="invoices">
        <InvoicesTab {...props} />
      </TabsContent>
      <TabsContent value="payments">
        <PaymentsTab {...props} />
      </TabsContent>
      <TabsContent value="aging">
        <AgingTab
          agingBuckets={props.agingBuckets}
          agingRows={props.agingRows}
          customerExposure={props.customerExposure}
        />
      </TabsContent>
    </Tabs>
  );
}

function InvoicesTab({
  invoices,
  invoiceLines,
  invoiceTotals,
  customers,
  products,
  shipments,
}: FinanceTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const selectedId = searchParams?.get("invoice") ?? undefined;
  const defaultId = selectedId ?? invoices[0]?.id ?? undefined;

  const selectedInvoice =
    invoices.find((invoice) => invoice.id === defaultId) ?? invoices[0] ?? null;

  const lines = useMemo(
    () => invoiceLines.filter((line) => line.invoiceId === selectedInvoice?.id),
    [invoiceLines, selectedInvoice?.id],
  );
  const totals =
    invoiceTotals.find((row) => row.invoiceId === selectedInvoice?.id) ??
    (selectedInvoice
      ? {
          invoiceId: selectedInvoice.id,
          subtotal: selectedInvoice.grandTotal,
          taxTotal: 0,
          grandTotal: selectedInvoice.grandTotal,
          applied: selectedInvoice.amountApplied,
          balance: selectedInvoice.balanceDue,
        }
      : undefined);

  const setInvoice = (id: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", "invoices");
    params.set("invoice", id);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>Draft and issued invoices with balances due.</CardDescription>
          </div>
          <CreateInvoiceDialog customers={customers} />
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No invoices yet. Create one to start billing.
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((invoice) => (
                  <TableRow
                    key={invoice.id}
                    onClick={() => setInvoice(invoice.id)}
                    className={`cursor-pointer ${invoice.id === selectedInvoice?.id ? "bg-primary/5" : "hover:bg-muted/60"}`}
                  >
                    <TableCell className="font-medium">{invoice.code}</TableCell>
                    <TableCell className="capitalize text-sm text-muted-foreground">
                      {invoice.status}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {invoice.customerName}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {invoice.grandTotal.toLocaleString(undefined, {
                        style: "currency",
                        currency: invoice.currency,
                        maximumFractionDigits: 0,
                      })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {invoice.balanceDue.toLocaleString(undefined, {
                        style: "currency",
                        currency: invoice.currency,
                        maximumFractionDigits: 0,
                      })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        {selectedInvoice ? (
          <>
            <CardHeader className="space-y-2">
              <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>{selectedInvoice.code}</CardTitle>
                  <CardDescription>
                    {selectedInvoice.customerName} · Status: {selectedInvoice.status}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <AddInvoiceLineDialog
                    invoice={selectedInvoice}
                    products={products}
                  />
                  <RemoveInvoiceLineDialog
                    invoice={selectedInvoice}
                    lines={lines}
                  />
                  <IssueInvoiceDialog invoice={selectedInvoice} />
                  <VoidInvoiceDialog invoice={selectedInvoice} />
                  <InvoiceFromShipmentDialog
                    invoice={selectedInvoice}
                    shipments={shipments}
                    customers={customers}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric
                  label="Subtotal"
                  value={totals?.subtotal ?? 0}
                  currency={selectedInvoice.currency}
                />
                <Metric
                  label="Tax"
                  value={totals?.taxTotal ?? 0}
                  currency={selectedInvoice.currency}
                />
                <Metric
                  label="Grand total"
                  value={totals?.grandTotal ?? selectedInvoice.grandTotal}
                  currency={selectedInvoice.currency}
                />
                <Metric
                  label="Balance due"
                  value={totals?.balance ?? selectedInvoice.balanceDue}
                  currency={selectedInvoice.currency}
                  highlight
                />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-4 text-center text-sm text-muted-foreground">
                        No lines captured yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    lines.map((line, index) => (
                      <TableRow key={`${line.invoiceId}-${line.sku ?? index}`}>
                        <TableCell>{line.sku ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {line.quantityUnits.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {line.netAmount.toLocaleString(undefined, {
                            style: "currency",
                            currency: selectedInvoice.currency,
                            maximumFractionDigits: 0,
                          })}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {line.taxAmount.toLocaleString(undefined, {
                            style: "currency",
                            currency: selectedInvoice.currency,
                            maximumFractionDigits: 0,
                          })}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </>
        ) : (
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Select an invoice to view details and actions.
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function PaymentsTab({
  payments,
  paymentApplications,
  invoices,
  customers,
}: FinanceTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const selectedId = searchParams?.get("payment") ?? undefined;
  const defaultId = selectedId ?? payments[0]?.id ?? undefined;

  const selectedPayment =
    payments.find((payment) => payment.id === defaultId) ?? payments[0] ?? null;

  const applications = paymentApplications.filter(
    (application) => application.paymentId === selectedPayment?.id,
  );

  const setPayment = (id: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", "payments");
    params.set("payment", id);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const openInvoices = useMemo(
    () =>
      invoices
        .filter((invoice) => invoice.balanceDue > 0)
        .map((invoice) => ({
          id: invoice.id,
          code: invoice.code,
          balance: invoice.balanceDue,
          customerName: invoice.customerName,
          currency: invoice.currency,
        })),
    [invoices],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Payments</CardTitle>
            <CardDescription>Cash receipts and their application status.</CardDescription>
          </div>
          <ReceivePaymentDialog customers={customers} />
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    No payments recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                payments.map((payment) => (
                  <TableRow
                    key={payment.id}
                    onClick={() => setPayment(payment.id)}
                    className={`cursor-pointer ${payment.id === selectedPayment?.id ? "bg-primary/5" : "hover:bg-muted/60"}`}
                  >
                    <TableCell className="font-medium">{payment.code}</TableCell>
                    <TableCell className="capitalize text-sm text-muted-foreground">
                      {payment.status}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {payment.customerName}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {payment.amount.toLocaleString(undefined, {
                        style: "currency",
                        currency: payment.currency,
                        maximumFractionDigits: 0,
                      })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        {selectedPayment ? (
          <>
            <CardHeader className="space-y-2">
              <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>{selectedPayment.code}</CardTitle>
                  <CardDescription>
                    {selectedPayment.customerName} · Received{" "}
                    {new Date(selectedPayment.receivedAt).toLocaleDateString()}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ApplyPaymentDialog
                    payment={selectedPayment}
                    openInvoices={openInvoices}
                  />
                  <UnapplyPaymentDialog applications={applications} />
                  <ReversePaymentDialog payment={selectedPayment} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric
                  label="Amount received"
                  value={selectedPayment.amount}
                  currency={selectedPayment.currency}
                />
                <Metric
                  label="Applied"
                  value={selectedPayment.appliedAmount}
                  currency={selectedPayment.currency}
                />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead className="text-right">Amount applied</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {applications.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="py-4 text-center text-sm text-muted-foreground">
                        Payment has not been applied yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    applications.map((application) => (
                      <TableRow key={application.id}>
                        <TableCell>{application.invoiceCode ?? application.invoiceId}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {application.amountApplied.toLocaleString(undefined, {
                            style: "currency",
                            currency: selectedPayment.currency,
                            maximumFractionDigits: 0,
                          })}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </>
        ) : (
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Select a payment to view applications.
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function AgingTab({
  agingBuckets,
  agingRows,
  customerExposure,
}: {
  agingBuckets: BucketTotal[];
  agingRows: AgingRow[];
  customerExposure: CustomerExposure[];
}) {
  const bucketMap = new Map(agingBuckets.map((item) => [item.bucket, item.total]));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>AR Buckets</CardTitle>
          <CardDescription>Aging totals grouped by overdue buckets.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bucket</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bucketsOrder.map((bucket) => (
                <TableRow key={bucket}>
                  <TableCell>{bucket}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {Number(bucketMap.get(bucket) ?? 0).toLocaleString(undefined, {
                      style: "currency",
                      currency: "ZAR",
                      maximumFractionDigits: 0,
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customer Exposure</CardTitle>
          <CardDescription>Open balances grouped by customer.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Open balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customerExposure.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-4 text-center text-sm text-muted-foreground">
                    No open invoices.
                  </TableCell>
                </TableRow>
              ) : (
                customerExposure.map((row) => (
                  <TableRow key={row.customerId}>
                    <TableCell>{row.customerName ?? row.customerId}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {Number(row.openBalance ?? 0).toLocaleString(undefined, {
                        style: "currency",
                        currency: "ZAR",
                        maximumFractionDigits: 0,
                      })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Overdue invoices</CardTitle>
          <CardDescription>Invoices past due date ordered by severity.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead className="text-right">Days overdue</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agingRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-4 text-center text-sm text-muted-foreground">
                    No overdue invoices 🎉
                  </TableCell>
                </TableRow>
              ) : (
                agingRows
                  .slice()
                  .sort((a, b) => b.daysPastDue - a.daysPastDue)
                  .map((row) => (
                    <TableRow key={row.invoiceId}>
                      <TableCell>{row.invoiceCode ?? row.invoiceId}</TableCell>
                      <TableCell>{row.customerName ?? row.customerId}</TableCell>
                      <TableCell>{row.dueDate ? new Date(row.dueDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-right">{row.daysPastDue}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {Number(row.balanceDue ?? 0).toLocaleString(undefined, {
                          style: "currency",
                          currency: "ZAR",
                          maximumFractionDigits: 0,
                        })}
                      </TableCell>
                    </TableRow>
                  ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  currency,
  highlight,
}: {
  label: string;
  value: number;
  currency: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-border/60 p-3 ${
        highlight ? "bg-destructive/10" : "bg-muted/40"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">
        {value.toLocaleString(undefined, {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        })}
      </p>
    </div>
  );
}

function CreateInvoiceDialog({ customers }: { customers: CustomerOption[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof createInvoiceSchema>>({
    resolver: zodResolver(createInvoiceSchema),
    defaultValues: {
      code: "",
      customerId: customers[0]?.id ?? "",
      currency: "ZAR",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createInvoiceAction(values);
      if (result.ok) {
        toast({ title: "Invoice created", description: values.code });
        setOpen(false);
        form.reset({
          code: "",
          customerId: customers[0]?.id ?? "",
          currency: "ZAR",
        });
      } else {
        toast({
          title: "Unable to create invoice",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New Invoice</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create invoice</DialogTitle>
          <DialogDescription>Generate a draft invoice for a customer.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invoice-code">Invoice code</Label>
            <Input id="invoice-code" {...form.register("code")} placeholder="INV-2025-001" />
            {formError(form, "code")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-customer">Customer</Label>
            <select
              id="invoice-customer"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              {...form.register("customerId")}
            >
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} ({customer.code})
                </option>
              ))}
            </select>
            {formError(form, "customerId")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-currency">Currency</Label>
            <Input id="invoice-currency" {...form.register("currency")} />
            {formError(form, "currency")}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const createInvoiceSchema = z.object({
  code: z.string().min(1),
  customerId: z.string().uuid(),
  currency: z.string().min(1),
});

function AddInvoiceLineDialog({
  invoice,
  products,
}: {
  invoice: InvoiceSummary;
  products: ProductOption[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof addInvoiceLineSchema>>({
    resolver: zodResolver(addInvoiceLineSchema),
    defaultValues: {
      invoiceId: invoice.id,
      productId: products[0]?.id ?? "",
      sku: products[0]?.sku ?? "",
      quantityUnits: 1,
      unitPrice: 0,
      taxRate: 0,
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await addInvoiceLineAction(values);
      if (result.ok) {
        toast({ title: "Line added", description: `${values.quantityUnits} units added` });
        setOpen(false);
      } else {
        toast({
          title: "Unable to add line",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Add line
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add invoice line</DialogTitle>
          <DialogDescription>Append a product line to the draft invoice.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" value={invoice.id} {...form.register("invoiceId")} />
          <div className="space-y-2">
            <Label htmlFor="line-product">Product</Label>
            <select
              id="line-product"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              {...form.register("productId")}
            >
              <option value="">Select product</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.sku}
                  {product.name ? ` · ${product.name}` : ""}
                </option>
              ))}
            </select>
            {formError(form, "productId")}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="line-quantity">Quantity</Label>
              <Input id="line-quantity" type="number" step={1} {...form.register("quantityUnits")} />
              {formError(form, "quantityUnits")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="line-price">Unit price</Label>
              <Input id="line-price" type="number" step="0.01" {...form.register("unitPrice")} />
              {formError(form, "unitPrice")}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="line-tax">Tax rate</Label>
            <Input id="line-tax" type="number" step="0.01" {...form.register("taxRate")} />
            {formError(form, "taxRate")}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding..." : "Add line"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const addInvoiceLineSchema = z.object({
  invoiceId: z.string().uuid(),
  productId: z.string().uuid(),
  sku: z.string().min(1),
  quantityUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Quantity must be greater than zero",
    }),
  unitPrice: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value >= 0, {
      message: "Unit price cannot be negative",
    }),
  taxRate: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value >= 0, {
      message: "Tax rate cannot be negative",
    }),
});

function RemoveInvoiceLineDialog({
  invoice,
  lines,
}: {
  invoice: InvoiceSummary;
  lines: InvoiceLine[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const options = useMemo(
    () =>
      lines.map((line, index) => ({
        value: `${line.productId ?? index}:${line.sku ?? index}`,
        productId: line.productId,
        sku: line.sku ?? "",
        quantity: line.quantityUnits,
      })),
    [lines],
  );

  const form = useForm<z.infer<typeof removeInvoiceLineSchema>>({
    resolver: zodResolver(removeInvoiceLineSchema),
    defaultValues: {
      invoiceId: invoice.id,
      productId: options[0]?.productId ?? "",
      sku: options[0]?.sku ?? "",
      quantityUnits: options[0]?.quantity ?? 1,
      unitPrice: 0,
      taxRate: 0,
    },
  });

  const updateLine = (value: string) => {
    const option = options.find((item) => `${item.productId}:${item.sku}` === value);
    if (option) {
      form.setValue("productId", option.productId ?? "");
      form.setValue("sku", option.sku);
      form.setValue("quantityUnits", option.quantity);
    }
  };

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await removeInvoiceLineAction(values);
      if (result.ok) {
        toast({ title: "Line removed" });
        setOpen(false);
      } else {
        toast({
          title: "Unable to remove line",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={lines.length === 0}>
          Remove line
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Remove invoice line</DialogTitle>
          <DialogDescription>Subtract quantity from an existing line item.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" value={invoice.id} {...form.register("invoiceId")} />
          <div className="space-y-2">
            <Label htmlFor="remove-line">Line</Label>
            <select
              id="remove-line"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              onChange={(event) => {
                updateLine(event.target.value);
                form.register("productId").onChange(event);
              }}
            >
              <option value="">Select line</option>
              {options.map((option) => (
                <option
                  key={option.value}
                  value={`${option.productId}:${option.sku}`}
                >
                  {option.sku} ({option.quantity.toFixed(1)} units)
                </option>
              ))}
            </select>
            {formError(form, "productId")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="remove-quantity">Quantity</Label>
            <Input
              id="remove-quantity"
              type="number"
              step={1}
              {...form.register("quantityUnits")}
            />
            {formError(form, "quantityUnits")}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const removeInvoiceLineSchema = z.object({
  invoiceId: z.string().uuid(),
  productId: z.string().uuid(),
  sku: z.string().min(1),
  quantityUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Quantity must be greater than zero",
    }),
  unitPrice: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value >= 0, {
      message: "Unit price cannot be negative",
    }),
  taxRate: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value >= 0, {
      message: "Tax rate cannot be negative",
    }),
});

function IssueInvoiceDialog({ invoice }: { invoice: InvoiceSummary }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof issueInvoiceSchema>>({
    resolver: zodResolver(issueInvoiceSchema),
    defaultValues: {
      invoiceId: invoice.id,
      termsDays: 30,
      issueDate: new Date().toISOString().slice(0, 10),
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await issueInvoiceAction(values);
      if (result.ok) {
        toast({ title: "Invoice issued", description: invoice.code });
        setOpen(false);
      } else {
        toast({
          title: "Unable to issue invoice",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={invoice.status !== "draft"}>
          Issue
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue invoice</DialogTitle>
          <DialogDescription>
            Sets the invoice to <strong>issued</strong> and populates due date.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" value={invoice.id} {...form.register("invoiceId")} />
          <div className="space-y-2">
            <Label htmlFor="issue-date">Issue date</Label>
            <Input id="issue-date" type="date" {...form.register("issueDate")} />
            {formError(form, "issueDate")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="issue-terms">Payment terms (days)</Label>
            <Input id="issue-terms" type="number" {...form.register("termsDays")} />
            {formError(form, "termsDays")}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Issuing..." : "Issue invoice"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const issueInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  termsDays: z.union([z.number(), z.string()]).transform((value) => Number(value)),
  issueDate: z.string().min(1),
});

function VoidInvoiceDialog({ invoice }: { invoice: InvoiceSummary }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof voidInvoiceSchema>>({
    resolver: zodResolver(voidInvoiceSchema),
    defaultValues: {
      invoiceId: invoice.id,
      reason: "",
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await voidInvoiceAction(values);
      if (result.ok) {
        toast({ title: "Invoice voided", description: invoice.code });
        setOpen(false);
      } else {
        toast({
          title: "Unable to void invoice",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive" disabled={invoice.status === "void"}>
          Void
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void invoice</DialogTitle>
          <DialogDescription>
            Moves the invoice to <strong>void</strong>. All balances will be zeroed.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" value={invoice.id} {...form.register("invoiceId")} />
          <div className="space-y-2">
            <Label htmlFor="void-reason">Reason (optional)</Label>
            <Textarea id="void-reason" rows={3} {...form.register("reason")} />
            {formError(form, "reason")}
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? "Voiding..." : "Void invoice"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const voidInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().trim().optional(),
});

function InvoiceFromShipmentDialog({
  invoice,
  shipments,
  customers,
}: {
  invoice: InvoiceSummary;
  shipments: ShipmentOption[];
  customers: CustomerOption[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof invoiceFromShipmentSchema>>({
    resolver: zodResolver(invoiceFromShipmentSchema),
    defaultValues: {
      shipmentId: shipments[0]?.id ?? "",
      invoiceCode: `${invoice.code}-SHIP`,
      customerId: invoice.customerId,
      currency: invoice.currency,
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await invoiceFromShipmentAction(values);
      if (result.ok) {
        const totals = result.data && "totals" in result.data ? result.data.totals : null;
        toast({
          title: "Invoice seeded from shipment",
          description: totals
            ? `Total: ${totals.grandTotal.toLocaleString(undefined, {
                style: "currency",
                currency: values.currency ?? "ZAR",
                maximumFractionDigits: 0,
              })}`
            : "Invoice created without totals. Review the invoice for details.",
        });
        setOpen(false);
      } else {
        toast({
          title: "Unable to seed invoice",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          From shipment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create from shipment</DialogTitle>
          <DialogDescription>
            Generates invoice lines using picked units from a shipment.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ship-shipment">Shipment</Label>
            <select
              id="ship-shipment"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              {...form.register("shipmentId")}
            >
              <option value="">Select shipment</option>
              {shipments.map((shipment) => (
                <option key={shipment.id} value={shipment.id}>
                  {shipment.code} ({shipment.status ?? "status unknown"})
                </option>
              ))}
            </select>
            {formError(form, "shipmentId")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ship-invoice-code">New invoice code</Label>
            <Input id="ship-invoice-code" {...form.register("invoiceCode")} />
            {formError(form, "invoiceCode")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ship-customer">Customer</Label>
            <select
              id="ship-customer"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              {...form.register("customerId")}
            >
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
            {formError(form, "customerId")}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Generating..." : "Generate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const invoiceFromShipmentSchema = z.object({
  shipmentId: z.string().uuid(),
  invoiceCode: z.string().min(1),
  customerId: z.string().uuid(),
  currency: z.string().min(1),
});

function ReceivePaymentDialog({ customers }: { customers: CustomerOption[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof receivePaymentSchema>>({
    resolver: zodResolver(receivePaymentSchema),
    defaultValues: {
      code: "",
      customerId: customers[0]?.id ?? "",
      amount: 0,
      currency: "ZAR",
      method: "",
      reference: "",
      receivedAt: new Date().toISOString().slice(0, 10),
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await receivePaymentAction(values);
      if (result.ok) {
        toast({ title: "Payment recorded", description: values.code });
        setOpen(false);
      } else {
        toast({
          title: "Unable to receive payment",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Receive</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Receive payment</DialogTitle>
          <DialogDescription>Log cash received from a customer.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="receive-code">Payment reference</Label>
            <Input id="receive-code" {...form.register("code")} placeholder="PAY-2025-001" />
            {formError(form, "code")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="receive-customer">Customer</Label>
            <select
              id="receive-customer"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              {...form.register("customerId")}
            >
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
            {formError(form, "customerId")}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="receive-amount">Amount</Label>
              <Input id="receive-amount" type="number" step="0.01" {...form.register("amount")} />
              {formError(form, "amount")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="receive-currency">Currency</Label>
              <Input id="receive-currency" {...form.register("currency")} />
              {formError(form, "currency")}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="receive-method">Method</Label>
              <Input id="receive-method" {...form.register("method")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="receive-reference">Reference</Label>
              <Input id="receive-reference" {...form.register("reference")} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="receive-date">Received at</Label>
            <Input id="receive-date" type="date" {...form.register("receivedAt")} />
            {formError(form, "receivedAt")}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Recording..." : "Record payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const receivePaymentSchema = z.object({
  code: z.string().min(1),
  customerId: z.string().uuid(),
  amount: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Amount must be greater than zero",
    }),
  currency: z.string().min(1),
  method: z.string().trim().optional(),
  reference: z.string().trim().optional(),
  receivedAt: z.string().min(1),
});

function ApplyPaymentDialog({
  payment,
  openInvoices,
}: {
  payment: PaymentSummary;
  openInvoices: Array<{ id: string; code: string; balance: number; customerName: string; currency: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const defaultInvoice = openInvoices[0];
  const form = useForm<z.infer<typeof applyPaymentSchema>>({
    resolver: zodResolver(applyPaymentSchema),
    defaultValues: {
      paymentId: payment.id,
      invoiceId: defaultInvoice?.id ?? "",
      amount: defaultInvoice?.balance ?? payment.amount - payment.appliedAmount,
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await applyPaymentAction(values);
      if (result.ok) {
        toast({ title: "Payment applied" });
        setOpen(false);
      } else {
        toast({
          title: "Unable to apply payment",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={openInvoices.length === 0}>
          Apply
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Apply payment</DialogTitle>
          <DialogDescription>Allocate funds to an invoice balance.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" value={payment.id} {...form.register("paymentId")} />
          <div className="space-y-2">
            <Label htmlFor="apply-invoice">Invoice</Label>
            <select
              id="apply-invoice"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              {...form.register("invoiceId")}
            >
              <option value="">Select invoice</option>
              {openInvoices.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.code} · {invoice.balance.toFixed(0)} outstanding
                </option>
              ))}
            </select>
            {formError(form, "invoiceId")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="apply-amount">Amount</Label>
            <Input id="apply-amount" type="number" step="0.01" {...form.register("amount")} />
            {formError(form, "amount")}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Applying..." : "Apply"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const applyPaymentSchema = z.object({
  paymentId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amount: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Amount must be greater than zero",
    }),
});

function UnapplyPaymentDialog({
  applications,
}: {
  applications: PaymentApplication[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof unapplySchema>>({
    resolver: zodResolver(unapplySchema),
    defaultValues: {
      applicationId: applications[0]?.id ?? "",
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await unapplyPaymentAction(values);
      if (result.ok) {
        toast({ title: "Application removed" });
        setOpen(false);
      } else {
        toast({
          title: "Unable to unapply payment",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={applications.length === 0}>
          Unapply
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Unapply payment</DialogTitle>
          <DialogDescription>Removes allocation from an invoice.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="unapply-app">Application</Label>
            <select
              id="unapply-app"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              {...form.register("applicationId")}
            >
              <option value="">Select application</option>
              {applications.map((application) => (
                <option key={application.id} value={application.id}>
                  {application.invoiceCode ?? application.invoiceId} ·{" "}
                  {application.amountApplied.toFixed(0)}
                </option>
              ))}
            </select>
            {formError(form, "applicationId")}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Removing..." : "Unapply"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const unapplySchema = z.object({
  applicationId: z.string().uuid(),
});

function ReversePaymentDialog({ payment }: { payment: PaymentSummary }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof reverseSchema>>({
    resolver: zodResolver(reverseSchema),
    defaultValues: {
      paymentId: payment.id,
      reason: "",
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await reversePaymentAction(values);
      if (result.ok) {
        toast({ title: "Payment reversed", description: payment.code });
        setOpen(false);
      } else {
        toast({
          title: "Unable to reverse payment",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive">
          Reverse
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reverse payment</DialogTitle>
          <DialogDescription>
            Marks the payment as <strong>reversed</strong>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" value={payment.id} {...form.register("paymentId")} />
          <div className="space-y-2">
            <Label htmlFor="reverse-reason">Reason</Label>
            <Textarea id="reverse-reason" rows={3} {...form.register("reason")} />
            {formError(form, "reason")}
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? "Reversing..." : "Reverse"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const reverseSchema = z.object({
  paymentId: z.string().uuid(),
  reason: z.string().trim().optional(),
});
