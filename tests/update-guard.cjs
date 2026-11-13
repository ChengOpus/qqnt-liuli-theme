// update-guard.cjs against a throwaway QQ-shaped directory. No QQ install needed.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const assert = require("node:assert/strict");
const guard = require("../update-guard.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "liuli-guard-"));
try {
  const versions = path.join(root, "QQNT", "versions");
  const appPath = path.join(versions, "9.9.36-53644", "resources", "app");
  fs.mkdirSync(appPath, { recursive: true });
  fs.mkdirSync(path.join(versions, "9.9.37-54000"), { recursive: true }); // downloaded build
  const config = path.join(versions, "config.json");
  fs.writeFileSync(config, JSON.stringify({ baseVersion: "9.9.36-53644", curVersion: "9.9.37-54000", buildId: "54000", extra: 1 }));
  const app = {
    getAppPath: () => appPath,
    getVersion: () => "9.9.36-53644",
    getPath: (name) => path.join(root, name),
  };
  // 1. pin
  let report = guard.apply(app, true);
  assert.equal(report.version, "9.9.36-53644");
  assert.equal(report.files.length, 1);
  assert.equal(report.files[0].action, "pinned");
  const pinned = JSON.parse(fs.readFileSync(config, "utf8"));
  assert.deepEqual(
    [pinned.baseVersion, pinned.curVersion, pinned.buildId, pinned.extra],
    ["9.9.36-53644", "9.9.36-53644", "53644", 1],
  );
  if (process.platform !== "win32" && process.getuid?.() !== 0)
    assert.throws(() => fs.writeFileSync(config, "{}")); // read-only for QQ
  assert.equal(fs.statSync(config).mode & 0o222, 0);
  // 2. idempotent
  report = guard.apply(app, true);
  assert.equal(report.files[0].action, "kept");
  // 3. release
  report = guard.apply(app, false);
  assert.equal(report.files[0].action, "released");
  assert.notEqual(fs.statSync(config).mode & 0o200, 0);
  // 4. unknown layout: no file found, nothing written
  const bare = { getAppPath: () => path.join(root, "elsewhere"), getVersion: () => "1.0.0", getPath: () => path.join(root, "none") };
  report = guard.apply(bare, true);
  assert.ok(report.error || report.note);
  console.log("update guard: pin, idempotent re-pin, release and unknown layout passed");
} finally {
  for (const f of fs.readdirSync(root, { recursive: true })) {
    try { fs.chmodSync(path.join(root, f), 0o755); } catch {}
  }
  fs.rmSync(root, { recursive: true, force: true });
}
