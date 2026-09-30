import type { LocalData } from "../localData";

export function createBackup(data: LocalData, date = new Date()): string {
  return JSON.stringify({ format: "debtpilot-backup", version: 1, exportedAt: date.toISOString(), profile: data.profile, checkIns: data.checkIns }, null, 2);
}

export function downloadJson(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
