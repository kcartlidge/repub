'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const unzipper = require('unzipper');
const { XMLParser } = require('fast-xml-parser');
const cheerio = require('cheerio');

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

const opfParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

function asArray(value) {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function textOf(node) {
  if (node == null) {
    return undefined;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (typeof node['#text'] !== 'undefined') {
    return String(node['#text']);
  }
  return undefined;
}

function plainText(value) {
  const raw = textOf(value);
  if (!raw) {
    return undefined;
  }
  if (!/[<>]/.test(raw)) {
    return raw;
  }
  return cheerio.load(raw, { xml: false })('body').text().replace(/\s+/g, ' ').trim() || raw;
}

function metaEntries(metadata) {
  return asArray(metadata.meta);
}

function findMetaByName(metadata, name) {
  return metaEntries(metadata).find((entry) => entry['@_name'] === name);
}

function findMetaByProperty(metadata, property) {
  return metaEntries(metadata).find((entry) => entry['@_property'] === property);
}

function pickIdentifier(metadata) {
  const ids = asArray(metadata.identifier);
  if (ids.length === 0) {
    return undefined;
  }

  const withId = ids.find((entry) => entry['@_id']);
  return textOf(withId || ids[0]);
}

function pickCreator(metadata) {
  const creators = asArray(metadata.creator);
  if (creators.length === 0) {
    return {};
  }

  const primary =
    creators.find((entry) => entry['@_role'] === 'aut') ||
    creators[0];

  const author = textOf(primary);
  let fileAs = primary['@_file-as'];

  if (!fileAs && primary['@_id']) {
    const refined = metaEntries(metadata).find(
      (entry) =>
        entry['@_property'] === 'file-as' &&
        entry['@_refines'] === `#${primary['@_id']}`
    );
    fileAs = textOf(refined);
  }

  return { author, fileAs };
}

function pickSubjects(metadata) {
  const subjects = asArray(metadata.subject).map(textOf).filter(Boolean);
  if (subjects.length === 0) {
    return {};
  }
  return {
    genre: subjects[0],
    tags: subjects.slice(1).join(',') || undefined,
  };
}

function resolveCoverPath(opfPath, opfDoc) {
  const opfDir = path.dirname(opfPath);
  const metadata = opfDoc.package.metadata || {};
  const items = asArray(opfDoc.package.manifest?.item);

  const coverMeta = findMetaByName(metadata, 'cover');
  let item;

  if (coverMeta && coverMeta['@_content']) {
    item = items.find((entry) => entry['@_id'] === coverMeta['@_content']);
  }

  if (!item) {
    item = items.find((entry) =>
      String(entry['@_properties'] || '')
        .split(/\s+/)
        .includes('cover-image')
    );
  }

  if (!item || !item['@_href']) {
    return undefined;
  }

  const coverPath = path.resolve(opfDir, decodeURIComponent(item['@_href']));
  return fs.existsSync(coverPath) ? coverPath : undefined;
}

function parseOpfMetadata(opfPath) {
  const xml = fs.readFileSync(opfPath, 'utf8');
  const opfDoc = opfParser.parse(xml);
  const metadataNode = opfDoc?.package?.metadata;
  if (!metadataNode) {
    throw new Error('OPF is missing metadata');
  }

  const { author, fileAs } = pickCreator(metadataNode);
  const { genre, tags } = pickSubjects(metadataNode);

  const seriesMeta =
    findMetaByName(metadataNode, 'calibre:series') ||
    findMetaByProperty(metadataNode, 'belongs-to-collection');
  const sequenceMeta =
    findMetaByName(metadataNode, 'calibre:series_index') ||
    findMetaByProperty(metadataNode, 'group-position');

  const publishedRaw = textOf(metadataNode.date);
  const published = publishedRaw ? publishedRaw.slice(0, 10) : undefined;

  const metadata = {
    id: pickIdentifier(metadataNode) || `repub-${Date.now()}`,
    title: textOf(metadataNode.title) || 'Untitled',
    author: author || 'Unknown',
    fileAs: fileAs || undefined,
    language: textOf(metadataNode.language) || 'en',
    description: plainText(metadataNode.description),
    publisher: textOf(metadataNode.publisher),
    published,
    copyright: textOf(metadataNode.rights),
    genre,
    tags,
    series: textOf(seriesMeta),
    sequence: sequenceMeta ? Number(textOf(sequenceMeta)) || undefined : undefined,
    source: textOf(metadataNode.source),
    coverPath: resolveCoverPath(opfPath, opfDoc),
  };

  return { metadata, opfDoc };
}

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
  const { metadata, opfDoc } = parseOpfMetadata(opfPath);
  return { extractDir, opfPath, version, metadata, opfDoc };
}

module.exports = {
  extractEpub,
  findOpfPath,
  detectVersion,
  parseOpfMetadata,
  readEpub,
};
