// Production-ready logging utility

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const currentLogLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG');

function shouldLog(level) {
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLogLevel];
}

export const logger = {
  error: (message, ...args) => {
    if (shouldLog('ERROR')) {
      console.error(`[ERROR] ${new Date().toISOString()}`, message, ...args);
    }
  },
  
  warn: (message, ...args) => {
    if (shouldLog('WARN')) {
      console.warn(`[WARN] ${new Date().toISOString()}`, message, ...args);
    }
  },
  
  info: (message, ...args) => {
    if (shouldLog('INFO')) {
      console.log(`[INFO] ${new Date().toISOString()}`, message, ...args);
    }
  },
  
  debug: (message, ...args) => {
    if (shouldLog('DEBUG')) {
      console.log(`[DEBUG] ${new Date().toISOString()}`, message, ...args);
    }
  }
};

