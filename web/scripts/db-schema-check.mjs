import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const schemaDir = path.join(root, "cloudflare");
const migrationsDir = path.join(schemaDir, "migrations");
const scanDirs = [
  path.join(root, "app"),
  path.join(root, "lib"),
  path.join(root, "..", "worker", "src"),
];

const IGNORE_TABLES = new Set([
  "sqlite_master",
  "pragma",
  "values",
  "d1",
  "set",
]);

function listFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

function readSqlFiles() {
  const files = [
    path.join(schemaDir, "d1-schema.sql"),
    ...listFiles(migrationsDir).filter((f) => f.endsWith(".sql")),
  ];
  return files.map((file) => ({ file, text: fs.readFileSync(file, "utf8") }));
}

function extractCreatedTables(sqlText) {
  const created = new Set();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let m;
  while ((m = re.exec(sqlText)) !== null) created.add(m[1].toLowerCase());
  return created;
}

function extractReferencedTables(sqlText) {
  const refs = new Set();
  const re = /\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let m;
  while ((m = re.exec(sqlText)) !== null) refs.add(m[1].toLowerCase());
  return refs;
}

function extractPrepareSqlBlocks(text) {
  const blocks = [];
  const tpl = /prepare\(\s*`([\s\S]*?)`\s*\)/g;
  const dbl = /prepare\(\s*"([\s\S]*?)"\s*\)/g;
  const sgl = /prepare\(\s*'([\s\S]*?)'\s*\)/g;
  let m;
  while ((m = tpl.exec(text)) !== null) blocks.push(m[1]);
  while ((m = dbl.exec(text)) !== null) blocks.push(m[1]);
  while ((m = sgl.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

const sqlFiles = readSqlFiles();
const createdTables = new Set();
for (const { text } of sqlFiles) {
  for (const t of extractCreatedTables(text)) createdTables.add(t);
}

const sourceFiles = scanDirs.flatMap((d) => listFiles(d).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")));
const referenced = new Set();
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf8");
  const sqlBlocks = extractPrepareSqlBlocks(text);
  for (const sql of sqlBlocks) {
    for (const t of extractReferencedTables(sql)) {
      if (!IGNORE_TABLES.has(t)) referenced.add(t);
    }
  }
}

const missing = [...referenced].filter((t) => !createdTables.has(t)).sort();

console.log(`Created tables: ${createdTables.size}`);
console.log(`Referenced tables: ${referenced.size}`);
if (missing.length === 0) {
  console.log("PASS: all referenced tables exist in schema/migrations.");
  process.exit(0);
}

console.log("FAIL: referenced tables missing from schema/migrations:");
for (const t of missing) console.log(` - ${t}`);
process.exit(1);
