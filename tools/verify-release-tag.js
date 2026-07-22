'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const tag = process.argv[2];

function fail(message) {
  console.error(`Release validation failed: ${message}`);
  process.exit(1);
}

if (!tag) {
  fail('A Git tag argument is required.');
}
if (!/^2\.4\.0(?:-beta\.[1-9][0-9]*)?$/.test(packageJson.version)) {
  fail(`Unsupported release version ${packageJson.version}. Expected 2.4.0 or 2.4.0-beta.N.`);
}
if (tag !== `v${packageJson.version}`) {
  fail(`Tag ${tag} does not match package version ${packageJson.version}.`);
}
if (packageLock.version !== packageJson.version || packageLock.packages[''].version !== packageJson.version) {
  fail('package.json and package-lock.json versions differ.');
}
if (packageJson.repository !== 'https://github.com/omnizs38/mechvibes') {
  fail('Repository metadata must target omnizs38/mechvibes.');
}
if (!packageJson.build || !Array.isArray(packageJson.build.publish)) {
  fail('electron-builder publish configuration is missing.');
}

console.log(`Release tag ${tag} is valid for Mechvibes ${packageJson.version}.`);
