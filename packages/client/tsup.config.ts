import { astroidTsup } from '../../tsup.base';

export default astroidTsup({
  entry: ['src/index.ts', 'src/client.ts', 'src/retry.ts'],
});
