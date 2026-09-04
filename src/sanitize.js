'use strict';

const cheerio = require('cheerio');

function sanitizeHtml(html) {
  const $ = cheerio.load(html, {
    xmlMode: true,
    decodeEntities: false,
  });

  // Drop presentation hooks only; keep tags, text, and other attributes as-is.
  $('link[rel="stylesheet"]').remove();
  $('style').remove();

  $('[class]').removeAttr('class');
  $('[id]').removeAttr('id');

  return $.root().html() || '';
}

module.exports = { sanitizeHtml };
