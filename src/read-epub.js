'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const unzipper = require('unzipper');
const { XMLParser } = require('fast-xml-parser');

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

async function extractEpub(epubPath) {
  const resolved = path.resolve(epubPath);
  await fs.promises.access(resolved, fs.constants.R_OK);

  const extractDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'repub-'));
  await fs.createReadStream(resolved).pipe(unzipper.Extract({ path: extractDir })).promise();
  return extractDir;
}

function findOpfPath(extractDir) {
  const containerPath = path.join(extractDir, 'META-INF', 'container.xml');
  const xml = fs.readFileSync(containerPath, 'utf8');
  const doc = xmlParser.parse(xml);

  const rootfiles = doc?.container?.rootfiles?.rootfile;
  if (!rootfiles) {
    throw new Error('No rootfile found in META-INF/container.xml');
  }

  const rootfile = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
  const fullPath = rootfile['@_full-path'];
  if (!fullPath) {
    throw new Error('rootfile is missing full-path');
  }

  const opfPath = path.join(extractDir, fullPath);
  if (!fs.existsSync(opfPath)) {
    throw new Error(`OPF not found at ${fullPath}`);
  }

  return opfPath;
}

async function readEpub(epubPath) {
  const extractDir = await extractEpub(epubPath);
  const opfPath = findOpfPath(extractDir);
  return { extractDir, opfPath };
}

module.exports = { extractEpub, findOpfPath, readEpub };
