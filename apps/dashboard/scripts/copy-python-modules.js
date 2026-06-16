#!/usr/bin/env node
/**
 * Copy repo-root Python packages into apps/dashboard/.python_modules so the
 * Vercel deployment can find them even when the dashboard app is deployed
 * standalone (Root Directory = apps/dashboard).
 */
const fs = require("node:fs");
const path = require("node:path");

const DASHBOARD_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(DASHBOARD_DIR, "..", "..");
const DEST_DIR = path.join(DASHBOARD_DIR, ".python_modules");

const MODULES = ["services", "workflows"];

function shouldCopy(name) {
  // Skip Python caches and compiled artifacts to keep the bundle small.
  return name !== "__pycache__" && !name.endsWith(".pyc") && !name.endsWith(".pyo");
}

function copyRecursive(src, dest) {
  if (!shouldCopy(path.basename(src))) return;

  const stat = fs.statSync(src, { throwIfNoEntry: false });
  if (!stat) return;

  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function main() {
  let copied = 0;
  for (const mod of MODULES) {
    const src = path.join(REPO_ROOT, mod);
    const dest = path.join(DEST_DIR, mod);
    if (!fs.existsSync(src)) {
      console.warn(`Source module not found, skipping: ${src}`);
      continue;
    }
    console.log(`Copying ${mod} -> ${dest}`);
    copyRecursive(src, dest);
    copied++;
  }
  console.log(`Copied ${copied} Python module trees to ${DEST_DIR}`);
}

main();
