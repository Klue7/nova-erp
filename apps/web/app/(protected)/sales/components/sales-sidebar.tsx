"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { toast } from "@/hooks/use-toast";
import {
  createCustomerAction,
  createOrderAction,
  createProductAction,
  setPriceAction,
} from "../actions";
import { OrdersTable, type SalesOrderRow } from "./orders-table";

export type CustomerRow = {
  id: string;
  code: string;
  name: string;
  creditLimit: number | null;
  status: string;
};

export type ProductRow = {
  id: string;
  sku: string;
  name: string | null;
  uom: string | null;
  status: string;
  price: { unitPrice: number; currency: string } | null;
};

type SalesSidebarProps = {
  orders: SalesOrderRow[];
  customers: CustomerRow[];
  products: ProductRow[];
};

export function SalesSidebar({ orders, customers, products }: SalesSidebarProps) {
  const router = useRouter();

  const handleResult = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    const result = await action();
    if (result.ok) {
      toast({ title: "Success", description: "Changes saved." });
      router.refresh();
      return true;
    }
    toast({
      title: "Action failed",
      description: result.error ?? "Unknown error",
      variant: "destructive",
    });
    return false;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Orders</CardTitle>
            <CardDescription>Manage pipeline of customer orders.</CardDescription>
          </div>
          <CreateOrderDialog customers={customers} onCompleted={handleResult} />
        </CardHeader>
        <CardContent className="px-0">
          <OrdersTable orders={orders} />
        </CardContent>
      </Card>

      <Tabs defaultValue="customers" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="products">Products & Pricing</TabsTrigger>
        </TabsList>
        <TabsContent value="customers" className="mt-4 space-y-4">
          <CreateCustomerDialog onCompleted={handleResult} />
          <div className="rounded-lg border border-border/60">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground">
              <span>Active Customers</span>
              <span>{customers.length}</span>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {customers.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  No customers yet. Capture your first account.
                </p>
              ) : (
                <ul className="divide-y divide-border/40 text-sm">
                  {customers.map((customer) => (
                    <li
                      key={customer.id}
                      className="flex items-center justify-between px-4 py-2"
                    >
                      <div>
                        <p className="font-medium text-foreground">{customer.name}</p>
                        <p className="text-xs text-muted-foreground">{customer.code}</p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {customer.creditLimit
                          ? customer.creditLimit.toLocaleString(undefined, {
                              style: "currency",
                              currency: "ZAR",
                              maximumFractionDigits: 0,
                            })
                          : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="products" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-3">
            <CreateProductDialog onCompleted={handleResult} />
            <SetPriceDialog products={products} onCompleted={handleResult} />
          </div>
          <div className="rounded-lg border border-border/60">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground">
              <span>Catalog</span>
              <span>{products.length}</span>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {products.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  Add products with SKUs to start quoting customers.
                </p>
              ) : (
                <ul className="divide-y divide-border/40 text-sm">
                  {products.map((product) => (
                    <li
                      key={product.id}
                      className="flex items-center justify-between px-4 py-2"
                    >
                      <div>
                        <p className="font-medium text-foreground">
                          {product.sku}
                          {product.name ? ` · ${product.name}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {product.uom ?? "units"}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {product.price
                          ? product.price.unitPrice.toLocaleString(undefined, {
                              style: "currency",
                              currency: product.price.currency ?? "ZAR",
                              maximumFractionDigits: 0,
                            })
                          : "Set price"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const createOrderSchema = z.object({
  code: z.string().min(1, "Order code is required"),
  customerId: z.string().uuid("Select a customer"),
});

function CreateOrderDialog({
  customers,
  onCompleted,
}: {
  customers: CustomerRow[];
  onCompleted: (
    handler: () => Promise<{ ok: boolean; error?: string }>,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof createOrderSchema>>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: {
      code: "",
      customerId: customers[0]?.id ?? "",
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onCompleted(() => createOrderAction(values));
      if (ok) {
        setOpen(false);
        form.reset({ code: "", customerId: customers[0]?.id ?? "" });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Create Order</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Sales Order</DialogTitle>
          <DialogDescription>Capture a draft order for a customer.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="order-code">Order code</Label>
            <Input id="order-code" placeholder="SO-2025-001" {...form.register("code")} />
            <FormError form={form} field="code" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="order-customer">Customer</Label>
            <select
              id="order-customer"
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
            <FormError form={form} field="customerId" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create order"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const createCustomerSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  creditLimit: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined || value === "") return null;
      const num = typeof value === "string" ? Number(value) : value;
      return Number.isFinite(num) ? num : Number.NaN;
    })
    .refine((value) => value === null || (Number.isFinite(value) && value >= 0), {
      message: "Credit limit must be zero or positive",
    })
    .optional(),
});

function CreateCustomerDialog({
  onCompleted,
}: {
  onCompleted: (
    handler: () => Promise<{ ok: boolean; error?: string }>,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof createCustomerSchema>>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: {
      code: "",
      name: "",
      creditLimit: undefined,
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onCompleted(() =>
        createCustomerAction({
          code: values.code,
          name: values.name,
          creditLimit: values.creditLimit ?? null,
        }),
      );
      if (ok) {
        setOpen(false);
        form.reset({ code: "", name: "", creditLimit: undefined });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Add Customer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Customer</DialogTitle>
          <DialogDescription>Capture a trading partner for sales orders.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer-code">Code</Label>
            <Input id="customer-code" placeholder="CUST-001" {...form.register("code")} />
            <FormError form={form} field="code" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-name">Name</Label>
            <Input id="customer-name" placeholder="Acme Builders" {...form.register("name")} />
            <FormError form={form} field="name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-credit">Credit limit</Label>
            <Input
              id="customer-credit"
              type="number"
              min={0}
              step={1000}
              placeholder="250000"
              {...form.register("creditLimit")}
            />
            <FormError form={form} field="creditLimit" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const createProductSchema = z.object({
  sku: z.string().min(1, "SKU is required"),
  name: z.string().trim().optional(),
  uom: z.string().trim().optional(),
});

function CreateProductDialog({
  onCompleted,
}: {
  onCompleted: (
    handler: () => Promise<{ ok: boolean; error?: string }>,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof createProductSchema>>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      sku: "",
      name: "",
      uom: "units",
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onCompleted(() =>
        createProductAction({
          sku: values.sku,
          name: values.name ?? undefined,
          uom: values.uom ?? undefined,
        }),
      );
      if (ok) {
        setOpen(false);
        form.reset({ sku: "", name: "", uom: "units" });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Add Product
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Product</DialogTitle>
          <DialogDescription>Register a SKU for quoting and fulfilment.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="product-sku">SKU</Label>
            <Input id="product-sku" placeholder="BRICK-A" {...form.register("sku")} />
            <FormError form={form} field="sku" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-name">Name</Label>
            <Input id="product-name" placeholder="Clay Brick A" {...form.register("name")} />
            <FormError form={form} field="name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-uom">Unit of measure</Label>
            <Input id="product-uom" placeholder="units" {...form.register("uom")} />
            <FormError form={form} field="uom" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const setPriceSchema = z.object({
  productId: z.string().uuid("Select a product"),
  unitPrice: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Unit price must be greater than zero",
    }),
  currency: z.string().trim().optional(),
});

function SetPriceDialog({
  products,
  onCompleted,
}: {
  products: ProductRow[];
  onCompleted: (
    handler: () => Promise<{ ok: boolean; error?: string }>,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof setPriceSchema>>({
    resolver: zodResolver(setPriceSchema),
    defaultValues: {
      productId: products[0]?.id ?? "",
      unitPrice: undefined,
      currency: "ZAR",
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onCompleted(() =>
        setPriceAction({
          productId: values.productId,
          unitPrice: values.unitPrice,
          currency: values.currency ?? "ZAR",
        }),
      );
      if (ok) {
        setOpen(false);
        form.reset({
          productId: products[0]?.id ?? "",
          unitPrice: undefined,
          currency: "ZAR",
        });
      }
    });
  });

  const options = useMemo(
    () =>
      products.map((product) => ({
        value: product.id,
        label: `${product.sku}${product.name ? ` · ${product.name}` : ""}`,
      })),
    [products],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Set Price
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set Price</DialogTitle>
          <DialogDescription>Publish a price effective immediately.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="price-product">Product</Label>
            <select
              id="price-product"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              {...form.register("productId")}
            >
              <option value="">Select product</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FormError form={form} field="productId" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="price-amount">Unit price</Label>
              <Input
                id="price-amount"
                type="number"
                min={0}
                step={1}
                placeholder="450"
                {...form.register("unitPrice")}
              />
              <FormError form={form} field="unitPrice" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price-currency">Currency</Label>
              <Input
                id="price-currency"
                placeholder="ZAR"
                maxLength={3}
                {...form.register("currency")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Publish price"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FormError({
  form,
  field,
}: {
  form: UseFormReturn<any>;
  field: string;
}) {
  const message = form.formState.errors[field]?.message;
  if (!message) return null;
  return <p className="text-xs text-destructive">{String(message)}</p>;
}
