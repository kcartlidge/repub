'use strict';

const fs = require('fs');
const path = require('path');
const nodepub = require('nodepub');
const { sanitizeHtml } = require('./sanitize');
const { outputStem } = require('./naming');

// Tiny placeholder used only when the source EPUB has no cover image.
// Nodepub requires a cover path, so we omit a real cover and fall back to this.
const FALLBACK_COVER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function ensureCover(metadata, book) {
  if (metadata.cover) {
    return;
  }

  const dir = book.extractDir || path.dirname(metadata.images?.[0] || process.cwd());
  const coverPath = path.join(dir, '.repub-cover-fallback.png');
  await fs.promises.writeFile(coverPath, FALLBACK_COVER_PNG);
  metadata.cover = coverPath;
}

function mapMetadata(book, epubVersion) {
  const src = book.metadata || {};
  const metadata = {
    epubVersion,
    id: src.id,
    title: src.title,
    author: src.author,
    language: src.language || 'en',
  };

  if (src.fileAs) metadata.fileAs = src.fileAs;
  if (src.description) metadata.description = src.description;
  if (src.publisher) metadata.publisher = src.publisher;
  if (src.published) {
    metadata.published = src.published;
  } else {
    // Nodepub's EPUB 2 OPF always emits dc:date; an empty value fails EPUBCheck.
    metadata.published = new Date().toISOString().slice(0, 10);
  }
  if (src.copyright) metadata.copyright = src.copyright;
  if (src.genre) metadata.genre = src.genre;
  if (src.tags) metadata.tags = src.tags;
  if (src.series) metadata.series = src.series;
  if (src.sequence != null) metadata.sequence = src.sequence;
  if (src.source) metadata.source = src.source;

  if (src.coverPath && fs.existsSync(src.coverPath)) {
    metadata.cover = src.coverPath;
  }

  if (book.images && book.images.length > 0) {
    metadata.images = book.images.map((image) => image.sourcePath);
  }

  // Prefer the source book's own cover page and TOC when present.
  metadata.addInternalCover = false;
  metadata.showContents = false;
  metadata.appendSeriesToTitle = false;
  metadata.transformNamedEntities = true;

  return metadata;
}

async function writeEpub(book, outputFolder, options = {}) {
  const forceV2 = Boolean(options.forceV2);
  const forceV3 = Boolean(options.forceV3);
  if (forceV2 && forceV3) {
    throw new Error('Use only one of --v2 or --v3');
  }

  const epubVersion = forceV2 ? 2 : forceV3 ? 3 : book.version;
  const metadata = mapMetadata(book, epubVersion);
  await ensureCover(metadata, book);
  const epub = nodepub.document(metadata);

  for (const section of book.sections) {
    epub.addSection(
      section.title,
      sanitizeHtml(section.html, { coverPath: metadata.cover }),
      Boolean(section.excludeFromContents),
      Boolean(section.isFrontMatter),
      section.outputFilename
    );
  }

  epub.addCSS(`body, p, div, span, h1, h2, h3, h4, h5, h6, li, td, th {
  font-family: Verdana, Tahoma, Georgia, Arial, Sans-Serif;
}

img.inline-image {
  max-width: 50%;
  display: block;
  margin: 2rem auto;
}`);

  await fs.promises.mkdir(outputFolder, { recursive: true });

  const inputPath = options.inputPath || 'book.epub';
  const stem = outputStem(inputPath, epubVersion);
  await epub.writeEPUB(outputFolder, stem);

  return path.join(outputFolder, `${stem}.epub`);
}

module.exports = { writeEpub, mapMetadata };
