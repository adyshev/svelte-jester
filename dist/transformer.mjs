import { execSync } from 'child_process';
import path, { basename } from 'path';
import { pathToFileURL } from 'url';
import * as svelte from 'svelte/compiler';
import { platform } from 'os';
import fs from 'fs';

const configFilenames = ['svelte.config.js', 'svelte.config.cjs'];

function getSvelteConfig (rootMode, filename, preprocess) {
  let configFile = null;

  if (typeof preprocess === 'boolean') {
    configFile =
      rootMode === 'upward'
        ? findConfigFile(path.dirname(filename))
        : getConfigFile(process.cwd());
  } else if (typeof preprocess === 'string') {
    configFile = preprocess;
  }

  if (configFile === null || !fs.existsSync(configFile)) {
    throw Error(
      `Could not find ${configFilenames.join(' or ')} or ${configFile}.`
    )
  }

  return configFile
}

const getConfigFile = (searchDir) => {
  for (const configFilename of configFilenames) {
    const filePath = path.resolve(searchDir, configFilename);
    if (fs.existsSync(filePath)) {
      return filePath
    }
  }

  return null
};

const findConfigFile = (searchDir) => {
  const filePath = getConfigFile(searchDir);
  if (filePath !== null) {
    return filePath
  }

  const parentDir = path.resolve(searchDir, '..');
  return parentDir !== searchDir ? findConfigFile(parentDir) : null // Stop walking at filesystem root
};

const dynamicImport = async (filename) => import(platform() === "win32" ? pathToFileURL(filename).toString() : filename);

/**
 * Jest will only call this method when running in ESM mode.
 */
const processAsync = async (source, filename, jestOptions) => {
  const options = jestOptions && jestOptions.transformerConfig ? jestOptions.transformerConfig : {};
  const { preprocess, rootMode } = options;

  if (!preprocess) {
    return compiler('esm', options, filename, source)
  }

  const svelteConfigPath = getSvelteConfig(rootMode, filename, preprocess);
  const svelteConfig = await dynamicImport(svelteConfigPath);
  const processed = await svelte.preprocess(
    source,
    svelteConfig.default.preprocess || {},
    { filename }
  );

  return compiler('esm', options, filename, processed.code, processed.map)
};

/**
 * Starts a new process, so is higher overhead than processAsync.
 * However, Jest calls this method in CJS mode.
 */
const processSync = (source, filename, jestOptions) => {
  const options = jestOptions && jestOptions.transformerConfig ? jestOptions.transformerConfig : {};
  const { preprocess, rootMode, maxBuffer, showConsoleLog } = options;
  if (!preprocess) {
    return compiler('cjs', options, filename, source)
  }

  const svelteConfig = getSvelteConfig(rootMode, filename, preprocess);
  const preprocessor = require.resolve('./preprocess.js');

  const preprocessResult = execSync(
        `node --unhandled-rejections=strict --abort-on-uncaught-exception "${preprocessor}"`,
        {
          env: { ...process.env, source, filename, svelteConfig, showConsoleLog },
          maxBuffer: maxBuffer || 10 * 1024 * 1024
        }
  ).toString();

  const parsedPreprocessResult = JSON.parse(preprocessResult);
  return compiler('cjs', options, filename, parsedPreprocessResult.code, parsedPreprocessResult.map)
};

const compiler = (format, options = {}, filename, processedCode, processedMap) => {
  const { debug, compilerOptions } = options;

  let result;

  try {
    result = svelte.compile(processedCode, {
      filename: basename(filename),
      css: true,
      accessors: true,
      dev: true,
      format,
      sourcemap: processedMap,
      ...compilerOptions
    });
  } catch (error) {
    let msg = error.message;
    if (error.frame) {
      msg += '\n' + error.frame;
    }
    console.error(msg);
    throw error
  }

  if (debug) {
    console.log(result.js.code);
  }

  const esInterop = format === 'cjs' ? 'Object.defineProperty(exports, "__esModule", { value: true });' : '';

  return {
    code: result.js.code + esInterop,
    map: JSON.stringify(result.js.map)
  }
};

var transformer = {
  process: processSync,
  processAsync
};

export { transformer as default };
