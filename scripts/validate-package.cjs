const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];
const notes = [];

const rel = file => path.relative(root, file).split(path.sep).join('/');
const exists = relativePath => fs.existsSync(path.join(root, relativePath));
const fail = message => errors.push(message);

const required = [
  'README.md',
  '使用说明.md',
  'VERSION',
  'CHANGELOG.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  '.gitignore',
  '.obsidian/app.json',
  '.obsidian/appearance.json',
  '.obsidian/community-plugins.json',
  '.obsidian/snippets/subscription-editorial.css',
  '.obsidian/snippets/editorial-foundation.css',
  '30 订阅/订阅主页.md',
  '90 模板/订阅自动化/新建订阅.md',
  '90 模板/订阅自动化/编辑订阅.md',
  '90 模板/订阅自动化/记录续费.md',
  '90 模板/订阅自动化/选择订阅图片.md',
  '90 模板/订阅自动化/订阅档案母版.md',
  '90 模板/订阅自动化/scripts/domain.js',
  '90 模板/订阅自动化/scripts/repository.js',
  '90 模板/订阅自动化/scripts/commands.js',
  '90 模板/订阅自动化/scripts/bootstrap.js',
  '90 模板/订阅自动化/views/overview.js',
  '90 模板/订阅自动化/views/detail.js',
  '90 模板/订阅自动化/views/payment.js',
  'docs/images/create-subscription.png',
  'docs/images/subscription-detail.png',
  'docs/images/payment-record.png',
  'docs/images/logo-picker.png',
  'docs/images/overview-desktop.png',
  'docs/images/overview-mobile.png'
];

for (const file of required) if (!exists(file)) fail(`缺少必要文件：${file}`);

const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});

const allFiles = walk(root);
const pluginPrograms = allFiles.filter(file =>
  rel(file).startsWith('.obsidian/plugins/') &&
  ['main.js', 'styles.css', 'manifest.json'].includes(path.basename(file))
);
if (pluginPrograms.length) fail(`仓库包含第三方插件程序：${pluginPrograms.map(rel).join(', ')}`);

for (const dataDirectory of ['30 订阅/项目', '30 订阅/_续费记录']) {
  const unexpected = walk(path.join(root, dataDirectory)).filter(file => path.basename(file) !== '.gitkeep');
  if (unexpected.length) fail(`${dataDirectory} 中存在可能的个人数据：${unexpected.map(rel).join(', ')}`);
}

const logoDirectory = path.join(root, '90 模板/订阅素材/订阅 Logo');
const logos = fs.readdirSync(logoDirectory).filter(name => name.toLowerCase().endsWith('.png'));
if (logos.length !== 79) fail(`内置 PNG Logo 数量应为 79，实际为 ${logos.length}`);
for (const name of logos) {
  const buffer = fs.readFileSync(path.join(logoDirectory, name));
  const signature = buffer.subarray(1, 4).toString('ascii');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (signature !== 'PNG' || width !== 1024 || height !== 1024) {
    fail(`Logo 规格异常：${name} (${width}x${height})`);
  }
}

const templaterFiles = allFiles.filter(file => rel(file).startsWith('90 模板/订阅自动化/') && file.endsWith('.md'));
for (const file of templaterFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const matches = [...source.matchAll(/<%\*([\s\S]*?)%>/g)];
  for (const [index, match] of matches.entries()) {
    try {
      new Function(`return async function () {\n${match[1]}\n}`);
    } catch (error) {
      fail(`${rel(file)} 的第 ${index + 1} 个 Templater 脚本无法解析：${error.message}`);
    }
  }
}

const sharedModules = allFiles.filter(file =>
  /^90 模板\/订阅自动化\/(scripts|views)\/.*\.js$/.test(rel(file))
);
for (const file of sharedModules) {
  try { new Function(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`${rel(file)} 共享脚本无法解析：${error.message}`); }
}

const textFiles = allFiles.filter(file => /\.(md|json|css|js|cjs|gitignore)$/.test(file) || path.basename(file) === '.gitignore');
const privatePatterns = [
  { regex: /\/Users\//, label: 'macOS 绝对用户路径' },
  { regex: /\/home\/[A-Za-z0-9._-]+\//, label: 'Linux 绝对用户路径' },
  { regex: /[A-Z]:\\Users\\/i, label: 'Windows 绝对用户路径' },
  { regex: /隔壁阿明|生活实验室/, label: '作者仓库标识' }
];
for (const file of textFiles) {
  if (rel(file) === 'scripts/validate-package.cjs') continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of privatePatterns) {
    if (pattern.regex.test(source)) fail(`${rel(file)} 包含${pattern.label}`);
  }
}

for (const markdownFile of ['README.md', '使用说明.md']) {
  const source = fs.readFileSync(path.join(root, markdownFile), 'utf8');
  const links = [
    ...[...source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]),
    ...[...source.matchAll(/<img\s+[^>]*src="([^"]+)"/g)].map(match => match[1])
  ];
  for (const link of links) {
    if (/^(https?:|mailto:|#)/.test(link)) continue;
    const localPath = decodeURIComponent(link.split('#')[0]);
    if (!exists(localPath)) fail(`${markdownFile} 中的本地链接不存在：${link}`);
  }
}

notes.push(`必要文件：${required.length} 项`);
notes.push(`模板脚本：${templaterFiles.length} 个文件，语法检查通过`);
notes.push(`共享脚本：${sharedModules.length} 个文件，语法检查通过`);
notes.push(`内置 Logo：${logos.length} 张，均为 1024x1024 PNG`);
notes.push('个人订阅与续费目录：仅包含 .gitkeep');
notes.push('第三方插件程序：未打包');

if (errors.length) {
  console.error('验证失败：');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('验证通过：');
for (const note of notes) console.log(`- ${note}`);
