import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { PosDatabase } from "./database";
import { previewPriceLabel, previewReceipt } from "./printer";

app
  .whenReady()
  .then(() => {
    const root = mkdtempSync(path.join(os.tmpdir(), "shea-pos-test-"));
    const database = new PosDatabase(root);
    try {
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

      const sale = database.checkout({
        paymentMethod: "CASH",
        lines: [
          { productLocalId: "tracked", quantity: 2 },
          { productLocalId: "unlimited", quantity: 3 },
        ],
      }) as any;
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

      const salesBeforeFailure = (
        database.db.prepare("SELECT COUNT(*) count FROM sales").get() as any
      ).count;
      assert.throws(
        () =>
          database.checkout({
            paymentMethod: "CASH",
            lines: [{ productLocalId: "tracked", quantity: 4 }],
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
      assert.equal(database.listMovements({}).length, 1);
      assert.equal((database.getCashSession() as any).expected_cash, 1_350);
      assert.equal(database.countPendingOutbox(), 4);
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
      assert.match(previewReceipt(database, sale.id), /POS-/);
      assert.match(
        previewPriceLabel(database, provisional.local_id),
        /Offline serum/,
      );
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
      console.log("Electron SQLite integration checks passed");
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
      app.quit();
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
