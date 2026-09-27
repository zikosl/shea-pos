# Release checklist

1. Deploy backend migrations before deploying the backend and admin.
2. Deploy the local-gateway and cloud-gateway refund migrations before distributing the matching POS build.
3. Confirm `/health`, partner sign-in, POS bootstrap, one cash sale, one standalone refund, one multi-POS refund, and one synchronization cycle.
4. Set the intended release versions and regenerate affected lockfiles.
5. Configure `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` as GitHub repository secrets.
6. Run both Windows workflows for candidate builds.
7. Test tracked and unlimited stock, printing, suspended carts, backup/restore, offline sale, reconnect synchronization, and refund idempotency.
8. Test partial and full refunds in standalone and multi-POS modes; confirm terminal, local gateway, and cloud totals agree.
9. Revoke the test device server-side and confirm it cannot synchronize or renew its offline lease.
10. Publish signed installers, updater metadata, blockmaps, and `SHA256SUMS.txt` files.
11. Tag approved commits with versions matching their package manifests.

Never distribute an unsigned installer. Keep the same code-signing identity for every release.

## Release boundaries

- Checkout accepts cash only. Other payment methods remain intentionally unavailable.
- Multi-POS sales, stock operations, and refunds use the local gateway as the LAN authority and synchronize to the cloud gateway through idempotent events.
- A POS version containing gateway refunds must not be deployed before both gateway refund migrations.
