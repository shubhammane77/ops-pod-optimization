import { env } from 'node:process';

let debugEnabled = Boolean(env.DEBUG);

export const setDebugEnabled = (enabled: boolean): void => {
  debugEnabled = enabled;
};

export const debug = (...args: unknown[]): void => {
  if (debugEnabled) {
    console.debug('[debug]', ...args);
  }
};
