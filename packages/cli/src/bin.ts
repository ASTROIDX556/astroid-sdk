#!/usr/bin/env node
/**
 * Executable entry point for the `astroid` CLI.
 *
 * Kept intentionally tiny: it builds the Commander program (see
 * {@link file://./index.ts}) and parses `process.argv`. All command logic lives
 * in the library module so it can be embedded and unit-tested without spawning a
 * process.
 */

import { buildProgram } from './index.js';

buildProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
