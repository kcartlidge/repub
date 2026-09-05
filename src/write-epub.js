'use strict';

const fs = require('fs');
const path = require('path');
const nodepub = require('nodepub');
const { sanitizeHtml } = require('./sanitize');
const { outputStem } = require('./naming');

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
  if (src.published) metadata.published = src.published;
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
  const epub = nodepub.document(metadata);

  for (const section of book.sections) {
    epub.addSection(
      section.title,
      sanitizeHtml(section.html),
      Boolean(section.excludeFromContents),
      Boolean(section.isFrontMatter)
    );
  }

  await fs.promises.mkdir(outputFolder, { recursive: true });

  const inputPath = options.inputPath || 'book.epub';
  const stem = outputStem(inputPath, epubVersion);
  await epub.writeEPUB(outputFolder, stem);

  return path.join(outputFolder, `${stem}.epub`);
}

module.exports = { writeEpub, mapMetadata };
