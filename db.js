// db.js: חיבור ל-MongoDB (למשל Atlas) ומונה מזהים רצים.
// המזהים נשארים מספרים שלמים (1, 2, 3...) כמו קודם, כדי שהכתובות והממשק לא ישתנו.
import { MongoClient } from 'mongodb';

let client = null;
let database = null;

export async function connectDb(uri, dbName) {
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  database = client.db(dbName);
  await ensureIndexes();
}

export async function closeDb() {
  if (client) await client.close();
  client = null;
}

export const col = (name) => database.collection(name);

// מזהה הבא באוסף מסוים. הפעולה אטומית ולכן אין כפילויות, ומזהה שנמחק לא חוזר
export async function nextId(name) {
  const r = await col('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return (r?.value ?? r).seq;
}

async function ensureIndexes() {
  await Promise.all([
    col('team_members').createIndex({ name: 1 }, { unique: true }),
    col('modules').createIndex({ name: 1 }, { unique: true }),
    col('company_modules').createIndex({ company_id: 1, module_id: 1 }, { unique: true }),
    col('tasks').createIndex({ due_at: 1 }),
    ...['contacts', 'key_points', 'notes', 'tasks', 'hour_packages', 'hour_logs'].map((c) =>
      col(c).createIndex({ company_id: 1 })
    ),
  ]);
}
