#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (error) => {
    process.stderr.write(`\n[ERROR] ${error && error.message ? error.message : error}\n`);
    if (process.env.AIFLOW_DEBUG && error && error.stack) process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  },
);
