'use strict';

import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
import { scanSoundpackDirectory, validateAudioFiles } from './soundpack-scanner';
import { generateSoundpackConfig, validateGeneratedConfig } from './soundpack-config-generator';
import type { SoundpackGeneratorOptions } from './soundpack-config-generator';

interface BuildOptions extends SoundpackGeneratorOptions {
  input?: string;
  output?: string;
  verbose?: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): Partial<BuildOptions> {
  const args = process.argv.slice(2);
  const options: Partial<BuildOptions> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      if (key === 'input' || key === 'output') {
        (options[key as keyof BuildOptions] as any) = nextArg;
        i++;
      } else if (key === 'name' || key === 'author' || key === 'license') {
        (options[key as keyof BuildOptions] as any) = nextArg;
        i++;
      } else if (key === 'max-voices' || key === 'cache-budget') {
        options[key === 'max-voices' ? 'maxVoices' : 'cacheBudgetMb'] = parseInt(nextArg, 10);
        i++;
      } else if (key === 'preload') {
        options.preload = nextArg as any;
        i++;
      } else if (key === 'verbose') {
        options.verbose = true;
      } else if (key === 'help') {
        printHelp();
        process.exit(0);
      }
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Soundpack Builder - Create mechvibes soundpack v4 configs

USAGE:
  npm run build:soundpack -- [OPTIONS]

OPTIONS:
  --input <path>           Input directory with audio files (required)
  --output <path>          Output file path (default: ./soundpack.mechvibes)
  --name <name>            Soundpack name (required)
  --author <name>          Author name (default: Unknown)
  --license <license>      License (default: Unknown)
  --max-voices <number>    Maximum concurrent voices (default: 64)
  --cache-budget <mb>      Cache budget in MB (default: 32)
  --preload <strategy>     Preload strategy: all|priority|lazy (default: priority)
  --verbose                Print detailed output

EXAMPLES:
  npm run build:soundpack -- --input ./my-pack --name "Cherry MX" --author "Me"
  npm run build:soundpack -- --input ./sounds --output ./pack.mechvibes --verbose
`);
}

/**
 * Build a soundpack from directory
 */
async function buildSoundpack(options: BuildOptions): Promise<void> {
  if (!options.input) {
    console.error('Error: --input directory is required');
    printHelp();
    process.exit(1);
  }

  if (!options.name) {
    console.error('Error: --name is required');
    printHelp();
    process.exit(1);
  }

  const inputDir = path.resolve(options.input);
  const outputPath = path.resolve(options.output || './soundpack.mechvibes');

  try {
    if (options.verbose) {
      console.log(`📦 Building soundpack: ${options.name}`);
      console.log(`   Input: ${inputDir}`);
      console.log(`   Output: ${outputPath}`);
    }

    // Step 1: Scan directory
    if (options.verbose) console.log('\n📂 Scanning audio files...');
    const scanned = await scanSoundpackDirectory(inputDir);
    console.log(`   Found ${scanned.files.length} audio files`);
    if (options.verbose) {
      scanned.files.forEach((f) => console.log(`     - ${f.relative}`));
    }

    // Step 2: Validate files
    if (options.verbose) console.log('\n✓ Validating audio files...');
    const validationErrors = await validateAudioFiles(scanned.files);
    if (validationErrors.length > 0) {
      console.error('❌ Validation errors:');
      validationErrors.forEach((e) => console.error(`   - ${e}`));
      process.exit(1);
    }
    console.log('   All files accessible');

    // Step 3: Generate config
    if (options.verbose) console.log('\n⚙️  Generating soundpack config...');
    const config = generateSoundpackConfig(scanned, options);
    const configErrors = validateGeneratedConfig(config);
    if (configErrors.length > 0) {
      console.error('❌ Config validation errors:');
      configErrors.forEach((e) => console.error(`   - ${e}`));
      process.exit(1);
    }
    console.log('   Config generated successfully');

    // Step 4: Create package
    if (options.verbose) console.log('\n📦 Creating soundpack package...');
    const zip = new AdmZip();

    // Add config.json
    zip.addFile('config.json', Buffer.from(JSON.stringify(config, null, 2)));

    // Add audio files
    for (const file of scanned.files) {
      const fileBuffer = await fs.readFile(file.path);
      zip.addFile(file.relative, fileBuffer);
    }

    // Write output
    await fs.ensureDir(path.dirname(outputPath));
    zip.writeZip(outputPath);
    console.log(`   Package created: ${path.basename(outputPath)}`);

    // Step 5: Summary
    console.log('\n✅ Soundpack built successfully!');
    console.log(`\nDetails:`);
    console.log(`  Name: ${config.name}`);
    console.log(`  Author: ${config.author}`);
    console.log(`  Audio files: ${scanned.files.length}`);
    console.log(`  Package size: ${(await fs.stat(outputPath)).size} bytes`);
    console.log(`\nTo use in mechvibes:`);
    console.log(`  1. Copy ${path.basename(outputPath)} to the soundpacks folder`);
    console.log(`  2. Restart mechvibes`);
    console.log(`  3. Select "${config.name}" from the soundpack list`);
  } catch (error) {
    console.error(`❌ Error building soundpack:`, error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.input && !process.argv.includes('--help')) {
    console.error('Error: Missing required arguments');
    printHelp();
    process.exit(1);
  }

  const options = args as BuildOptions;
  await buildSoundpack(options);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
