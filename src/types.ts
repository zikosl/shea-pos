import type { PosApi } from "../electron/contracts";
import type { CapabilityCode, Permission, LocalRole } from "../electron/contracts";

declare global {
  interface Window {
    pos: PosApi;
  }
}

export type AppState = {
  authenticated: boolean;
  user: { id: number; email?: string; role: string } | null;
  partner: { companyName?: string } | null;
  device: { id: string; name?: string } | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  offlineUntil: string | null;
  offlineAllowed: boolean;
  pendingChanges: number;
  capabilities: CapabilityCode[];
  localAccess: {
    setupRequired: boolean;
    authenticated: boolean;
    user: {
      id: string;
      name: string;
      username: string;
      role: LocalRole;
      permissions: Permission[];
      active: boolean;
    } | null;
    permissions: Permission[];
  };
};

export type Product = {
  local_id: string;
  server_id?: number;
  name: string;
  name_ar?: string;
  variant_name?: string;
  sku?: string;
  barcode?: string;
  image?: string;
  price: number;
  cost_price: number;
  discount: number;
  stock: number;
  reorder_threshold: number;
  category_id?: number;
  inventory_policy: string;
  available: number;
  visible_in_pos: number;
  active: number;
  price_on_request: number;
};

export type CartLine = { product: Product; quantity: number; unitPrice?: number };

export type Catalog = {
  niches: Array<{ id: number; name: string; name_ar: string }>;
  categories: Array<{
    id: number;
    niche_id: number;
    name: string;
    name_ar: string;
    image?: string;
    product_count?: number;
  }>;
  productTypes: Array<{
    id: number;
    category_id: number;
    name: string;
    name_ar: string;
  }>;
  brands: Array<{ id: number; niche_id: number; name: string }>;
};
