import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const scanDirs = [
  "auth-service/src",
  "perfile-service/src",
  "trabajo-service/src",
  "pago-service/src",
  "notificacion-service/src",
  "scratch"
];

const queryTemplateStartPattern = /\b(pool|client|db)\.query\s*\(\s*`|\bquery\s*(\+=|=)\s*`|\b(const|let)\s+\w*query\w*\s*=\s*`/i;

const allowedInterpolation = (line, matchIndex, expression) => {
  const expr = expression.trim();
  const previousChar = line[matchIndex - 1];

  if (previousChar === "$" && /^(counter|idx|i)$/.test(expr)) return true;
  if (/^safeSqlIdentifier\(/.test(expr)) return true;
  if (expr === 'clauses.join(" OR ")') return true;

  return false;
};

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "uploads") continue;
      files.push(...await walk(fullPath));
    } else if (/\.(js|mjs|ts)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
};

const findings = [];

const countBackticks = (line) => {
  let count = 0;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === "`" && line[index - 1] !== "\\") count++;
  }
  return count;
};

for (const relativeDir of scanDirs) {
  const files = await walk(path.join(rootDir, relativeDir));

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const lines = content.split(/\r?\n/);
    let inSqlTemplate = false;

    lines.forEach((line, index) => {
      const startsSqlTemplate = queryTemplateStartPattern.test(line);
      const shouldScanLine = startsSqlTemplate || inSqlTemplate;

      if (shouldScanLine && line.includes("${")) {
        const interpolations = [...line.matchAll(/\$\{([^}]+)\}/g)];
        const unsafe = interpolations.filter((match) => !allowedInterpolation(line, match.index, match[1]));

        if (unsafe.length > 0) {
          findings.push({
            file: path.relative(rootDir, file),
            line: index + 1,
            code: line.trim(),
            expressions: unsafe.map((match) => match[1].trim())
          });
        }
      }

      if (startsSqlTemplate || inSqlTemplate) {
        const backticks = countBackticks(line);
        if (backticks % 2 === 1) inSqlTemplate = !inSqlTemplate;
      }
    });
  }
}

if (findings.length > 0) {
  console.error("Se encontraron interpolaciones SQL potencialmente inseguras:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} -> ${finding.expressions.join(", ")}`);
    console.error(`  ${finding.code}`);
  }
  process.exit(1);
}

console.log("SQL safety check OK: no se detectaron interpolaciones SQL inseguras.");
