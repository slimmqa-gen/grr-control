// Разовая загрузка штатного расписания заказчика в справочник сотрудников.
// Заменяет прежних сотрудников, подтянутых из буровых сводок.
import ExcelJS from "exceljs";
import Database from "better-sqlite3";

const FILE = process.argv[2] ?? "/home/user/workspace/uploaded_attachments/8c10746ef2884a17b68a91cb564ea119/XZ.xlsx";
const DB = process.argv[3] ?? process.env.DB_PATH ?? "data.db";

const clean = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    // склеенные в источнике «должностьОтдел» → «должность Отдел»
    .replace(/([а-яё])([А-ЯЁ])/g, "$1 $2")
    .trim();

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(FILE);
const ws = wb.getWorksheet("Лист1");
const rows = [];
ws.eachRow((r, i) => {
  if (i === 1) return;
  const fio = clean(r.getCell(1).value);
  const pos = clean(r.getCell(2).value) || "Не указана";
  if (fio) rows.push({ fio, pos });
});

const db = new Database(DB);
db.exec("CREATE TABLE IF NOT EXISTS positions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)");

const before = db.prepare("SELECT COUNT(*) c FROM employees").get().c;
const shiftsBefore = db.prepare("SELECT COUNT(*) c FROM shifts").get().c;

const tx = db.transaction(() => {
  db.prepare("DELETE FROM shifts").run();
  db.prepare("DELETE FROM employees").run();
  db.prepare("DELETE FROM positions").run();
  const insEmp = db.prepare(
    "INSERT INTO employees (fio, position, object_id, brigade_id, phone, import_id) VALUES (?, ?, 0, 0, '', 0)",
  );
  const insPos = db.prepare("INSERT INTO positions (name) VALUES (?)");
  const seen = new Set();
  for (const r of rows) {
    insEmp.run(r.fio, r.pos);
    const key = r.pos.toLowerCase();
    if (!seen.has(key)) { seen.add(key); }
  }
  [...new Set(rows.map((r) => r.pos))]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .forEach((p) => insPos.run(p));
});
tx();

console.log(JSON.stringify({
  file: FILE,
  employeesBefore: before,
  shiftsRemoved: shiftsBefore,
  employeesAfter: db.prepare("SELECT COUNT(*) c FROM employees").get().c,
  positions: db.prepare("SELECT COUNT(*) c FROM positions").get().c,
  sample: db.prepare("SELECT fio, position FROM employees LIMIT 3").all(),
}, null, 2));
