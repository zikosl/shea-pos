import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeStorage } from "electron";
import { PosDatabase } from "./database";
import { barcodeCandidates, barcodeMatches, barcodeSearchTerms } from "./domain/barcode";
import { LocalAccessService } from "./access";
import { ProductAssetService } from "./assets";
import {
  cashDrawerKickCommand,
  printOptions,
  previewInvoice,
  previewPriceLabel,
  previewReceipt,
  previewStockEntry,
  receiptHtml,
} from "./printer";

async function main() {
    assert.deepEqual([...cashDrawerKickCommand(2)], [0x1b, 0x70, 0x00, 0x0c, 0x7d]);
    assert.deepEqual([...cashDrawerKickCommand(5)], [0x1b, 0x70, 0x01, 0x0c, 0x7d]);
    assert.deepEqual(barcodeCandidates("]C10105012345678900\u001d17270101"), ["05012345678900", "010501234567890017270101"]);
    assert.equal(barcodeMatches("0501234567890", "00501234567890"), true);
    assert.equal(barcodeSearchTerms("00501234567890").includes("0501234567890"), true);
    assert.equal(barcodeMatches("SKU-123", "sku-123"), true);
    assert.equal(printOptions().usePrinterDefaultPageSize, true);
    assert.equal(printOptions("Receipt printer").deviceName, "Receipt printer");
    assert.deepEqual(printOptions("Label printer", { width: 50_000, height: 30_000 }).pageSize, { width: 50_000, height: 30_000 });
    const root = mkdtempSync(path.join(os.tmpdir(), "shea-pos-test-"));
    const database = new PosDatabase(root);
    try {
      database.db.prepare("INSERT INTO niches(id,name) VALUES (?,?),(?,?)").run(91001, "Test niche A", 91002, "Test niche B");
      database.db.prepare("INSERT INTO categories(id,niche_id,name) VALUES (?,?,?),(?,?,?)").run(91001, 91001, "Category A", 91002, 91002, "Category B");
      database.db.prepare("INSERT INTO templates(id,category_id,name) VALUES (?,?,?),(?,?,?)").run(91001, 91001, "Template A", 91002, 91002, "Template B");
      database.db.prepare("INSERT INTO variants(id,template_id,name) VALUES (?,?,?),(?,?,?),(?,?,?)").run(91001, 91001, "A small", 91002, 91001, "A large", 91003, 91002, "B standard");
      const nicheA = database.listTemplates({ nicheId: 91001, grouped: true, limit: 50 });
      const nicheB = database.listTemplates({ nicheId: 91002, grouped: true, limit: 50 });
      assert.equal(nicheA.total, 1);
      assert.equal(nicheA.rows.length, 2, "grouped niche results must keep every matching variant");
      assert.equal(nicheA.rows.every((row: any) => row.template_id === 91001), true);
      assert.equal(nicheB.total, 1);
      assert.equal(nicheB.rows.length, 1);
      assert.equal(nicheB.rows[0].template_id, 91002);

      database.initializeOnlineOrderReadState();
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
      if (safeStorage?.isEncryptionAvailable?.()) {
        const rememberingAccess = new LocalAccessService(database);
        const rememberedState = rememberingAccess.login("owner", "8642", true);
        assert.equal(rememberedState.remembered, true);
        const restoredAccess = new LocalAccessService(database);
        assert.equal(restoredAccess.restoreRememberedSession(), true);
        assert.equal(restoredAccess.state().authenticated, true);
        restoredAccess.logout();
        assert.equal(restoredAccess.state().remembered, false, "explicit local sign-out clears remembered session");
      }
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
      assert.throws(() => database.checkout({
        paymentMethod: "CASH",
        lines: [
          { productLocalId: "tracked", quantity: 4 },
          { productLocalId: "tracked", quantity: 4 },
        ],
      }), /DUPLICATE_PRODUCT_LINE/);
      assert.equal((database.getProductByLocalId("tracked") as any).stock, 5);
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
        operatorId: "test-manager",
        operatorName: "Test manager",
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
      assert.match(correctedReceipt, /\.totals \.grand\{align-items:center;border:1px solid #111/);
      assert.doesNotMatch(correctedReceipt, /min-height:90mm/);
      assert.equal((correctedReceipt.match(/class="row grand"/g) || []).length, 1);
      const refundedReceipt = receiptHtml({ ...sale, refunded_total: 50 }, [], database.getSettings());
      assert.equal((refundedReceipt.match(/class="row grand"/g) || []).length, 1);
      assert.match(refundedReceipt, /Net paid|الصافي المدفوع/);
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
      assert.deepEqual(database.listUnreadOnlineOrderIds(), [42]);
      assert.deepEqual(database.markOnlineOrdersSeen([42]), []);
      assert.deepEqual(database.listUnreadOnlineOrderIds(), []);
      assert.match(previewInvoice(database, "DELIVERY", "42"), /Delivered serum/);
      assert.equal((database.lookupInvoice("shea:invoice:v1:DELIVERY:ORD-42") as any).id, "42");
      assert.equal(database.listInvoices().some((row: any) => row.source === "DELIVERY"), true);
      const realtimeOrder = {
        id: 43,
        status: "REQUESTED",
        version: 1,
        source: "DELIVERY",
        pricingMode: "FIXED",
        subtotal: 300,
        discount: 0,
        appTax: 0,
        deliveryTax: 0,
        storeTax: 0,
        walkInCustomerName: "Realtime customer",
        updatedAt: new Date().toISOString(),
        items: [{ id: 1, productId: 2, nameSnapshot: "Realtime item", quantity: 1, price: 300 }],
        delivery: { status: "PENDING", type: "NORMAL" },
      };
      assert.deepEqual(database.upsertOnlineOrders([realtimeOrder]), [43]);
      assert.deepEqual(database.upsertOnlineOrders([realtimeOrder]), []);
      const refreshedOrder = database.listOrders().find((row: any) => row.server_id === 43) as any;
      assert.equal(refreshedOrder.status, "REQUESTED");
      assert.equal(refreshedOrder.customer_name, "Realtime customer");
      assert.equal(JSON.parse(refreshedOrder.payload_json).items[0].nameSnapshot, "Realtime item");
      assert.deepEqual(database.upsertOnlineOrders([{ ...realtimeOrder, status: "PARTNER_ACCEPTED", version: 2 }]), [43]);
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
      database.setSetting("assetBase", "https://shea.example.com");
      const remoteFallback = database.listInventory({ search: "Tracked" }).find((row: any) => row.local_id === "tracked") as any;
      assert.equal(remoteFallback.image, "https://shea.example.com/uploads/products/serum.webp");
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
      }, { id: "test-manager", name: "Test manager" }) as any;
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
      const transitioned = database.transitionCustomOrder(customOrder.id, "AWAITING_CUSTOMER_APPROVAL", { id: "test-manager", name: "Test manager" }) as any;
      assert.equal(transitioned.status, "AWAITING_CUSTOMER_APPROVAL");
      assert.equal(transitioned.version, 3);
      const orderHistory = database.orderActivity("GIFT", customOrder.id) as any[];
      assert.equal(orderHistory.length, 2);
      assert.equal(orderHistory[0].operator_name, "Test manager");
      assert.equal(orderHistory[0].sync_state, "PENDING");
      const transitionOutboxId = (database.db.prepare("SELECT outbox_id FROM order_activity WHERE id=?").get(orderHistory[0].id) as any).outbox_id;
      database.markOutboxError(transitionOutboxId, "Temporary network failure");
      assert.equal((database.orderActivity("GIFT", customOrder.id) as any[])[0].sync_state, "ERROR");
      database.markOutboxSynced(transitionOutboxId);
      assert.equal((database.orderActivity("GIFT", customOrder.id) as any[])[0].sync_state, "SYNCED");
      const workerHistory = database.workerActivity({ operatorId: "test-manager" });
      assert.equal(workerHistory.sales[0].sale_count, 1);
      assert.equal(workerHistory.refunds[0].refund_count, 1);
      assert.equal(workerHistory.orders[0].action_count, 2);
      assert.equal((workerHistory.orderEntries[0] as any).reference, customOrder.order_number);
      const backupPath = await database.createBackup(root);
      assert.equal(existsSync(path.join(backupPath, "shea-pos.sqlite")), true);
      assert.equal(existsSync(path.join(backupPath, "assets", "products", "serum.webp")), true);
      const autoClosedSession = database.closeCashSession({ note: "SYSTEM_AUTO_CLOSE_NO_PHYSICAL_COUNT" }) as any;
      assert.equal(autoClosedSession.status, "CLOSED");
      assert.equal(autoClosedSession.counted_cash, null, "automatic close must not pretend a physical cash count was taken");
      assert.equal(autoClosedSession.difference, null, "automatic close must not report an unverified cash variance");
      assert.equal(database.getCashSession(), null, "automatic close leaves the next caisse closed");
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
