/**
 * Language-specific Docker image configuration
 * Maps programming languages to their optimized container images
 */

// Language to Docker image mapping
export const LANGUAGE_IMAGES = {
  // JavaScript/TypeScript
  javascript: process.env.IMAGE_JAVASCRIPT || 'sandbox-agent:node',
  js: process.env.IMAGE_JAVASCRIPT || 'sandbox-agent:node',
  typescript: process.env.IMAGE_TYPESCRIPT || 'sandbox-agent:node',
  ts: process.env.IMAGE_TYPESCRIPT || 'sandbox-agent:node',
  node: process.env.IMAGE_JAVASCRIPT || 'sandbox-agent:node',

  // Python
  python: process.env.IMAGE_PYTHON || 'sandbox-agent:python',
  python3: process.env.IMAGE_PYTHON || 'sandbox-agent:python',
  py: process.env.IMAGE_PYTHON || 'sandbox-agent:python',

  // Java
  java: process.env.IMAGE_JAVA || 'sandbox-agent:java',

  // C/C++
  cpp: process.env.IMAGE_CPP || 'sandbox-agent:cpp',
  'c++': process.env.IMAGE_CPP || 'sandbox-agent:cpp',
  c: process.env.IMAGE_CPP || 'sandbox-agent:cpp',

  // Go
  go: process.env.IMAGE_GO || 'sandbox-agent:go',
  golang: process.env.IMAGE_GO || 'sandbox-agent:go',

  // Rust
  rust: process.env.IMAGE_RUST || 'sandbox-agent:rust',
  rs: process.env.IMAGE_RUST || 'sandbox-agent:rust',

  // Multi-language fallback
  multi: process.env.IMAGE_MULTI || 'sandbox-agent:multilang'
};

// Language execution configuration
export const LANGUAGE_CONFIG = {
  javascript: {
    extension: 'js',
    command: 'node',
    args: [],
    compile: false
  },
  typescript: {
    extension: 'ts',
    command: 'npx',
    args: ['ts-node'],
    compile: false
  },
  python: {
    extension: 'py',
    command: 'python3',
    args: [],
    compile: false
  },
  java: {
    extension: 'java',
    command: 'javac',
    args: [],
    compile: true,
    runCommand: 'java',
    runArgs: []
  },
  cpp: {
    extension: 'cpp',
    command: 'g++',
    args: ['-o', 'main', '-std=c++17'],
    compile: true,
    runCommand: './main',
    runArgs: []
  },
  c: {
    extension: 'c',
    command: 'gcc',
    args: ['-o', 'main'],
    compile: true,
    runCommand: './main',
    runArgs: []
  },
  go: {
    extension: 'go',
    command: 'go',
    args: ['run'],
    compile: false
  },
  rust: {
    extension: 'rs',
    command: 'rustc',
    args: ['-o', 'main'],
    compile: true,
    runCommand: './main',
    runArgs: []
  }
};

// Supported languages list
export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_CONFIG);

/**
 * Get Docker image for a specific language
 * @param {string} language - Programming language
 * @returns {string} Docker image name
 */
export function getImageForLanguage(language) {
  const normalizedLang = language?.toLowerCase()?.trim();
  return LANGUAGE_IMAGES[normalizedLang] || LANGUAGE_IMAGES.multi;
}

/**
 * Get execution configuration for a language
 * @param {string} language - Programming language
 * @returns {object|null} Language configuration or null if unsupported
 */
export function getLanguageConfig(language) {
  const normalizedLang = normalizeLanguage(language);
  return LANGUAGE_CONFIG[normalizedLang] || null;
}

/**
 * Normalize language name to standard form
 * @param {string} language - Programming language input
 * @returns {string} Normalized language name
 */
export function normalizeLanguage(language) {
  const lang = language?.toLowerCase()?.trim();

  const aliases = {
    'js': 'javascript',
    'node': 'javascript',
    'ts': 'typescript',
    'py': 'python',
    'python3': 'python',
    'c++': 'cpp',
    'golang': 'go',
    'rs': 'rust'
  };

  return aliases[lang] || lang;
}

/**
 * Check if a language is supported
 * @param {string} language - Programming language
 * @returns {boolean} Whether the language is supported
 */
export function isLanguageSupported(language) {
  const normalizedLang = normalizeLanguage(language);
  return SUPPORTED_LANGUAGES.includes(normalizedLang);
}

/**
 * Get all available images for pre-pulling
 * @returns {string[]} Array of unique image names
 */
export function getAllImages() {
  const images = new Set(Object.values(LANGUAGE_IMAGES));
  return Array.from(images);
}
