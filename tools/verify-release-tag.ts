import * as fs from 'fs';
import * as path from 'path';

interface PackageJson {
  version: string;
  repository?: string;
  build?: { publish?: unknown };
}

interface PackageLock {
  version: string;
  packages: Record<string, { version?: string }>;
}

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as PackageJson;
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as PackageLock;
const tag = process.argv[2];

function fail(message: string): never {
  console.error(`Release validation failed: ${message}`);
  process.exit(1);
}

if (!tag) {
  fail('A Git tag argument is required.');
}
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-(?:beta|rc)\.[1-9][0-9]*)?$/.test(packageJson.version)) {
  fail(
    `Unsupported release version ${packageJson.version}. Expected MAJOR.MINOR.PATCH optionally suffixed with -beta.N or -rc.N.`
  );
}
if (tag !== `v${packageJson.version}`) {
  fail(`Tag ${tag} does not match package version ${packageJson.version}.`);
}
if (packageLock.version !== packageJson.version || packageLock.packages['']?.version !== packageJson.version) {
  fail('package.json and package-lock.json versions differ.');
}
if (packageJson.repository !== 'https://github.com/omnizs38/mechvibes-cbc') {
  fail('Repository metadata must target omnizs38/mechvibes-cbc.');
}
if (!packageJson.build || !Array.isArray(packageJson.build.publish)) {
  fail('electron-builder publish configuration is missing.');
}

console.log(`Release tag ${tag} is valid for Mechvibes ${packageJson.version}.`);
