'use strict';

import fs from 'fs-extra';
import path from 'path';

export interface ScannedAudioFile {
  path: string;
  filename: string;
  relative: string;
  size: number;
  extension: string;
}

export interface ScannedDirectory {
  root: string;
  files: ScannedAudioFile[];
  eventTypes: {
    keydown: string[];
    keyup: string[];
  };
}

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.aac', '.flac', '.m4a', '.mp3', '.mp4',
  '.oga', '.ogg', '.opus', '.wav', '.webm'
]);

/**
 * Scan a directory for audio files and organize them by type
 */
export async function scanSoundpackDirectory(dirPath: string): Promise<ScannedDirectory> {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const stat = await fs.stat(dirPath);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${dirPath}`);
  }

  const files: ScannedAudioFile[] = [];
  const eventTypes: { keydown: string[]; keyup: string[] } = {
    keydown: [],
    keyup: [],
  };

  // Recursively scan for audio files
  const walkDir = async (currentPath: string): Promise<void> => {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        // Skip hidden directories
        if (!entry.name.startsWith('.')) {
          await walkDir(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
          const stat = await fs.stat(fullPath);
          const relative = path.relative(dirPath, fullPath);
          
          files.push({
            path: fullPath,
            filename: entry.name,
            relative,
            size: stat.size,
            extension: ext,
          });

          // Categorize by event type
          const lower = entry.name.toLowerCase();
          if (lower.includes('up') || lower.includes('release')) {
            eventTypes.keyup.push(relative);
          } else if (lower.includes('down') || lower.includes('press')) {
            eventTypes.keydown.push(relative);
          } else {
            // Default to keydown if ambiguous
            eventTypes.keydown.push(relative);
          }
        }
      }
    }
  };

  await walkDir(dirPath);

  if (files.length === 0) {
    throw new Error(`No audio files found in ${dirPath}`);
  }

  return {
    root: dirPath,
    files: files.sort((a, b) => a.relative.localeCompare(b.relative)),
    eventTypes,
  };
}

/**
 * Validate that all files are accessible and readable
 */
export async function validateAudioFiles(files: ScannedAudioFile[]): Promise<string[]> {
  const errors: string[] = [];

  for (const file of files) {
    try {
      await fs.access(file.path, fs.constants.R_OK);
    } catch {
      errors.push(`File not readable: ${file.relative}`);
    }
  }

  return errors;
}

/**
 * Estimate audio duration from file size (rough estimate)
 * Actual duration would require parsing the audio file
 */
export function estimateAudioDuration(filePath: string, sampleRate = 44100): number {
  try {
    const stat = fs.statSync(filePath);
    // Very rough estimate: assume 16-bit stereo PCM
    const bytesPerSecond = sampleRate * 2 * 2; // sampleRate * channels * bytes
    return stat.size / bytesPerSecond;
  } catch {
    return 0;
  }
}
