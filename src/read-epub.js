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

const IMAGE_EXT = /\.(svg|png|jpe?g|gif|tiff?)$/i;

function uniqueBasename(preferred, usedNames) {
  let name = preferred;
  if (!usedNames.has(name.toLowerCase())) {
    usedNames.add(name.toLowerCase());
    return name;
  }

  const ext = path.extname(preferred);
  const stem = path.basename(preferred, ext);
  let n = 2;
  do {
    name = `${stem}-${n}${ext}`;
    n += 1;
  } while (usedNames.has(name.toLowerCase()));

  usedNames.add(name.toLowerCase());
  return name;
}

function isDocumentItem(item) {
  const mediaType = String(item['@_media-type'] || '').toLowerCase();
  if (mediaType.includes('html') || mediaType === 'application/xhtml+xml') {
    return true;
  }
  const href = String(item['@_href'] || '').toLowerCase();
  return /\.(x?html?|htm)$/.test(href);
}

function normalizeHref(href) {
  return path.normalize(decodeURIComponent(String(href).split('#')[0])).replace(/\\/g, '/');
}

function walkNavPoints(navPoints, map) {
  for (const point of asArray(navPoints)) {
    const label = textOf(point.navLabel?.text) || textOf(point.navLabel);
    const src = point.content?.['@_src'];
    if (label && src) {
      const key = normalizeHref(src);
      if (!map.has(key)) {
        map.set(key, label);
      }
    }
    if (point.navPoint) {
      walkNavPoints(point.navPoint, map);
    }
  }
}

function titleMapFromNcx(opfPath, opfDoc) {
  const map = new Map();
  const items = asArray(opfDoc.package.manifest?.item);
  const ncxItem = items.find(
    (item) =>
      String(item['@_media-type'] || '').includes('ncx') ||
      String(item['@_id'] || '').toLowerCase() === 'ncx'
  );
  if (!ncxItem?.['@_href']) {
    return map;
  }

  const ncxPath = path.resolve(path.dirname(opfPath), decodeURIComponent(ncxItem['@_href']));
  if (!fs.existsSync(ncxPath)) {
    return map;
  }

  const ncxDoc = opfParser.parse(fs.readFileSync(ncxPath, 'utf8'));
  walkNavPoints(ncxDoc.ncx?.navMap?.navPoint, map);
  return map;
}

function titleMapFromNav(opfPath, opfDoc) {
  const map = new Map();
  const items = asArray(opfDoc.package.manifest?.item);
  const navItem = items.find((item) =>
    String(item['@_properties'] || '')
      .split(/\s+/)
      .includes('nav')
  );
  if (!navItem?.['@_href']) {
    return map;
  }

  const navPath = path.resolve(path.dirname(opfPath), decodeURIComponent(navItem['@_href']));
  if (!fs.existsSync(navPath)) {
    return map;
  }

  const $ = cheerio.load(fs.readFileSync(navPath, 'utf8'), { xmlMode: true });
  let tocNav = null;
  $('nav').each((_, el) => {
    if (tocNav) {
      return;
    }
    const attribs = el.attribs || {};
    const type = attribs['epub:type'] || attribs.type || '';
    if (String(type).split(/\s+/).includes('toc')) {
      tocNav = $(el);
    }
  });
  if (!tocNav) {
    tocNav = $('nav').first();
  }

  tocNav.find('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href || !label) {
      return;
    }
    const abs = path.resolve(path.dirname(navPath), decodeURIComponent(href.split('#')[0]));
    const rel = path.relative(path.dirname(opfPath), abs).replace(/\\/g, '/');
    if (!map.has(rel)) {
      map.set(rel, label);
    }
  });

  return map;
}

function buildTitleMap(opfPath, opfDoc, version) {
  if (version === 3) {
    const fromNav = titleMapFromNav(opfPath, opfDoc);
    if (fromNav.size > 0) {
      return fromNav;
    }
  }
  return titleMapFromNcx(opfPath, opfDoc);
}

function titleFromHtml(html) {
  const $ = cheerio.load(html, { xmlMode: true });
  for (const tag of ['h1', 'h2', 'h3']) {
    const text = $(tag).first().text().replace(/\s+/g, ' ').trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

async function readSpineSections(opfPath, opfDoc, extractDir, version) {
  const opfDir = path.dirname(opfPath);
  const items = asArray(opfDoc.package.manifest?.item);
  const itemById = new Map(items.map((item) => [item['@_id'], item]));
  const refs = asArray(opfDoc.package.spine?.itemref);
  const titleMap = buildTitleMap(opfPath, opfDoc, version);

  const imageStageDir = path.join(extractDir, '.repub-images');
  await fs.promises.mkdir(imageStageDir, { recursive: true });

  const images = [];
  const pathToImage = new Map();
  const usedNames = new Set();
  const sections = [];

  for (const ref of refs) {
    const item = itemById.get(ref['@_idref']);
    if (!item || !isDocumentItem(item)) {
      continue;
    }

    const href = item['@_href'];
    if (!href) {
      continue;
    }

    const docPath = path.resolve(opfDir, decodeURIComponent(href));
    const html = await fs.promises.readFile(docPath, 'utf8');
    const $ = cheerio.load(html, { xmlMode: true });
    const body = $('body');
    const root = body.length ? body : $.root();

    root.find('img[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (!src || /^data:/i.test(src) || /^https?:/i.test(src)) {
        return;
      }

      const absPath = path.resolve(path.dirname(docPath), decodeURIComponent(src.split('#')[0]));
      if (!fs.existsSync(absPath) || !IMAGE_EXT.test(absPath)) {
        return;
      }

      let image = pathToImage.get(absPath);
      if (!image) {
        const filename = uniqueBasename(path.basename(absPath), usedNames);
        const sourcePath = path.join(imageStageDir, filename);
        fs.copyFileSync(absPath, sourcePath);
        image = { sourcePath, filename };
        pathToImage.set(absPath, image);
        images.push(image);
      }

      $(el).attr('src', `../images/${image.filename}`);
    });

    const bodyHtml = body.length ? body.html() || '' : $.root().html() || '';
    const stem = path.basename(docPath, path.extname(docPath));
    const hrefKey = normalizeHref(href);
    const title =
      titleMap.get(hrefKey) || titleFromHtml(bodyHtml) || stem;

    sections.push({
      title,
      html: bodyHtml,
      sourceHref: href,
      sourcePath: docPath,
    });
  }

  return { sections, images };
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
  const { sections, images } = await readSpineSections(opfPath, opfDoc, extractDir, version);

  // BookModel carries metadata, ordered sections, and staged images only.
  // Original CSS (and other non-document resources) are intentionally dropped.
  return {
    version,
    metadata,
    sections: sections.map(({ title, html, excludeFromContents, isFrontMatter }) => ({
      title,
      html,
      excludeFromContents,
      isFrontMatter,
    })),
    images,
    extractDir,
  };
}

module.exports = {
  extractEpub,
  findOpfPath,
  detectVersion,
  parseOpfMetadata,
  readSpineSections,
  readEpub,
};
