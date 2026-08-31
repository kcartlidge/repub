'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const unzipper = require('unzipper');

async function extractEpub(epubPath) {
  const resolved = path.resolve(epubPath);
  await fs.promises.access(resolved, fs.constants.R_OK);

  const extractDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'repub-'));
  await fs.createReadStream(resolved).pipe(unzipper.Extract({ path: extractDir })).promise();
  return extractDir;
}

async function readEpub(epubPath) {
  const extractDir = await extractEpub(epubPath);
  return { extractDir };
}

module.exports = { extractEpub, readEpub };
