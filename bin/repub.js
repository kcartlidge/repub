#!/usr/bin/env node
'use strict';

const { run } = require('../src/cli');

run(process.argv.slice(2)).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
