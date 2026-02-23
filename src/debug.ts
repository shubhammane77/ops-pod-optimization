import { env } from 'node:process';

export const debug = (...args: unknown[]): void => {
  if (env.DEBUG) {
    console.debug('[debug]', ...args);
  }
};
