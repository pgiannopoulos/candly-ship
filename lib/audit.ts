import { db } from "./db";

export async function audit(action: string, detail?: string, orderId?: string) {
  try {
    await db.auditLog.create({ data: { action, detail: detail?.slice(0, 2000), orderId } });
  } catch (e) {
    console.error("audit failed", e);
  }
}
