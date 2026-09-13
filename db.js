/**
 * GLOBAL Organisation database layer
 * - Prefers Postgres (DATABASE_URL) when set — this is the only mode that
 *   actually survives redeploys and restarts on Render's free tier, since
 *   Render's free web services have an ephemeral local filesystem.
 * - Falls back to SQLite (better-sqlite3) for local development.
 * - Falls back to atomic JSON file storage as a last resort.
 *
 * IMPORTANT: SQLite and JSON modes store data on local disk, which is wiped
 * on every redeploy/restart/spin-down on Render's free plan. They are fine
 * for local testing, but Postgres (via DATABASE_URL) is required for real
 * user data to survive in production.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const JSON_PATH = path.join(DATA_DIR, "global-db.json");
const SQLITE_PATH = path.join(DATA_DIR, "global.sqlite");

try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.warn("Could not create data dir:", e.message);
}

// Migrate old root-level JSON if present
const OLD_JSON = path.join(__dirname, "global-db.json");
if (fs.existsSync(OLD_JSON) && !fs.existsSync(JSON_PATH)) {
  try { fs.renameSync(OLD_JSON, JSON_PATH); } catch (e) { /* ignore */ }
}

let mode = "json"; // "postgres" | "sqlite" | "json"
let sqliteDb = null;
let pgPool = null;

const TABLES = [
  "opportunities", "ideas", "problems", "projects", "messages",
  "notifications", "teams", "posts", "innovationItems", "mentorships"
];

// ---------- try Postgres first (DATABASE_URL) ----------
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require("pg");
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    mode = "postgres";
    console.log("Database: Postgres (persists across deploys)");
  } catch (e) {
    console.warn("Postgres requested (DATABASE_URL set) but 'pg' failed to load:", e.message);
  }
}

// ---------- otherwise try SQLite (local dev only — not persistent on Render free tier) ----------
if (mode !== "postgres") {
  try {
    const Database = require("better-sqlite3");
    sqliteDb = new Database(SQLITE_PATH);
    sqliteDb.pragma("journal_mode = WAL");
    sqliteDb.pragma("foreign_keys = ON");
    initSqliteSchema(sqliteDb);
    mode = "sqlite";
    console.log("Database: SQLite (data/global.sqlite) — NOT persistent on Render's free tier. Set DATABASE_URL for real production use.");
  } catch (e) {
    mode = "json";
    console.log("Database: atomic JSON (data/global-db.json) — NOT persistent on Render's free tier. Set DATABASE_URL for real production use.");
  }
}

let pgReady = null;
function ensurePostgresSchema() {
  if (pgReady) return pgReady;
  pgReady = (async () => {
    const client = await pgPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS users (userId TEXT PRIMARY KEY, data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS aiChats (userId TEXT PRIMARY KEY, data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS savedResearch (id TEXT PRIMARY KEY, data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS reports (
          id TEXT PRIMARY KEY,
          targetType TEXT,
          targetId TEXT,
          reporterId TEXT,
          reason TEXT,
          status TEXT DEFAULT 'open',
          createdAt TEXT,
          resolvedAt TEXT,
          resolvedBy TEXT,
          notes TEXT,
          data JSONB
        );
      `);
      for (const t of TABLES) {
        await client.query(
          `CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, data JSONB NOT NULL, createdAt TEXT)`
        );
      }
    } finally {
      client.release();
    }
  })();
  return pgReady;
}

function initSqliteSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS users (userId TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS opportunities (id TEXT PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT);
    CREATE TABLE IF NOT EXISTS ideas (id TEXT PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT);
    CREATE TABLE IF NOT EXISTS problems (id TEXT PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT);
    CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT);
    CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT);
    CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT);
    CREATE TABLE IF NOT EXISTS innovationItems (id TEXT PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT);
    CREATE TABLE IF NOT EXISTS mentorships (id TEXT PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT);
    CREATE TABLE IF NOT EXISTS savedResearch (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS aiChats (userId TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      targetType TEXT NOT NULL,
      targetId TEXT NOT NULL,
      reporterId TEXT,
      reason TEXT,
      status TEXT DEFAULT 'open',
      createdAt TEXT,
      resolvedAt TEXT,
      resolvedBy TEXT,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
    CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(targetType, targetId);
  `);
}

function emptyDb() {
  return {
    users: [],
    opportunities: [],
    ideas: [],
    problems: [],
    projects: [],
    messages: [],
    notifications: [],
    teams: [],
    savedResearch: [],
    posts: [],
    innovationItems: [],
    mentorships: [],
    aiChats: {},
    reports: []
  };
}

// ---------- JSON helpers (atomic write) ----------
function loadJson() {
  try {
    if (fs.existsSync(JSON_PATH)) {
      const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
      const base = emptyDb();
      Object.keys(base).forEach(k => {
        if (data[k] !== undefined) base[k] = data[k];
      });
      if (!Array.isArray(base.reports)) base.reports = [];
      return base;
    }
  } catch (err) {
    console.error("JSON load error:", err.message);
  }
  return emptyDb();
}

function saveJson(db) {
  try {
    const tmp = JSON_PATH + ".tmp." + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, JSON_PATH); // atomic on same filesystem
    return true;
  } catch (err) {
    console.error("JSON save error:", err.message);
    return false;
  }
}

// ---------- SQLite load/save (whole-document style for compatibility) ----------
function loadSqlite() {
  const db = emptyDb();
  for (const table of TABLES) {
    try {
      const rows = sqliteDb.prepare(`SELECT data FROM ${table}`).all();
      db[table] = rows.map(r => JSON.parse(r.data));
    } catch (e) { /* empty */ }
  }
  try {
    const rows = sqliteDb.prepare("SELECT data FROM users").all();
    db.users = rows.map(r => JSON.parse(r.data));
  } catch (e) {}
  try {
    const rows = sqliteDb.prepare("SELECT userId, data FROM aiChats").all();
    db.aiChats = {};
    rows.forEach(r => { db.aiChats[r.userId] = JSON.parse(r.data); });
  } catch (e) {}
  try {
    const rows = sqliteDb.prepare("SELECT data FROM savedResearch").all();
    db.savedResearch = rows.map(r => JSON.parse(r.data));
  } catch (e) {}
  try {
    db.reports = sqliteDb.prepare("SELECT * FROM reports").all().map(r => ({
      id: r.id, targetType: r.targetType, targetId: r.targetId,
      reporterId: r.reporterId, reason: r.reason, status: r.status,
      createdAt: r.createdAt, resolvedAt: r.resolvedAt, resolvedBy: r.resolvedBy, notes: r.notes
    }));
  } catch (e) { db.reports = []; }
  return db;
}

function saveSqlite(db) {
  const tx = sqliteDb.transaction(() => {
    sqliteDb.prepare("DELETE FROM users").run();
    const insUser = sqliteDb.prepare("INSERT INTO users (userId, data) VALUES (?, ?)");
    (db.users || []).forEach(u => insUser.run(u.userId, JSON.stringify(u)));

    TABLES.forEach(t => {
      sqliteDb.prepare(`DELETE FROM ${t}`).run();
      const ins = sqliteDb.prepare(`INSERT INTO ${t} (id, data, createdAt) VALUES (?, ?, ?)`);
      (db[t] || []).forEach(item => {
        ins.run(item.id, JSON.stringify(item), item.createdAt || new Date().toISOString());
      });
    });

    sqliteDb.prepare("DELETE FROM savedResearch").run();
    (db.savedResearch || []).forEach((item, i) => {
      sqliteDb.prepare("INSERT INTO savedResearch (id, data) VALUES (?, ?)").run(item.id || ("sr-" + i), JSON.stringify(item));
    });

    sqliteDb.prepare("DELETE FROM aiChats").run();
    const insChat = sqliteDb.prepare("INSERT INTO aiChats (userId, data) VALUES (?, ?)");
    Object.entries(db.aiChats || {}).forEach(([uid, hist]) => insChat.run(uid, JSON.stringify(hist)));

    sqliteDb.prepare("DELETE FROM reports").run();
    const insR = sqliteDb.prepare(`INSERT INTO reports (id, targetType, targetId, reporterId, reason, status, createdAt, resolvedAt, resolvedBy, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    (db.reports || []).forEach(r => {
      insR.run(
        r.id, r.targetType, r.targetId, r.reporterId || null, r.reason || "",
        r.status || "open", r.createdAt || new Date().toISOString(),
        r.resolvedAt || null, r.resolvedBy || null, r.notes || null
      );
    });
  });
  try {
    tx();
    return true;
  } catch (err) {
    console.error("SQLite save error:", err.message);
    return false;
  }
}

// ---------- Postgres load/save (whole-document style, same shape as SQLite) ----------
async function loadPostgres() {
  await ensurePostgresSchema();
  const db = emptyDb();
  const client = await pgPool.connect();
  try {
    for (const t of TABLES) {
      const { rows } = await client.query(`SELECT data FROM ${t}`);
      db[t] = rows.map(r => r.data);
    }
    const usersRes = await client.query("SELECT data FROM users");
    db.users = usersRes.rows.map(r => r.data);

    const chatsRes = await client.query("SELECT userId, data FROM aiChats");
    db.aiChats = {};
    chatsRes.rows.forEach(r => { db.aiChats[r.userid] = r.data; });

    const savedRes = await client.query("SELECT data FROM savedResearch");
    db.savedResearch = savedRes.rows.map(r => r.data);

    const reportsRes = await client.query("SELECT * FROM reports");
    db.reports = reportsRes.rows.map(r => ({
      id: r.id, targetType: r.targettype, targetId: r.targetid,
      reporterId: r.reporterid, reason: r.reason, status: r.status,
      createdAt: r.createdat, resolvedAt: r.resolvedat, resolvedBy: r.resolvedby, notes: r.notes
    }));
  } finally {
    client.release();
  }
  return db;
}

async function savePostgres(db) {
  await ensurePostgresSchema();
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");

    await client.query("DELETE FROM users");
    for (const u of db.users || []) {
      await client.query("INSERT INTO users (userId, data) VALUES ($1, $2)", [u.userId, JSON.stringify(u)]);
    }

    for (const t of TABLES) {
      await client.query(`DELETE FROM ${t}`);
      for (const item of db[t] || []) {
        await client.query(
          `INSERT INTO ${t} (id, data, createdAt) VALUES ($1, $2, $3)`,
          [item.id, JSON.stringify(item), item.createdAt || new Date().toISOString()]
        );
      }
    }

    await client.query("DELETE FROM savedResearch");
    let i = 0;
    for (const item of db.savedResearch || []) {
      await client.query("INSERT INTO savedResearch (id, data) VALUES ($1, $2)", [item.id || ("sr-" + i++), JSON.stringify(item)]);
    }

    await client.query("DELETE FROM aiChats");
    for (const [uid, hist] of Object.entries(db.aiChats || {})) {
      await client.query("INSERT INTO aiChats (userId, data) VALUES ($1, $2)", [uid, JSON.stringify(hist)]);
    }

    await client.query("DELETE FROM reports");
    for (const r of db.reports || []) {
      await client.query(
        `INSERT INTO reports (id, targetType, targetId, reporterId, reason, status, createdAt, resolvedAt, resolvedBy, notes, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [r.id, r.targetType, r.targetId, r.reporterId || null, r.reason || "",
         r.status || "open", r.createdAt || new Date().toISOString(),
         r.resolvedAt || null, r.resolvedBy || null, r.notes || null, JSON.stringify(r)]
      );
    }

    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Postgres save error:", err.message);
    return false;
  } finally {
    client.release();
  }
}

// ---------- public API ----------
async function loadDB() {
  if (mode === "postgres") {
    try {
      return await loadPostgres();
    } catch (err) {
      console.error("Postgres load failed, falling back to JSON for this request:", err.message);
      return loadJson();
    }
  }
  if (mode === "sqlite") return loadSqlite();
  return loadJson();
}

async function saveDB(db) {
  if (mode === "postgres") {
    try {
      return await savePostgres(db);
    } catch (err) {
      console.error("Postgres save failed:", err.message);
      return false;
    }
  }
  if (mode === "sqlite") return saveSqlite(db);
  return saveJson(db);
}

function getMode() {
  return mode;
}

function createId(prefix) {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

module.exports = { loadDB, saveDB, getMode, createId, DATA_DIR, JSON_PATH, SQLITE_PATH };
