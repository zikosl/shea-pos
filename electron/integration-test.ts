import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PosDatabase } from "./database";
import { LocalAccessService } from "./access";
import { ProductAssetService } from "./assets";
import {
  previewInvoice,
  previewPriceLabel,
  previewReceipt,
  previewStockEntry,
} from "./printer";

async function main() {
    const root = mkdtempSync(path.join(os.tmpdir(), "shea-pos-test-"));
    const database = new PosDatabase(root);
    try {
      const access = new LocalAccessService(database);
      assert.equal(access.state().setupRequired, true);
      const ownerState = access.setupOwner({ name: "Owner", username: "owner", secret: "2468" });
      assert.equal(ownerState.authenticated, true);
      assert.equal(ownerState.permissions.includes("USERS_MANAGE"), true);
      assert.throws(
        () => access.updateUser({ id: ownerState.user!.id, name: "Owner", username: "owner", role: "MANAGER", active: true }),
        /At least one active owner/,
      );
      access.createUser({ name: "Cashier", username: "cashier", secret: "1357", role: "CASHIER" });
      access.logout();
      const cashierState = access.login("cashier", "1357");
      assert.equal(cashierState.permissions.includes("POS_SELL"), true);
      assert.throws(() => access.require("USERS_MANAGE"), /PERMISSION_DENIED/);
      access.logout();
      access.login("owner", "2468");
      access.logout();
      assert.throws(() => access.recoverOwnerSecret("cashier", "9999"), /Active local owner not found/);
      access.recoverOwnerSecret("owner", "8642");
      assert.throws(() => access.login("owner", "2468"), /Invalid local credentials/);
      access.login("owner", "8642");
      assert.equal(access.listAudit().length > 0, true);
      database.setSetting("device", JSON.stringify({ id: "test-device" }));
      database.setSetting(
        "partner",
        JSON.stringify({ feeType: "PERCENTAGE", feeRate: 5 }),
      );
      database.setSetting("theme", "dark");
      database.setSetting("language", "ar");
      database.setSetting("primaryColor", "#c74878");
      database.setSetting("sidebarCollapsed", "true");
      assert.deepEqual(
        {
          theme: database.getSetting("theme"),
          language: database.getSetting("language"),
          primaryColor: database.getSetting("primaryColor"),
          sidebarCollapsed: database.getSetting("sidebarCollapsed"),
        },
        {
          theme: "dark",
          language: "ar",
          primaryColor: "#c74878",
          sidebarCollapsed: "true",
        },
      );
      database.openCashSession({ openingAmount: 1_000 });
      const insert = database.db.prepare(
        `INSERT INTO products(local_id,server_id,name,price,cost_price,stock,reorder_threshold,inventory_policy,available,visible_in_pos,active) VALUES (?,?,?,?,?,?,0,?,1,1,1)`,
      );
      insert.run("tracked", 1, "Tracked item", 100, 60, 5, "TRACKED");
      insert.run("unlimited", 2, "Service item", 50, 10, 0, "UNLIMITED");
      const assigned = database.updateProduct({ productLocalId: "tracked", vendorBarcode: "SHEA-TEST-001" }) as any;
      assert.equal(assigned.barcode, "SHEA-TEST-001");
      assert.equal((database.listInventory({ search: "SHEA-TEST-001" }) as any[])[0].local_id, "tracked");
      assert.throws(
        () => database.updateProduct({ productLocalId: "unlimited", vendorBarcode: "SHEA-TEST-001" }),
        /already assigned/,
      );
      const barcodeUpdate = database.pendingOutbox().find((row) => row.operation === "UPDATE_BARCODE" && JSON.parse(row.payload_json).vendorBarcode === "SHEA-TEST-001");
      assert.ok(barcodeUpdate);
      database.markOutboxSynced(barcodeUpdate.id);
      database.holdCart({ customerName: "Held customer", lines: [{ productLocalId: "tracked", quantity: 1 }] });
      const held = database.listHeldCarts() as any[];
      assert.equal(held.length, 1);
      assert.equal(held[0].payload.lines[0].product.local_id, "tracked");
      database.deleteHeldCart(held[0].id);
      assert.equal(database.listHeldCarts().length, 0);

      const sale = database.checkout({
        paymentMethod: "CASH",
        lines: [
          { productLocalId: "tracked", quantity: 2 },
          { productLocalId: "unlimited", quantity: 3 },
        ],
      }) as any;
      assert.equal((database.lookupInvoice(sale.sale_number) as any).id, sale.id);
      assert.equal((database.lookupInvoice(`shea:invoice:v1:POS:${sale.sale_number}`) as any).id, sale.id);
      const correctedSale = database.correctInvoiceDetails({
        id: sale.id,
        customerName: "Corrected customer",
        note: "Updated contact note",
        reason: "Customer requested a name correction",
        operatorId: "test-manager",
        operatorName: "Test manager",
      }) as any;
      assert.equal(correctedSale.revision, 2);
      assert.equal(correctedSale.customer_name, "Corrected customer");
      assert.equal(correctedSale.revisions.length, 1);
      assert.equal(correctedSale.total, sale.total);
      assert.equal((database.getProductByLocalId("tracked") as any).stock, 3);
      const queuedSale = database.db.prepare("SELECT payload_json FROM outbox WHERE aggregate_type='Sale' AND aggregate_id=?").get(sale.id) as any;
      assert.equal(JSON.parse(queuedSale.payload_json).customerName, "Corrected customer");
      assert.equal(sale.total, 350);
      assert.equal(sale.cost_total, 150);
      assert.equal(sale.gross_profit, 200);
      assert.equal(sale.partner_fee, 17.5);
      assert.equal(sale.net_profit, 182.5);
      assert.equal(
        (
          database.db
            .prepare("SELECT stock FROM products WHERE local_id=?")
            .get("tracked") as any
        ).stock,
        3,
      );
      assert.equal(
        (
          database.db
            .prepare("SELECT stock FROM products WHERE local_id=?")
            .get("unlimited") as any
        ).stock,
        0,
      );

      const overview = database.overview({
        from: new Date(Date.now() - 60_000).toISOString(),
        to: new Date(Date.now() + 60_000).toISOString(),
      }) as any;
      assert.equal(overview.summary.sale_count, 1);
      assert.equal(overview.summary.revenue, 350);
      assert.equal(overview.topProducts.length, 2);
      assert.equal(
        overview.topProducts.reduce(
          (sum: number, row: any) => sum + row.revenue,
          0,
        ),
        350,
      );

      database.db.prepare("UPDATE products SET price_on_request=1 WHERE local_id='tracked'").run();
      assert.throws(() => database.checkout({ paymentMethod: "CASH", lines: [{ productLocalId: "tracked", quantity: 1 }] }), /PRICE_CONFIRMATION_REQUIRED/);
      database.db.prepare("UPDATE products SET price_on_request=0 WHERE local_id='tracked'").run();
      assert.throws(() => database.checkout({ paymentMethod: "CASH", amountTendered: 10, lines: [{ productLocalId: "tracked", quantity: 1 }] }), /INSUFFICIENT_TENDERED_CASH/);

      const saleDetails = database.getSaleDetails(sale.id) as any;
      const trackedLine = saleDetails.items.find((item: any) => item.product_local_id === "tracked");
      const refunded = database.refundSale({
        saleId: sale.id,
        reason: "Customer returned sealed item",
        lines: [{ saleItemId: trackedLine.id, quantity: 1 }],
        operatorId: "test-manager",
        operatorName: "Test manager",
      }) as any;
      assert.equal(refunded.sale.status, "PARTIALLY_REFUNDED");
      assert.equal(refunded.sale.refunded_total, 100);
      assert.equal((database.getProductByLocalId("tracked") as any).stock, 4);
      const netOverview = database.overview({
        from: new Date(Date.now() - 60_000).toISOString(),
        to: new Date(Date.now() + 60_000).toISOString(),
      }) as any;
      assert.equal(netOverview.summary.revenue, 250);

      const salesBeforeFailure = (
        database.db.prepare("SELECT COUNT(*) count FROM sales").get() as any
      ).count;
      assert.throws(
        () =>
          database.checkout({
            paymentMethod: "CASH",
            lines: [{ productLocalId: "tracked", quantity: 5 }],
          }),
        /insufficient stock/,
      );
      assert.equal(
        (database.db.prepare("SELECT COUNT(*) count FROM sales").get() as any)
          .count,
        salesBeforeFailure,
      );

      database.createProposal({
        entityType: "CATEGORY",
        name: "Test category",
        nicheId: 1,
      });
      const provisional = database.createLocalProduct({
        name: "Offline serum",
        categoryId: 1,
        variantName: "30 ml",
        price: 700,
        costPrice: 420,
        stock: 8,
        trackInventory: true,
      }) as any;
      assert.equal(provisional.provisional, 1);
      assert.equal(provisional.request_status, "LOCAL_DRAFT");
      assert.equal(
        (
          database
            .listOutbox()
            .find(
              (row: any) => row.aggregate_id === provisional.local_id,
            ) as any
        ).operation,
        "SUBMIT_PRODUCT_REQUEST",
      );
      assert.equal(database.listMovements({}).length, 2);
      assert.equal((database.getCashSession() as any).expected_cash, 1_250);
      assert.equal(database.countPendingOutbox(), 5);
      mkdirSync(path.join(root, "assets", "catalog-drafts"), { recursive: true });
      writeFileSync(path.join(root, "assets", "catalog-drafts", "perfume.jpg"), Buffer.from("offline-image"));
      const productBundle = database.createLocalProductBundle({
        name: "Offline perfume",
        categoryId: 1,
        trackInventory: true,
        images: ["draft:catalog-drafts/perfume.jpg"],
        variants: [
          { name: "30 ml", tags: ["30 ml"], sku: "PERF-30", price: 1200, stock: 4 },
          { name: "50 ml", tags: ["50 ml"], sku: "PERF-50", price: 1800, stock: 2 },
        ],
      }) as any[];
      assert.equal(productBundle.length, 2);
      assert.equal(productBundle.every((row) => row.provisional === 1), true);
      assert.equal(database.listProducts({ search: "Offline perfume" }).every((row: any) => row.image?.startsWith("data:image/jpeg;base64,")), true);
      const bundleOutbox = database.pendingOutbox().find((row: any) => row.aggregate_type === "ProductBundle") as any;
      assert.ok(bundleOutbox);
      assert.equal(JSON.parse(bundleOutbox.payload_json).variants.length, 2);
      database.adjustStock({
        productLocalId: "tracked",
        mode: "RECEIVE",
        quantity: 2,
        reason: "Supplier delivery",
      });
      database.adjustStock({
        productLocalId: "tracked",
        mode: "REMOVE",
        quantity: 1,
        reason: "Damaged goods",
      });
      database.adjustStock({
        productLocalId: "tracked",
        mode: "SET",
        quantity: 2,
        reason: "Inventory count",
      });
      assert.equal(
        (database.getProductByLocalId("tracked") as any).stock,
        2,
      );
      assert.deepEqual(
        database
          .listMovements({ productLocalId: "tracked" })
          .slice(0, 3)
          .map((row: any) => row.type),
        ["ADJUSTMENT_OUT", "REMOVAL", "RECEIPT"],
      );
      const stockEntry = database.createStockEntry({
        supplierName: "Beauty Supply",
        supplierInvoice: "SUP-42",
        lines: [
          {
            productLocalId: "tracked",
            quantity: 2,
            pricingMode: "TOTAL",
            price: 200,
          },
        ],
      }) as any;
      assert.equal(stockEntry.entry.total_cost, 200);
      assert.equal(stockEntry.items[0].unit_cost, 100);
      assert.equal((database.getProductByLocalId("tracked") as any).stock, 4);
      assert.equal((database.getProductByLocalId("tracked") as any).cost_price, 80);
      assert.match(previewStockEntry(database, stockEntry.entry.id), /Beauty Supply/);
      database.cancelStockEntry(stockEntry.entry.id);
      assert.equal((database.getProductByLocalId("tracked") as any).stock, 2);
      assert.equal((database.getProductByLocalId("tracked") as any).cost_price, 60);
      const unitPricedEntry = database.createStockEntry({
        lines: [{ productLocalId: "tracked", quantity: 3, pricingMode: "UNIT", price: 50 }],
      }) as any;
      assert.equal(unitPricedEntry.entry.total_cost, 150);
      assert.equal((database.getProductByLocalId("tracked") as any).cost_price, 54);
      database.cancelStockEntry(unitPricedEntry.entry.id);
      const correctedReceipt = previewReceipt(database, sale.id);
      assert.match(correctedReceipt, /POS-/);
      assert.match(correctedReceipt, /<section class="invoice-codes">/);
      assert.match(correctedReceipt, /Corrected invoice|فاتورة مصححة/);
      const qrReceipt = previewReceipt(database, sale.id, {
        receiptCodeType: "qr",
        receiptCodePosition: "header",
        receiptCodeAlignment: "end",
        receiptShowNote: "false",
      });
      assert.match(qrReceipt, /class="qr"/);
      assert.doesNotMatch(qrReceipt, /class="barcode"/);
      assert.equal(qrReceipt.indexOf("<section class=\"invoice-codes\">") < qrReceipt.indexOf("class=\"customer\""), true);
      assert.doesNotMatch(qrReceipt, /Updated contact note/);
      const narrowDualCodeReceipt = previewReceipt(database, sale.id, {
        receiptPaperWidth: "58",
        receiptCodeType: "both",
      });
      assert.match(narrowDualCodeReceipt, /flex-direction:column/);
      assert.match(narrowDualCodeReceipt, /class="qr"/);
      assert.match(narrowDualCodeReceipt, /class="barcode"/);
      assert.doesNotMatch(previewReceipt(database, sale.id, { receiptCodeType: "none" }), /<section class="invoice-codes">/);
      assert.match(
        previewPriceLabel(database, provisional.local_id),
        /Offline serum/,
      );
      const compactLabel = previewPriceLabel(database, provisional.local_id, {
        labelWidth: "40",
        labelHeight: "20",
        language: "ar",
      });
      assert.match(compactLabel, /<html lang="ar" dir="rtl">/);
      assert.match(compactLabel, /@page\{size:40mm 20mm;margin:0\}/);
      assert.match(compactLabel, /class="price" dir="ltr"/);
      assert.doesNotMatch(compactLabel, /border:\.2mm solid/);
      database.db.prepare(
        "INSERT INTO orders(server_id,status,total,customer_name,payload_json) VALUES (42,'DELIVERED',700,'Delivery customer',?)",
      ).run(JSON.stringify({
        id: 42,
        subtotal: 700,
        paymentMethod: "CASH",
        createdAt: new Date().toISOString(),
        items: [{ quantity: 1, price: 700, product: { customName: "Delivered serum" } }],
      }));
      assert.match(previewInvoice(database, "DELIVERY", "42"), /Delivered serum/);
      assert.equal((database.lookupInvoice("shea:invoice:v1:DELIVERY:ORD-42") as any).id, "42");
      assert.equal(database.listInvoices().some((row: any) => row.source === "DELIVERY"), true);
      database.db
        .prepare(
          "INSERT INTO outbox(id,operation,aggregate_type,aggregate_id,payload_json,state,created_at,updated_at) VALUES ('blocked-sale','CREATE_SALE','Sale','sale-x',?,'BLOCKED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        )
        .run(
          JSON.stringify({
            items: [
              { product_local_id: "new-product", product_server_id: null },
            ],
          }),
        );
      database.db
        .prepare(
          "INSERT INTO products(local_id,name,price,cost_price,stock,inventory_policy,available,visible_in_pos,active,provisional) VALUES ('new-product','New',10,2,0,'UNLIMITED',1,1,1,1)",
        )
        .run();
      database.markProductSynced("new-product", 99);
      const unblocked = database.db
        .prepare(
          "SELECT state,payload_json FROM outbox WHERE id='blocked-sale'",
        )
        .get() as any;
      assert.equal(unblocked.state, "PENDING");
      assert.equal(
        JSON.parse(unblocked.payload_json).items[0].product_server_id,
        99,
      );
      database.db.prepare(
        "UPDATE products SET remote_image_url='/uploads/products/serum.webp',image_sync_state='PENDING' WHERE local_id='tracked'",
      ).run();
      assert.equal(
        database.productImageCandidates().some((row) => row.local_id === "tracked"),
        true,
      );
      mkdirSync(path.join(root, "assets", "products"), { recursive: true });
      writeFileSync(path.join(root, "assets", "products", "serum.webp"), Buffer.from("RIFFtestWEBP"));
      database.markProductImageReady("tracked", "products/serum.webp", "checksum");
      const cachedProduct = database.listInventory({ search: "Tracked" }).find((row: any) => row.local_id === "tracked") as any;
      assert.match(cachedProduct.image, /^data:image\/webp;base64,/);
      assert.equal(cachedProduct.image_checksum, "checksum");
      database.setSetting("assetBase", "https://shea.example.com");
      database.db.prepare("UPDATE products SET remote_image_url='/api/uploads/products/serum.webp' WHERE local_id='tracked'").run();
      const assets = new ProductAssetService(database, root);
      await assert.rejects(
        () => assets.refreshProduct("tracked"),
        /Image download failed|fetch failed|ENOTFOUND|ECONNREFUSED/,
      );
      const customOrder = database.createCustomOrder({
        customerName: "Gift customer",
        requiredAt: new Date(Date.now() + 86_400_000).toISOString(),
        fulfillmentMode: "PICKUP",
        occasion: "Birthday",
        lines: [{ name: "Rose box", quantity: 1, unitPrice: 2_500 }],
      }) as any;
      assert.equal(customOrder.status, "REQUESTED");
      assert.equal(customOrder.total, 2_500);
      assert.equal(database.listGiftOrders().some((row: any) => row.id === customOrder.id), true);
      assert.equal(database.listOutbox().some((row: any) => row.aggregate_id === customOrder.id && row.operation === "CREATE_CUSTOM_ORDER"), true);
      database.markCustomOrderCreated(customOrder.id, {
        id: "server-gift-1",
        orderNumber: customOrder.order_number,
        customerName: "Gift customer",
        status: "QUOTED",
        version: 2,
        updatedAt: new Date().toISOString(),
      });
      const transitioned = database.transitionCustomOrder(customOrder.id, "AWAITING_CUSTOMER_APPROVAL") as any;
      assert.equal(transitioned.status, "AWAITING_CUSTOMER_APPROVAL");
      assert.equal(transitioned.version, 3);
      const backupPath = await database.createBackup(root);
      assert.equal(existsSync(path.join(backupPath, "shea-pos.sqlite")), true);
      assert.equal(existsSync(path.join(backupPath, "assets", "products", "serum.webp")), true);
      console.log("Shea POS core integration checks passed");
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
