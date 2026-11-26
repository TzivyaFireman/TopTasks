// export-sqlite.js: ייצוא חד-פעמי של הנתונים מקובץ crm.db הישן (SQLite) לקובץ גיבוי JSON,
// שאפשר לשחזר ל-MongoDB דרך "הגדרות ← גיבוי ושחזור".
//
// שימוש:  node --disable-warning=ExperimentalWarning export-sqlite.js [נתיב-ל-crm.db] [קובץ-פלט]
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const input = process.argv[2] || 'crm.db';
const output = process.argv[3] || 'sqlite-export.json';

if (!fs.existsSync(input)) {
  console.error(`הקובץ ${input} לא נמצא. הריצי את הסקריפט מתיקיית הפרויקט, או ציני נתיב לקובץ.`);
  process.exit(1);
}

const db = new DatabaseSync(input, { readOnly: true });
const rows = (table, orderBy) => db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();

// אוספים עם מזהה: id הופך ל-_id. אוסף company_modules בלי מזהה
const keyed = (table) => rows(table, 'id').map(({ id, ...rest }) => ({ _id: id, ...rest }));

const collections = {
  team_members: keyed('team_members'),
  modules: keyed('modules'),
  companies: keyed('companies'),
  contacts: keyed('contacts'),
  company_modules: rows('company_modules', 'company_id, module_id'),
  key_points: keyed('key_points'),
  notes: keyed('notes'),
  tasks: keyed('tasks'),
  hour_packages: keyed('hour_packages'),
  hour_logs: keyed('hour_logs'),
};

fs.writeFileSync(output, JSON.stringify({ version: 1, exported_at: new Date().toISOString(), collections }), 'utf8');
console.log(`נכתב הקובץ ${output}`);
for (const [name, list] of Object.entries(collections)) console.log(`  ${name}: ${list.length}`);
console.log('עכשיו: במערכת, הגדרות ← גיבוי ושחזור ← שחזור מקובץ, ובוחרים את הקובץ הזה.');
