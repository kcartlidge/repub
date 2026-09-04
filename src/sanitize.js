'use strict';

const cheerio = require('cheerio');

function sanitizeHtml(html) {
  const $ = cheerio.load(html, {
    xmlMode: true,
    decodeEntities: false,
  });

  $('link[rel="stylesheet"]').remove();
  $('style').remove();

  $('[class]').removeAttr('class');
  $('[id]').removeAttr('id');

  return $.root().html() || '';
}

module.exports = { sanitizeHtml };
