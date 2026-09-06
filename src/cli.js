'use strict';

const fs = require('fs');
const { readEpub } = require('./read-epub');
const { writeEpub } = require('./write-epub');

function printUsage() {
  console.error('Usage: npm run repub -- <epub-file> <output-folder> [--v2|--v3]');
  console.error('');
  console.error('  <epub-file>       Path to an EPUB 2 or EPUB 3 file');
  console.error('  <output-folder>   Folder for the rewritten EPUB (created if needed)');
  console.error('  --v2              Force EPUB 2 output');
  console.error('  --v3              Force EPUB 3 output');
  console.error('');
  console.error('Without --v2/--v3, the output version matches the input.');
}

function parseArgs(argv) {
  const flags = new Set();
  const positionals = [];

  for (const arg of argv) {
    if (arg === '--v2' || arg === '--v3' || arg === '--help' || arg === '-h') {
      flags.add(arg);
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positionals.push(arg);
  }

  if (flags.has('--help') || flags.has('-h')) {
    return { help: true };
  }

  if (flags.has('--v2') && flags.has('--v3')) {
    throw new Error('Use only one of --v2 or --v3');
  }

  if (positionals.length !== 2) {
    throw new Error('Expected <epub-file> and <output-folder>');
  }

  return {
    help: false,
    epubFile: positionals[0],
    outputFolder: positionals[1],
    forceV2: flags.has('--v2'),
    forceV3: flags.has('--v3'),
  };
}

async function cleanupExtractDir(extractDir) {
  if (!extractDir) {
    return;
  }
  await fs.promises.rm(extractDir, { recursive: true, force: true });
}

async function run(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    printUsage();
    return;
  }

  let book;
  try {
    book = await readEpub(args.epubFile);
    const outputPath = await writeEpub(book, args.outputFolder, {
      inputPath: args.epubFile,
      forceV2: args.forceV2,
      forceV3: args.forceV3,
    });
    console.log(outputPath);
  } finally {
    await cleanupExtractDir(book && book.extractDir);
  }
}

module.exports = { run, parseArgs, printUsage };
