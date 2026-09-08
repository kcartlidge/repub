'use strict';

const path = require('path');
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

function sanitizeHtml(html, options = {}) {
  const coverName = options.coverPath ? path.basename(options.coverPath) : null;
  const $ = cheerio.load(html, { xmlMode: true }, false);

  // Drop presentation hooks only; keep tags, text, and other attributes as-is.
  $('link[rel="stylesheet"]').remove();
  $('style').remove();

  $('[class]').removeAttr('class');
  $('[id]').removeAttr('id');

  // Page-break markers are often empty <a id="pageN"/>. After id stripping they
  // become bare <a/> which HTML parsers treat as open tags and nest <p> inside.
  $('a').each((_, el) => {
    const $el = $(el);
    if ($el.attr('href')) {
      return;
    }
    if (!String($el.html() || '').trim()) {
      $el.remove();
    } else {
      $el.replaceWith($el.contents());
    }
  });

  // Last-step annotation: tag content images after class stripping so sanitize
  // does not wipe inline-image, and the cover image is left unmarked.
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src') || '';
    const name = path.basename(src.split('#')[0]);
    if (coverName && name === coverName) {
      return;
    }
    $(el).attr('class', 'inline-image');
  });

  return normalizeVoidElements($.root().html() || '');
}

module.exports = { sanitizeHtml, normalizeVoidElements };
