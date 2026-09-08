# repub

Rewrite an EPUB with cleaned markup and a simple font stylesheet. Accepts EPUB 2 or EPUB 3, and also exports to either EPUB 2 or EPUB 3.

## How to use

```sh
npm install
npm run repub -- <epub-file> <output-folder> [--v2|--v3]
```

| Argument | Meaning |
|---|---|
| `<epub-file>` | Input EPUB 2 or EPUB 3 |
| `<output-folder>` | Where to write the result (created if needed) |
| `--v2` | Force EPUB 2 output |
| `--v3` | Force EPUB 3 output |

With neither flag, the output version matches the input.

The rewritten file is named `{stem} -- repub-epub2.epub` or `{stem} -- repub-epub3.epub`. For example, `my-book.epub` becomes `my-book -- repub-epub2.epub`.

Original stylesheets are dropped, `class` / `id` attributes are stripped, and a simple Verdana-based font stylesheet is applied. Inline images (not the cover) are centered at up to half width.  The result is a simple document you can either use or add to.

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE.txt).

Copyright (C) K Cartlidge 2026.
