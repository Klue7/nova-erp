import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { z } from "zod";

dotenv.config();

const ARG_SCHEMA = z
  .object({
    file: z.string().min(1, "--file <path> is required"),
    tenant: z.string().min(1, "--tenant <code> is required"),
    currency: z.string().min(1).default("ZAR"),
    "price-field": z.enum(["delivered", "collected"]).default("delivered"),
  })
  .transform((value) => ({
    file: value.file,
    tenant: value.tenant,
    currency: value.currency.toUpperCase(),
    priceField: value["price-field"],
  }));

type CliOptions = z.infer<typeof ARG_SCHEMA>;

const PRICE_COLUMN_MAP = {
  delivered: "delivered rrp ex vat",
  collected: "collected rrp ex vat",
} as const;

type ParsedRow = {
  name: string;
  uom: string;
  sku: string;
  price: number;
};

type ProductRecord = ParsedRow & { productType: string };

function parseArgv(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith("--")) continue;
    const [rawKey, inlineValue] = current.slice(2).split("=");
    const key = rawKey.trim();
    if (!key) continue;
    if (inlineValue !== undefined) {
      result[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      i += 1;
    } else {
      result[key] = "true";
    }
  }
  return result;
}

function loadRows(filePath: string): Record<string, unknown>[] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv" || ext === ".tsv") {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = Papa.parse<Record<string, unknown>>(content, {
      header: true,
      skipEmptyLines: true,
    });
    if (parsed.errors.length > 0) {
      const messages = parsed.errors.map((err) => err.message).join(", ");
      throw new Error(`Failed to parse CSV: ${messages}`);
    }
    return parsed.data;
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const workbook = XLSX.readFile(filePath);
    const [firstSheetName] = workbook.SheetNames;
    if (!firstSheetName) {
      throw new Error("Workbook is empty");
    }
    const sheet = workbook.Sheets[firstSheetName];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
    });
  }

  throw new Error(`Unsupported file extension: ${ext}`);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const sanitized = value.replace(/[^0-9.+-]/g, "");
    if (sanitized.length === 0) return null;
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function slugify(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!key) continue;
    normalized[key.trim().toLowerCase()] = value;
  }
  return normalized;
}

function extractProducts(rows: Record<string, unknown>[], options: CliOptions) {
  const priceColumn = PRICE_COLUMN_MAP[options.priceField];
  const fallbackColumn =
    options.priceField === "delivered"
      ? PRICE_COLUMN_MAP.collected
      : PRICE_COLUMN_MAP.delivered;

  const products = new Map<string, ProductRecord>();
  const skipped: string[] = [];

  rows.forEach((rawRow, index) => {
    const row = normalizeRow(rawRow);
    const primaryName = String(row["product type"] ?? row["product"] ?? "").trim();
    const typeSuffix = String(row["type"] ?? "").trim();
    const productLabel = [primaryName, typeSuffix].filter(Boolean).join(" ").trim();

    if (!productLabel) {
      skipped.push(`Row ${index + 1}: missing Product / Product Type`);
      return;
    }

    const uomRaw = row["uom"] ?? row["unit"] ?? "";
    const uom = String(uomRaw).trim();
    if (!uom) {
      skipped.push(`Row ${index + 1}: missing UOM for ${productLabel}`);
      return;
    }

    const preferred = toNumber(row[priceColumn]);
    const fallback = toNumber(row[fallbackColumn]);
    const price = preferred ?? fallback ?? null;
    if (price === null || price <= 0) {
      skipped.push(`Row ${index + 1}: no usable price for ${productLabel}`);
      return;
    }

    const skuBase = typeSuffix ? `${primaryName} ${typeSuffix}` : primaryName;
    const sku = `NB-${uom.toUpperCase()}-${slugify(skuBase)}`;

    products.set(sku, {
      name: productLabel,
      uom,
      sku,
      price,
      productType: productLabel,
    });
  });

  return { products: Array.from(products.values()), skipped };
}

async function ensureTenantId(tenantCode: string, supabaseUrl: string, supabaseKey: string) {
  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await client
    .from("tenants")
    .select("id")
    .eq("code", tenantCode)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load tenant '${tenantCode}': ${error.message}`);
  }
  if (!data) {
    throw new Error(`Tenant with code '${tenantCode}' not found.`);
  }

  return { client, tenantId: data.id };
}

async function upsertProducts(
  client: ReturnType<typeof createClient>,
  tenantId: string,
  records: ParsedRow[],
) {
  if (records.length === 0) {
    return { productsUpserted: 0, productIdMap: new Map<string, string>() };
  }

  const payload = records.map((record) => ({
    tenant_id: tenantId,
    sku: record.sku,
    name: record.name,
    uom: record.uom,
    status: "active",
  }));

  const { data, error } = await client
    .from("products")
    .upsert(payload, { onConflict: "tenant_id,sku" })
    .select("id, sku");

  if (error) {
    throw new Error(`Failed to upsert products: ${error.message}`);
  }

  const productIdMap = new Map<string, string>();
  (data ?? []).forEach((row) => {
    productIdMap.set(row.sku, row.id);
  });

  if (productIdMap.size !== records.length) {
    const missing = records.filter((record) => !productIdMap.has(record.sku));
    if (missing.length > 0) {
      throw new Error(
        `Failed to resolve product IDs for: ${missing
          .map((record) => record.sku)
          .join(", ")}`,
      );
    }
  }

  return { productsUpserted: records.length, productIdMap };
}

async function insertPrices(
  client: ReturnType<typeof createClient>,
  tenantId: string,
  skuRecords: ParsedRow[],
  productIdMap: Map<string, string>,
  currency: string,
) {
  if (skuRecords.length === 0) return 0;
  const now = new Date().toISOString();

  const payload = skuRecords.map((record) => ({
    tenant_id: tenantId,
    product_id: productIdMap.get(record.sku)!,
    unit_price: record.price,
    currency,
    effective_from: now,
  }));

  const { error } = await client.from("product_prices").insert(payload);
  if (error) {
    throw new Error(`Failed to insert product prices: ${error.message}`);
  }
  return payload.length;
}

async function main() {
  const argsObject = parseArgv(process.argv.slice(2));
  const options = ARG_SCHEMA.parse(argsObject);
  const resolvedPath = path.resolve(process.cwd(), options.file);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_PROJECT_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required.",
    );
  }

  const rawRows = loadRows(resolvedPath);
  const { products, skipped } = extractProducts(rawRows, options);

  if (products.length === 0) {
    console.warn("No valid product rows found; nothing to import.");
    if (skipped.length > 0) {
      console.warn("Skipped rows:");
      skipped.forEach((line) => console.warn(`  - ${line}`));
    }
    return;
  }

  const { client, tenantId } = await ensureTenantId(options.tenant, supabaseUrl, supabaseKey);

  const { productsUpserted, productIdMap } = await upsertProducts(client, tenantId, products);
  const pricesInserted = await insertPrices(client, tenantId, products, productIdMap, options.currency);

  console.log(`Tenant: ${options.tenant} (${tenantId})`);
  console.log(`File: ${resolvedPath}`);
  console.log(`Products processed: ${products.length}`);
  console.log(`Products upserted: ${productsUpserted}`);
  console.log(`Prices inserted: ${pricesInserted}`);

  if (skipped.length > 0) {
    console.log("Skipped rows:");
    skipped.forEach((line) => console.log(`  - ${line}`));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
