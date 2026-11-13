/**
 * HAKIM CHENAN NUTRITION - Database Migration & Data Integrity Service
 * Performs safe schema migrations, backups, and audits without deleting any existing records.
 */

import {
  collection, getDocs, doc, updateDoc, writeBatch, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from './firebase-config.js';
import { logAdminAction } from './auth-service.js';

/**
 * Migration 1: Product schema upgrade
 * Ensures every product in `produits` has `reseller_price` and `reseller_pricing_enabled` fields.
 */
export async function migrateProductsSchema() {
  console.log("🔄 Starting Product Schema Migration...");
  const snap = await getDocs(collection(db, "produits"));
  let updatedCount = 0;
  const batch = writeBatch(db);
  let batchOps = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const updates = {};
    let needsUpdate = false;

    if (data.reseller_price === undefined) {
      // Default to 85% of regular price or 0
      const regPrice = parseFloat(data.price) || 0;
      updates.reseller_price = regPrice > 0 ? Math.round(regPrice * 0.85) : 0;
      needsUpdate = true;
    }

    if (data.reseller_pricing_enabled === undefined) {
      updates.reseller_pricing_enabled = false;
      needsUpdate = true;
    }

    if (needsUpdate) {
      batch.update(doc(db, "produits", docSnap.id), updates);
      batchOps++;
      updatedCount++;

      // Firestore batches have a limit of 500 ops
      if (batchOps >= 450) {
        await batch.commit();
        batchOps = 0;
      }
    }
  }

  if (batchOps > 0) {
    await batch.commit();
  }

  await logAdminAction("MIGRATION_PRODUCTS_SCHEMA", "database", "produits", {
    totalChecked: snap.size,
    updatedCount
  });

  console.log(`✅ Product migration completed. ${updatedCount} products updated.`);
  return { totalChecked: snap.size, updatedCount };
}

/**
 * Full database backup to JSON file for download
 */
export async function backupDatabase() {
  console.log("💾 Generating full database backup...");

  const backupData = {
    exportDate: new Date().toISOString(),
    store: "HAKIM CHENAN NUTRITION",
    collections: {}
  };

  const collectionsToExport = ["produits", "commandes", "clients", "demandes_revendeurs", "audit_logs"];

  for (const colName of collectionsToExport) {
    try {
      const snap = await getDocs(collection(db, colName));
      backupData.collections[colName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn(`Could not export collection ${colName}:`, err);
      backupData.collections[colName] = [];
    }
  }

  const jsonStr = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hcn_database_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  await logAdminAction("DATABASE_BACKUP_DOWNLOADED", "system", "all", {
    collections: Object.keys(backupData.collections)
  });

  return backupData;
}

export default {
  migrateProductsSchema,
  backupDatabase
};
