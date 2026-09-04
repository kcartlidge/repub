'use strict';

const cheerio = require('cheerio');

const VOID_TAGS = [
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
];

const VOID_RE = new RegExp(
  `<(${VOID_TAGS.join('|')})(\\s[^>]*)?>`,
  'gi'
);
const VOID_CLOSE_RE = new RegExp(`</(${VOID_TAGS.join('|')})>`, 'gi');

function normalizeVoidElements(html) {
  return html
    .replace(VOID_RE, (match, tag, attrs = '') => {
      if (/\/\s*>$/.test(match)) {
        return `<${tag}${attrs.replace(/\/\s*$/, '')} />`;
      }
      return `<${tag}${attrs} />`;
    })
    .replace(VOID_CLOSE_RE, '');
}

function sanitizeHtml(html) {
  const $ = cheerio.load(html, null, false);

  // Drop presentation hooks only; keep tags, text, and other attributes as-is.
  $('link[rel="stylesheet"]').remove();
  $('style').remove();

  $('[class]').removeAttr('class');
  $('[id]').removeAttr('id');

  return normalizeVoidElements($.root().html() || '');
}

module.exports = { sanitizeHtml, normalizeVoidElements };
