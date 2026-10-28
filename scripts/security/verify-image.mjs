// Run inside the built image with --network none. Never emit manifest keys or action IDs.
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

class VerificationError extends Error {}
function check(condition, message) {
  if (!condition) throw new VerificationError(message);
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    // JSON.parse errors can include source fragments containing build keys.
    throw new VerificationError("Unreadable JSON; image verification cannot continue");
  }
}

async function verify() {
  const root = process.cwd();
  const web = createRequire(path.join(root, "apps/web/package.json"));
  const lib = createRequire(path.join(root, "packages/lib/package.json"));
  const source = await readJson(path.join(root, "apps/web/package.json"));
  const nextVersion = web("next/package.json").version;
  const nextAuthVersion = web("next-auth/package.json").version;
  check(nextAuthVersion === "4.24.15", "NextAuth runtime differs from the reviewed security baseline");
  check(process.arch === "x64", "Railway candidate must contain amd64 native dependencies");
  check(nextVersion === source.dependencies.next && nextVersion === "16.4.1", "Web Next resolution differs from the reviewed security baseline");
  check(process.versions.node === "22.23.4", "Node runtime differs from the reviewed security baseline");

  for (const require of [web, lib, createRequire(web.resolve("next/package.json"))]) {
    const sharp = require("sharp");
    check(sharp.versions.sharp === "0.35.5" && sharp.versions.rsvg === "2.63.2", "Sharp or librsvg runtime differs from the reviewed security baseline");
    const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>')).png().toBuffer();
    const metadata = await sharp(png).metadata();
    check(metadata.format === "png" && metadata.width === 8 && metadata.height === 8, "Native SVG conversion failed");
  }

  let manifests = 0;
  const references = new Set();
  const actionExports = new Set();
  const packageCopies = [];
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await inspect(file);
      else if (entry.name === "package.json" && file.includes(`${path.sep}node_modules${path.sep}`) && ["next", "sharp", "next-auth"].includes(path.basename(directory))) {
        const metadata = await readJson(file);
        if (!["next", "sharp", "next-auth"].includes(metadata.name)) continue;
        const expected = { next: "16.4.1", sharp: "0.35.5", "next-auth": "4.24.15" }[metadata.name];
        check(metadata.version === expected, "An installed Next, NextAuth or Sharp copy is outside the reviewed security baseline");
        packageCopies.push({ path: path.relative(root, directory), name: metadata.name, version: metadata.version });
      } else if (entry.name === "server-reference-manifest.json") {
        manifests++;
        const manifest = await readJson(file);
        check(isRecord(manifest), "Invalid action manifest schema");
        for (const runtime of ["node", "edge"]) {
          const entries = manifest[runtime] === undefined ? {} : manifest[runtime];
          check(isRecord(entries), "Invalid action runtime schema");
          for (const [id, action] of Object.entries(entries)) {
            check(isRecord(action) && isRecord(action.workers), "Invalid action or worker schema");
            references.add(`${runtime}:${id}`);
            const labels = new Set();
            for (const candidate of [action, ...Object.values(action.workers)]) {
              check(isRecord(candidate), "Invalid action worker entry");
              if (candidate.filename === undefined && candidate.exportedName === undefined) continue;
              check(typeof candidate.filename === "string" && candidate.filename.length > 0 && typeof candidate.exportedName === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(candidate.exportedName), "Incomplete action metadata; review the manifest schema");
              check(!["getTravelSchedule", "getCachedHasTeamPlan"].includes(candidate.exportedName), "Private data getter remains a public action");
              labels.add(`${candidate.filename}:${candidate.exportedName}`);
              actionExports.add(candidate.exportedName);
            }
            check(labels.size === 1, "Unmapped or inconsistent action metadata");
          }
        }
      }
    }
  }
  // Include nested example dependencies and standalone copies, not only web resolution.
  await inspect(root);
  check(manifests > 0 && references.size > 0, "Missing action manifests cannot prove getter removal");
  check(packageCopies.some(copy => copy.name === "next") && packageCopies.some(copy => copy.name === "sharp"), "Missing dependency inventory");
  console.log(JSON.stringify({ passed: true, node: process.versions.node, next: nextVersion, nextAuth: nextAuthVersion, architecture: process.arch, sharp: "0.35.5", librsvg: "2.63.2", manifests, uniqueActionReferences: references.size, publicActionExports: [...actionExports].sort(), packageCopies }));
}

try {
  await verify();
} catch (error) {
  console.error(error instanceof VerificationError ? error.message : "Image verification failed without exposing raw runtime or manifest data");
  process.exitCode = 1;
}
