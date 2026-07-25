'use strict';

import * as fs from 'fs-extra';
import * as path from 'path';

function emptyDist(distPath: string): void {
  if (fs.existsSync(distPath)) {
    fs.emptyDirSync(distPath);
    console.log('Dist folder emptied successfully.');
  } else {
    console.log('Dist folder does not exist.');
  }
}

// Check if package.json is in the current directory or in the parent directory
const packageJsonPath = path.resolve(process.cwd(), 'package.json');
const parentPackageJsonPath = path.resolve(process.cwd(), '../package.json');

if (fs.existsSync(packageJsonPath)) {
  console.log('package.json found in the current directory.');
  emptyDist(path.resolve(process.cwd(), 'dist'));
} else if (fs.existsSync(parentPackageJsonPath)) {
  console.log('package.json found in the parent directory.');
  emptyDist(path.resolve(process.cwd(), '../dist'));
} else {
  console.log('package.json not found.');
}
