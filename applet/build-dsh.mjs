import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const superagentDir = '/app/applet/dsh-repo/dsh-superagent';
const outDir = path.join(superagentDir, 'lib');
fs.mkdirSync(outDir, { recursive: true });

const rawPlugin = {
  name: 'raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({
      path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
      namespace: 'raw-loader',
    }));
    build.onLoad({ filter: /.*/, namespace: 'raw-loader' }, args => ({
      contents: `export default ${JSON.stringify(fs.readFileSync(args.path, 'utf8'))};`,
      loader: 'js',
    }));
  },
};

await esbuild.build({
  entryPoints: {
    index: path.join(superagentDir, 'src/index.ts'),
    'github-watch': path.join(superagentDir, 'src/sources/github.ts'),
    'feishu-watch': path.join(superagentDir, 'src/sources/feishu.ts'),
  },
  outdir: outDir,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
});

await esbuild.build({
  entryPoints: {
    client: path.join(superagentDir, 'src/client/index.tsx'),
  },
  outdir: outDir,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  plugins: [rawPlugin],
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-superagent", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  },
  footer: {
    js: 'return module.exports; } });',
  },
});

console.log('Built dsh-superagent successfully');
