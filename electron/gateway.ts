import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import type { PosDatabase } from "./database";
import type { CheckoutInput } from "./contracts";
import { POS_PROTOCOL_VERSION, saleRequestSchema, stockAdjustmentSchema, stockBatchSchema } from "@zikosl/shea-pos-protocol";

const TOKEN_KEY = "secureGatewayToken";

function normalizeGatewayUrl(value: string) {
  const url = new URL(value.trim());
  if (!/^https?:$/.test(url.protocol))
    throw new Error("Gateway URL must use HTTP or HTTPS");
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

export class GatewayService {
  constructor(private readonly database: PosDatabase) {}

  enabled() {
    return this.database.getSetting("deploymentMode") === "multi";
  }

  private token() {
    const encrypted = this.database.getSetting(TOKEN_KEY);
    if (!encrypted || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      return null;
    }
  }

  private url() {
    const value = this.database.getSetting("gatewayUrl");
    if (!value) throw new Error("Store gateway is not configured");
    return normalizeGatewayUrl(value);
  }

  private async request<T>(path: string, init?: RequestInit, authenticated = true) {
    const token = authenticated ? this.token() : null;
    if (authenticated && !token) throw new Error("Store gateway is not paired");
    const response = await fetch(`${this.url()}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {}),
      },
      signal: AbortSignal.timeout(8_000),
    });
    const body = await response.json().catch(() => null) as T & { error?: string } | null;
    if (!response.ok) throw new Error(body?.error || `Gateway returned ${response.status}`);
    if (!body) throw new Error("Gateway returned no data");
    return body;
  }

  async pair(input: { url: string; pairingCode: string; name: string }) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("Secure credential storage is unavailable on this device");
    this.database.setSetting("gatewayUrl", normalizeGatewayUrl(input.url));
    const terminalKey = this.database.getSetting("deviceKey");
    if (!terminalKey) throw new Error("Activate this POS before pairing a gateway");
    const result = await this.request<{ id: string; name: string; token: string }>(
      "/v1/terminals/pair",
      {
        method: "POST",
        body: JSON.stringify({
          protocolVersion: POS_PROTOCOL_VERSION,
          pairingCode: input.pairingCode,
          terminalKey,
          name: input.name,
        }),
      },
      false,
    );
    this.database.setSetting(
      TOKEN_KEY,
      safeStorage.encryptString(result.token).toString("base64"),
    );
    this.database.setSetting("deploymentMode", "multi");
    this.database.setSetting("gatewayTerminalId", result.id);
    return this.status();
  }

  disconnect() {
    this.database.deleteSetting(TOKEN_KEY);
    this.database.deleteSetting("gatewayTerminalId");
    this.database.setSetting("deploymentMode", "solo");
  }

  status() {
    if (!this.enabled()) return Promise.resolve({ mode: "solo", connected: true });
    return this.request<Record<string, unknown>>("/v1/status")
      .then((status) => ({ mode: "multi", connected: true, ...status }))
      .catch((error) => ({
        mode: "multi",
        connected: false,
        error: error instanceof Error ? error.message : "Gateway unavailable",
      }));
  }

  async refreshProducts() {
    if (!this.enabled()) return;
    const result = await this.request<{ products: Array<Record<string, unknown>> }>("/v1/products");
    this.database.applyGatewayProducts(result.products);
  }

  async createSale(input: CheckoutInput, transactionId: string, saleNumber: string) {
    const lines = this.database.gatewaySaleLines(input.lines);
    return this.request("/v1/sales", {
      method: "POST",
      body: JSON.stringify(saleRequestSchema.parse({
        protocolVersion: POS_PROTOCOL_VERSION,
        id: transactionId,
        saleNumber,
        cashierId: input.operatorId,
        cashierName: input.operatorName,
        customerName: input.customerName,
        note: input.note,
        discountTotal: input.discountTotal,
        taxTotal: input.taxTotal,
        paymentMethod: input.paymentMethod,
        createdAt: new Date().toISOString(),
        items: lines,
      })),
    });
  }

  async adjustStock(input: { productLocalId: string; mode: "RECEIVE" | "REMOVE" | "SET"; quantity: number; reason: string }) {
    const product = this.database.gatewayProduct(input.productLocalId);
    return this.request("/v1/stock-adjustments", {
      method: "POST",
      body: JSON.stringify(stockAdjustmentSchema.parse({ protocolVersion: POS_PROTOCOL_VERSION, id: randomUUID(), productId: product.serverId, ...input, productLocalId: undefined })),
    });
  }

  async updateProduct(input: Record<string, unknown> & { productLocalId: string }) {
    const product = this.database.gatewayProduct(input.productLocalId);
    const { productLocalId: _localId, ...changes } = input;
    return this.request(`/v1/products/${product.serverId}`, {
      method: "PATCH",
      body: JSON.stringify({ protocolVersion: POS_PROTOCOL_VERSION, id: randomUUID(), ...changes }),
    });
  }

  async applyStockBatch(input: {
    id: string;
    operation: "RECEIPT" | "REVERSE";
    reference?: string;
    lines: Array<{ productLocalId: string; quantity: number; unitCost: number }>;
  }) {
    return this.request("/v1/stock-batches", {
      method: "POST",
      body: JSON.stringify(stockBatchSchema.parse({
        protocolVersion: POS_PROTOCOL_VERSION,
        id: input.id,
        operation: input.operation,
        reference: input.reference,
        lines: input.lines.map((line) => ({
          productId: this.database.gatewayProduct(line.productLocalId).serverId,
          quantity: line.quantity,
          unitCost: line.unitCost,
        })),
      })),
    });
  }
}
