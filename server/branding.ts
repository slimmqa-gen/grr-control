import ExcelJS from "exceljs";
import { storage } from "./storage";
import type { Branding } from "@shared/schema";

/** Брендирование: название организации, реквизиты, логотип и подпись отчётов. */
export function brandingInfo(): Branding {
  return {
    orgName: storage.getSetting("orgName", "ГРР-Контроль"),
    orgShort: storage.getSetting("orgShort", ""),
    orgInn: storage.getSetting("orgInn", ""),
    orgDetails: storage.getSetting("orgDetails", ""),
    logo: storage.getSetting("orgLogo", ""),
    signerName: storage.getSetting("reportSignerName", ""),
    signerPosition: storage.getSetting("reportSignerPosition", ""),
  };
}

export function saveBranding(v: Branding) {
  storage.setSetting("orgName", v.orgName);
  storage.setSetting("orgShort", v.orgShort ?? "");
  storage.setSetting("orgInn", v.orgInn ?? "");
  storage.setSetting("orgDetails", v.orgDetails ?? "");
  storage.setSetting("reportSignerName", v.signerName ?? "");
  storage.setSetting("reportSignerPosition", v.signerPosition ?? "");
  if (typeof v.logo === "string") storage.setSetting("orgLogo", v.logo);
  return brandingInfo();
}

const ruDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Строка шапки листа Excel: организация, реквизиты, дата формирования */
export function brandHeaderLine(b = brandingInfo()): string {
  const parts = [b.orgName];
  if (b.orgInn) parts.push(`ИНН ${b.orgInn}`);
  if (b.orgDetails) parts.push(b.orgDetails.replace(/\s*\n+\s*/g, " · "));
  parts.push(`сформировано ${ruDate(new Date().toISOString().slice(0, 10))}`);
  return parts.join(" · ");
}

export function signatureLine(b = brandingInfo()): string {
  if (!b.signerName && !b.signerPosition) return "";
  const who = [b.signerName, b.signerPosition].filter(Boolean).join(", ");
  return `Подготовил: ${who}`;
}

function logoImage(wb: ExcelJS.Workbook, b: Branding): number | null {
  if (!b.logo || !b.logo.startsWith("data:image/")) return null;
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(b.logo);
  if (!m) return null;
  try {
    return wb.addImage({
      base64: m[2],
      extension: (m[1].toLowerCase() === "jpg" ? "jpeg" : m[1].toLowerCase()) as "png" | "jpeg",
    });
  } catch {
    return null;
  }
}

/**
 * Добавляет в каждый лист книги шапку с названием организации (и логотипом, если загружен)
 * и подпись «Подготовил / должность» внизу. Вызывается после того, как листы полностью собраны.
 */
export function brandWorkbook(wb: ExcelJS.Workbook) {
  const b = brandingInfo();
  const head = brandHeaderLine(b);
  const sign = signatureLine(b);
  const imgId = logoImage(wb, b);

  wb.worksheets.forEach((ws) => {
    const af: any = ws.autoFilter;
    const hadFilter = af && typeof af === "object" && af.from?.row === 1;
    const cols = Math.max(1, ws.columnCount);

    ws.spliceRows(1, 0, [head], []);
    const r = ws.getRow(1);
    r.font = { bold: true, size: 12, color: { argb: "FF1E3A5F" } };
    r.height = imgId === null ? 20 : 34;
    r.alignment = { vertical: "middle" };
    if (imgId !== null) {
      ws.getCell(1, 1).value = `      ${head}`;
      ws.addImage(imgId, { tl: { col: 0.1, row: 0.1 }, ext: { width: 30, height: 30 } } as any);
    }
    if (hadFilter) {
      ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cols } };
      ws.views = [{ state: "frozen", ySplit: 3 }];
    }
    if (sign) {
      ws.addRow([]);
      ws.addRow([sign]).font = { italic: true, color: { argb: "FF6B7280" } };
    }
  });
}
