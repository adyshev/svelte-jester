'use strict';

var child_process = require('child_process');
var path = require('path');
var url = require('url');
var svelte = require('svelte/compiler');
var os = require('os');
var fs = require('fs');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n["default"] = e;
  return Object.freeze(n);
}

var path__default = /*#__PURE__*/_interopDefaultLegacy(path);
var svelte__namespace = /*#__PURE__*/_interopNamespace(svelte);
var fs__default = /*#__PURE__*/_interopDefaultLegacy(fs);

const configFilenames = ['svelte.config.js', 'svelte.config.cjs'];

function getSvelteConfig (rootMode, filename, preprocess) {
  let configFile = null;

  if (typeof preprocess === 'boolean') {
    configFile =
      rootMode === 'upward'
        ? findConfigFile(path__default["default"].dirname(filename))
        : getConfigFile(process.cwd());
  } else if (typeof preprocess === 'string') {
    configFile = preprocess;
  }

  if (configFile === null || !fs__default["default"].existsSync(configFile)) {
    throw Error(
      `Could not find ${configFilenames.join(' or ')} or ${configFile}.`
    )
  }

  return configFile
}

const getConfigFile = (searchDir) => {
  for (const configFilename of configFilenames) {
    const filePath = path__default["default"].resolve(searchDir, configFilename);
    if (fs__default["default"].existsSync(filePath)) {
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

  const parentDir = path__default["default"].resolve(searchDir, '..');
  return parentDir !== searchDir ? findConfigFile(parentDir) : null // Stop walking at filesystem root
};

const dynamicImport = async (filename) => (function (t) { return Promise.resolve().then(function () { return /*#__PURE__*/_interopNamespace(require(t)); }); })(os.platform() === "win32" ? url.pathToFileURL(filename).toString() : filename);

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
  const processed = await svelte__namespace.preprocess(
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

  const preprocessResult = child_process.execSync(
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
    result = svelte__namespace.compile(processedCode, {
      filename: path.basename(filename),
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

module.exports = transformer;
