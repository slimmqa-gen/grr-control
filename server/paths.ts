/**
 * Единая точка настройки путей к постоянным данным.
 *
 * Локально (без переменных окружения) всё работает как раньше:
 * data.db и папка pbk_files лежат в корне проекта.
 *
 * На сервере Render задаётся переменная DATA_DIR=/var/data — это точка
 * монтирования постоянного диска. Тогда база и загруженные файлы пишутся
 * туда и не теряются при каждом обновлении кода.
 */
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || process.cwd());

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** Путь к файлу базы SQLite. */
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "data.db");

/** Папка с загруженными файлами сводок ПБК. */
export const FILES_DIR = process.env.PBK_DIR || path.join(DATA_DIR, "pbk_files");

if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}
