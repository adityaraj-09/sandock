type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

const LOG_LEVELS: Record<LogLevel, number> = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const currentLogLevel = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG')) as LogLevel;

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLogLevel];
}

function formatMessage(level: LogLevel, message: string): string {
  return `[${level}] ${new Date().toISOString()} ${message}`;
}

export const logger = {
  error(message: string, ...args: unknown[]): void {
    if (shouldLog('ERROR')) {
      console.error(formatMessage('ERROR', message), ...args);
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('WARN')) {
      console.warn(formatMessage('WARN', message), ...args);
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog('INFO')) {
      console.log(formatMessage('INFO', message), ...args);
    }
  },

  debug(message: string, ...args: unknown[]): void {
    if (shouldLog('DEBUG')) {
      console.log(formatMessage('DEBUG', message), ...args);
    }
  }
};
