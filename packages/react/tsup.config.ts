import { astroidTsup } from '../../tsup.base';

export default astroidTsup({
  entry: ['src/index.ts'],
  external: ['react', 'react-dom', '@tanstack/react-query'],
  banner: { js: '"use client";' },
});
