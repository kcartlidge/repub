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

function detectVersion(opfPath) {
  const xml = fs.readFileSync(opfPath, 'utf8');
  const doc = xmlParser.parse(xml);
  const versionAttr = doc?.package?.['@_version'];
  if (!versionAttr) {
    throw new Error('OPF package is missing version attribute');
  }

  if (String(versionAttr).startsWith('3')) {
    return 3;
  }
  if (String(versionAttr).startsWith('2')) {
    return 2;
  }

  throw new Error(`Unsupported EPUB version: ${versionAttr}`);
}

async function readEpub(epubPath) {
  const extractDir = await extractEpub(epubPath);
  const opfPath = findOpfPath(extractDir);
  const version = detectVersion(opfPath);
  return { extractDir, opfPath, version };
}

module.exports = { extractEpub, findOpfPath, detectVersion, readEpub };
