/**
 * This file is part of Feather Wiki.
 *
 * Feather Wiki is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * Feather Wiki is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License along with Feather Wiki. If not, see https://www.gnu.org/licenses/.
 */
import path from 'path';
import fs from 'fs';
import http from 'http';
import esbuild from 'esbuild';

const outputDir = path.resolve(process.cwd(), 'develop');
const outputFilePath = path.resolve(outputDir, 'index.html');

const defaultLocale = process.env.FEATHERWIKI_LOCALE ?? 'en-US';
const localesDir = path.resolve(process.cwd(), 'locales');
const loadLocale = (localeName) => {
  const localePath = path.resolve(localesDir, `${localeName}.json`);
  if (fs.existsSync(localePath)) {
    return JSON.parse(fs.readFileSync(localePath, 'utf8'));
  }
  return null;
};

const english = loadLocale('en-US') ?? {};
const activeLocale = loadLocale(defaultLocale) ?? english;
const localeName = defaultLocale;

const packageJsonPath = path.resolve(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const devOutputPlugin = {
  name: 'dev-output',
  setup (build) {
    build.onEnd(async (result) => {
      if (!result || result.errors.length) {
        if (result?.errors.length) {
          console.error('watch build failed:', result.errors);
        }
        return;
      }

      try {
        await handleBuildResult(result);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    });
  },
};

const buildOptions = {
  entryPoints: ['index.js'],
  define: {
    'process.env.NODE_ENV': '"development"',
    'process.env.NODE_DEBUG': '"debug"',
  },
  sourcemap: 'inline',
  write: false,
  bundle: true,
  minify: false,
  plugins: [
    {
      name: 'transform-content',
      setup(build) {
        build.onLoad({ filter: /\.js$/ }, async (args) => {
          const fileName = path.relative(process.cwd(), args.path);
          let contents = await fs.promises.readFile(fileName, 'utf8');
          contents = localize(contents);
          contents = injectPackageVariables(contents);
          return { contents };
        });
      },
    },
    devOutputPlugin,
  ],
  platform: 'browser',
  format: 'iife',
  target: ['es2015'],
  outdir: 'build',
};

void start();

async function start () {
  try {
    const ctx = await esbuild.context(buildOptions);
    await ctx.rebuild();
    await startServer();
    await ctx.watch();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

async function handleBuildResult (result) {
  const fileName = path.relative(process.cwd(), 'index.html');
  let html = await fs.promises.readFile(fileName, 'utf8');
  const cssResult = esbuild.buildSync({
    entryPoints: ['index.css'],
    write: false,
    bundle: true,
    minify: false,
    outdir: 'build',
  });
  for (const out of [...cssResult.outputFiles, ...result.outputFiles]) {
    let output = new TextDecoder().decode(out.contents);
    const outputKb = out.contents.byteLength * 0.000977;
    console.info(out.path, outputKb.toFixed(3) + ' kilobytes');
    if (/\.css$/.test(out.path)) {
      html = html.replace('{{cssOutput}}', output);
    } else if (/\.js$/.test(out.path)) {
      // Since there's regex stuff in here, I can't do replace!
      const htmlParts = html.split('{{jsOutput}}'); // But this does exactly what I need
      html = htmlParts[0] + output + htmlParts[1];
    }
  }
  
  html = localize(html);
  return injectPackageJsonData(html);
}

async function injectPackageJsonData (html) {
  const matches = html.match(/(?<={{)package\.json:.+?(?=}})/g);

  if (matches?.length > 0) {
    let result = html;
    matches.map(match => {
      const value = match.replace('package.json:', '').trim();
      const replace = value.split('.').reduce((result, current) => {
        if (result === null) {
          return packageJson[current] ?? '';
        }
        return result[current] ?? '';
      }, null);
      return {
        match: `{{${match}}}`,
        replace,
      };
    }).forEach(m => {
      html = html.replace(m.match, m.replace);
    });
  }

  return writeHtmlOutput(html);
}

async function writeHtmlOutput (html) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  await fs.writeFile(outputFilePath, html, (err) => {
    if (err) throw err;
    const outputKb = Uint8Array.from(Buffer.from(html)).byteLength * 0.000977;
    console.info(outputFilePath, outputKb.toFixed(3) + ' kilobytes');
  });
}

async function startServer () {
  const server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/html'});
  
    res.end(fs.readFileSync(outputFilePath));
  });
  server.listen(3000, 'localhost');
  console.log('Node server running at http://localhost:3000');
}

function localize (content) {
  const translations = { ...english, ...activeLocale };
  const currentLocaleName = localeName;
  let result = content.replace(/\{\{localeName\}\}/g, currentLocaleName);
  Object.keys(translations).forEach((key) => {
    const regex = new RegExp(`\\{\\{translate: ?${key}\\}\\}`, 'g');
    result = result.replace(regex, translations[key]);
  });
  return result;
}

function injectPackageVariables (content) {
  const matches = content.match(/(?<={{)package\.json:.+?(?=}})/g);
  if (!matches?.length) return content;
  let result = content;
  matches.map(match => {
    const value = match.replace('package.json:', '').trim();
    const replace = value.split('.').reduce((res, current) => {
      if (res === null) {
        return packageJson[current] ?? '';
      }
      return res[current] ?? '';
    }, null);
    return {
      match: `{{${match}}}`,
      replace,
    };
  }).forEach(m => {
    result = result.replace(m.match, m.replace);
  });
  return result;
}
