import type { CheckoutInput } from "../contracts";

export type SellableProduct = {
  local_id: string;
  name: string;
  price: number;
  stock: number;
  inventory_policy: "TRACKED" | "UNLIMITED";
};

export type PreparedLine<T extends SellableProduct> = {
  product: T;
  line: CheckoutInput["lines"][number];
  unitPrice: number;
  discount: number;
  total: number;
};

export function prepareLine<T extends SellableProduct>(
  product: T | undefined,
  line: CheckoutInput["lines"][number],
): PreparedLine<T> {
  if (!product) throw new Error("Product is no longer available");
  if (!Number.isInteger(line.quantity) || line.quantity <= 0)
    throw new Error("Quantity must be a positive whole number");
  if (product.inventory_policy === "TRACKED" && product.stock < line.quantity)
    throw new Error(`${product.name} has insufficient stock`);
  const unitPrice = line.unitPrice ?? product.price;
  const discount = line.discount ?? 0;
  if (
    !Number.isFinite(unitPrice) ||
    unitPrice < 0 ||
    !Number.isFinite(discount) ||
    discount < 0
  )
    throw new Error("Invalid sale price or discount");
  return {
    product,
    line,
    unitPrice,
    discount,
    total: Math.max(0, unitPrice * line.quantity - discount),
  };
}

export function calculateTotals(
  lines: Array<{ total: number }>,
  discountTotal = 0,
  taxTotal = 0,
) {
  if (discountTotal < 0 || taxTotal < 0) throw new Error("Invalid sale totals");
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  return {
    subtotal,
    discountTotal,
    taxTotal,
    total: Math.max(0, subtotal - discountTotal + taxTotal),
  };
}
