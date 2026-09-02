import { randomUUID } from "node:crypto";
import type { PosDatabase } from "./database";
import { graphqlRequest, refreshSession } from "./graphql";
import { readSession, writeSession, type Session } from "./session";

export class SyncService {
  private running = false;

  constructor(private readonly database: PosDatabase) {}

  private async activeSession() {
    let session = readSession(this.database);
    if (!session) throw new Error("Sign in is required");
    const expiresAt = session.accessTokenExpires
      ? new Date(session.accessTokenExpires).getTime()
      : 0;
    if (expiresAt && expiresAt < Date.now() + 60_000) {
      session = await refreshSession(session);
      writeSession(this.database, session);
    }
    return session;
  }

  async activate(session: Session, deviceName: string) {
    if (session.user.role !== "PARTNER")
      throw new Error("A partner account is required");
    this.database.setSetting("endpoint", session.endpoint);
    this.database.setSetting("assetBase", new URL(session.endpoint).origin);
    let deviceKey = this.database.getSetting("deviceKey");
    if (!deviceKey) {
      deviceKey = randomUUID();
      this.database.setSetting("deviceKey", deviceKey);
    }
    const data = await graphqlRequest<{
      registerDevice: { id: string; deviceKey: string };
    }>(
      session.endpoint,
      `
      mutation RegisterPosDevice($deviceKey: String!, $name: String) {
        registerDevice(deviceKey: $deviceKey, platform: DESKTOP, name: $name, appVersion: "0.1.0") { id deviceKey }
      }
    `,
      { deviceKey, name: deviceName },
      session.accessToken,
    );
    this.database.setSetting("device", JSON.stringify(data.registerDevice));
    writeSession(this.database, session);
    return this.sync();
  }

  async sync() {
    if (this.running) return this.state();
    this.running = true;
    try {
      let session = await this.activeSession();
      try {
        await this.push(session);
      } catch (error) {
        if (!String(error).toLowerCase().includes("token")) throw error;
        session = await refreshSession(session);
        writeSession(this.database, session);
        await this.push(session);
      }
      const deviceKey = this.database.getSetting("deviceKey");
      if (!deviceKey) throw new Error("POS device is not activated");
      const result = await graphqlRequest<{
        posBootstrap: { cursor: string; offlineUntil: string; payload: string };
      }>(
        session.endpoint,
        `
        query PosBootstrap($deviceKey: String!) { posBootstrap(deviceKey: $deviceKey) { cursor offlineUntil payload } }
      `,
        { deviceKey },
        session.accessToken,
      );
      session = {
        ...session,
        offlineUntil: result.posBootstrap.offlineUntil,
        lastTrustedAt: new Date().toISOString(),
      };
      writeSession(this.database, session);
      this.database.applyBootstrap(
        JSON.parse(result.posBootstrap.payload),
        result.posBootstrap.cursor,
        result.posBootstrap.offlineUntil,
      );
      this.database.setSetting("lastSyncError", "");
      return this.state();
    } catch (error) {
      this.database.setSetting(
        "lastSyncError",
        error instanceof Error ? error.message : "Sync failed",
      );
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async push(session: Session) {
    const device = JSON.parse(this.database.getSetting("device") ?? "{}") as {
      id?: string;
    };
    for (const row of this.database.pendingOutbox()) {
      try {
        const payload = JSON.parse(row.payload_json);
        if (row.operation === "SUBMIT_CATALOG_PROPOSAL") {
          const data = await graphqlRequest<{
            submitCatalogProposal: { id: string; status: string };
          }>(
            session.endpoint,
            `
            mutation SubmitCatalogProposal($localId: String!, $entityType: CatalogProposalEntityType!, $name: String!, $nameAr: String, $description: String, $image: String, $nicheId: Int!, $categoryId: Int, $parentProposalId: String, $deviceId: String) {
              submitCatalogProposal(localId: $localId, entityType: $entityType, name: $name, name_ar: $nameAr, description: $description, image: $image, nicheId: $nicheId, categoryId: $categoryId, parentProposalId: $parentProposalId, deviceId: $deviceId) { id status }
            }
          `,
            { ...payload, nameAr: payload.nameAr, deviceId: device.id },
            session.accessToken,
          );
          this.database.markProposalSynced(
            row.aggregate_id,
            data.submitCatalogProposal.id,
            data.submitCatalogProposal.status,
          );
        } else if (row.operation === "SUBMIT_PRODUCT_REQUEST") {
          const data = await graphqlRequest<{
            submitProductTemplateRequest: { id: number; status: string };
          }>(
            session.endpoint,
            `
            mutation SubmitPosProductRequest($name: String!, $nameAr: String, $description: String, $images: ImagesList, $categoryId: Int, $productTypeId: Int, $brandId: Int, $variants: [ProductTemplateRequestVariantInput], $posLocalId: String, $posDeviceId: String) {
              submitProductTemplateRequest(name: $name, name_ar: $nameAr, description: $description, images: $images, category_id: $categoryId, product_type_id: $productTypeId, brand_id: $brandId, variants: $variants, posLocalId: $posLocalId, posDeviceId: $posDeviceId) { id status }
            }
          `,
            {
              ...payload,
              images: { images: payload.images ?? [] },
              posDeviceId: device.id,
            },
            session.accessToken,
          );
          this.database.markProductRequestSubmitted(
            row.aggregate_id,
            data.submitProductTemplateRequest.id,
            data.submitProductTemplateRequest.status,
          );
        } else if (row.operation === "ACTIVATE_PRODUCT") {
          const data = await graphqlRequest<{ createProduct: { id: number } }>(
            session.endpoint,
            `
            mutation ActivatePosProduct($variantId: Int!, $price: Float, $costPrice: Float, $stock: Int, $trackInventory: Boolean, $reorderThreshold: Int, $isVisibleInPos: Boolean) {
              createProduct(variantId: $variantId, price: $price, costPrice: $costPrice, stock: $stock, trackInventory: $trackInventory, reorderThreshold: $reorderThreshold, isVisibleInPos: $isVisibleInPos, available: true, isActive: true) { id }
            }
          `,
            {
              ...payload,
              stock: Math.round(payload.stock),
              reorderThreshold: Math.round(payload.reorderThreshold ?? 0),
            },
            session.accessToken,
          );
          this.database.markProductSynced(
            row.aggregate_id,
            data.createProduct.id,
          );
        } else if (row.operation === "OPEN_CASH_SESSION") {
          const data = await graphqlRequest<{
            openCashSession: { id: string };
          }>(
            session.endpoint,
            `
            mutation OpenPosRegister($deviceId: String, $openingAmount: Float, $note: String) { openCashSession(deviceId: $deviceId, openingAmount: $openingAmount, note: $note) { id } }
          `,
            {
              deviceId: device.id,
              openingAmount: payload.openingAmount,
              note: payload.note,
            },
            session.accessToken,
          );
          this.database.markCashSessionOpened(
            row.aggregate_id,
            data.openCashSession.id,
          );
        } else if (row.operation === "CLOSE_CASH_SESSION") {
          const cash = this.database.getCashSessionByLocalId(row.aggregate_id);
          if (!cash?.server_id)
            throw new Error("Register opening must synchronize first");
          await graphqlRequest(
            session.endpoint,
            `mutation ClosePosRegister($id: String!, $countedCash: Float!, $note: String) { closeCashSession(id: $id, countedCash: $countedCash, note: $note) { id } }`,
            {
              id: cash.server_id,
              countedCash: payload.countedCash,
              note: payload.note,
            },
            session.accessToken,
          );
          this.database.markCashSessionClosed(row.aggregate_id);
        } else if (row.operation === "CREATE_SALE") {
          const data = await graphqlRequest<{ createSale: { id: string } }>(
            session.endpoint,
            `
            mutation CreatePosSale($data: CreateSaleInput!) { createSale(data: $data) { id } }
          `,
            {
              data: {
                saleNumber: payload.saleNumber,
                deviceId: device.id,
                customerName: payload.customerName,
                note: payload.note,
                discountTotal: payload.discountTotal,
                taxTotal: payload.taxTotal,
                items: payload.items.map((item: any) => ({
                  productId: item.product_server_id,
                  quantity: item.quantity,
                  unitPrice: item.unit_price,
                  discount: item.discount,
                  tax: item.tax,
                })),
                payment: {
                  method: payload.paymentMethod,
                  amount: payload.total,
                },
              },
            },
            session.accessToken,
          );
          this.database.markSaleSynced(row.aggregate_id, data.createSale.id);
        } else if (row.operation === "UPDATE_STOCK") {
          await graphqlRequest(
            session.endpoint,
            `mutation UpdatePosStock($id: Int!, $stock: Int!) { updateProduct(id: $id, stock: $stock) { id } }`,
            { id: payload.serverId, stock: Math.round(payload.stock) },
            session.accessToken,
          );
        } else if (row.operation === "UPDATE_PRODUCT") {
          await graphqlRequest(
            session.endpoint,
            `mutation UpdatePosProduct($id: Int!, $price: Float, $costPrice: Float, $discount: Float, $stock: Int, $reorderThreshold: Int, $trackInventory: Boolean, $available: Boolean, $isVisibleInPos: Boolean, $isActive: Boolean) { updateProduct(id: $id, price: $price, costPrice: $costPrice, discount: $discount, stock: $stock, reorderThreshold: $reorderThreshold, trackInventory: $trackInventory, available: $available, isVisibleInPos: $isVisibleInPos, isActive: $isActive) { id } }`,
            {
              ...payload,
              id: payload.serverId,
              stock: Math.round(payload.stock),
              reorderThreshold: Math.round(payload.reorderThreshold ?? 0),
            },
            session.accessToken,
          );
        }
        this.database.markOutboxSynced(row.id);
      } catch (error) {
        this.database.markOutboxError(
          row.id,
          error instanceof Error ? error.message : "Sync operation failed",
        );
      }
    }
  }

  state() {
    const settings = this.database.getSettings();
    const session = readSession(this.database);
    return {
      authenticated: Boolean(session),
      user: session?.user ?? null,
      partner: settings.partner ? JSON.parse(settings.partner) : null,
      device: settings.device ? JSON.parse(settings.device) : null,
      lastSyncAt: settings.lastSyncAt || null,
      lastSyncError: settings.lastSyncError || null,
      offlineUntil: session?.offlineUntil || null,
      offlineAllowed: this.isLeaseValid(session),
      pendingChanges: this.database.countPendingOutbox(),
    };
  }

  assertCanTransact() {
    const session = readSession(this.database);
    if (!this.isLeaseValid(session))
      throw new Error("Connect to the internet to renew this POS device");
  }

  private isLeaseValid(session: Session | null) {
    if (!session?.offlineUntil || !session.lastTrustedAt) return false;
    const now = Date.now();
    const clockWasRolledBack =
      now < new Date(session.lastTrustedAt).getTime() - 5 * 60_000;
    return (
      !clockWasRolledBack && now < new Date(session.offlineUntil).getTime()
    );
  }
}
