// Test helper (not a test: the runner glob is tools/test-*.cjs).
//
// Loads TypeScript modules from src/ for the Node test runner without a bundler:
// each file is transpiled with the `typescript` package and evaluated in THIS
// realm (so deepStrictEqual on returned arrays/objects works), and relative
// imports are resolved recursively. `./client` can be replaced by a stub so
// api.ts mappers run against raw payloads without touching the network.

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const SRC = path.join(__dirname, '../src')

function loadTs(relPath, { stubs = {} } = {}) {
  const cache = new Map()

  function load(file) {
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const source = fs.readFileSync(file, 'utf8')
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: file,
    }).outputText
    const wrapper = vm.runInThisContext(`(function (exports, require, module) {${js}\n})`, { filename: file })
    const localRequire = (spec) => {
      if (spec.startsWith('.')) {
        const base = path.basename(spec)
        if (Object.prototype.hasOwnProperty.call(stubs, base)) return stubs[base]
        const resolved = path.resolve(path.dirname(file), spec)
        const candidate = fs.existsSync(`${resolved}.ts`) ? `${resolved}.ts` : path.join(resolved, 'index.ts')
        return load(candidate)
      }
      return require(spec)
    }
    wrapper(module.exports, localRequire, module)
    return module.exports
  }

  return load(path.join(SRC, relPath))
}

module.exports = { loadTs }
