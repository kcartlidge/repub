'use strict';

const path = require('path');

function outputStem(inputPath, version) {
  const base = path.basename(inputPath);
  const stem = base.replace(/\.epub$/i, '') || base;
  return `${stem} -- repub-epub${version}`;
}

module.exports = { outputStem };
