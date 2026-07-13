// Collection backup: export/import JSON via share sheet (iOS eviction insurance).

import { getAll, put } from "./db.js";
import { toast } from "./ui/toast.js";

const LS_LAST_EXPORT = "lt-last-export";

export async function exportBackup() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    traderName: localStorage.getItem("lt-trader-name") || null,
    holdings: await getAll("holdings"),
    snapshots: await getAll("snapshots"),
  };
  const name = `ledger-terminal-backup-${payload.exportedAt.slice(0, 10).replaceAll("-", "")}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Ledger Terminal backup" });
    } catch (e) {
      if (e.name === "AbortError") return false;
      downloadBlob(blob, name);
    }
  } else {
    downloadBlob(blob, name);
  }
  localStorage.setItem(LS_LAST_EXPORT, Date.now().toString());
  return true;
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.version !== 1 || !Array.isArray(data.holdings)) throw new Error("Not a Ledger Terminal backup");
  let n = 0;
  for (const h of data.holdings) { await put("holdings", h); n++; }
  for (const s of data.snapshots || []) await put("snapshots", s);
  if (data.traderName && !localStorage.getItem("lt-trader-name"))
    localStorage.setItem("lt-trader-name", data.traderName);
  toast(`✅ RESTORED ${n} HOLDINGS FROM BACKUP`);
  return n;
}

// Nag only when there's real un-backed-up history: last export > 30 days ago,
// or never exported and the collection is > 3 days old.
export function backupOverdue(oldestHoldingAt = null) {
  const last = Number(localStorage.getItem(LS_LAST_EXPORT) || 0);
  if (last) return Date.now() - last > 30 * 86400000;
  return oldestHoldingAt != null && Date.now() - oldestHoldingAt > 3 * 86400000;
}
