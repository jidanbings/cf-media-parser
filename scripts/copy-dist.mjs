#!/usr/bin/env node
/**
 * 构建产物复制脚本
 *
 * 用法:
 *   node scripts/copy-dist.mjs              # 复制部署文件到 dist/
 *   node scripts/copy-dist.mjs --to-dash    # 复制 dist/ 全部内容到 ../dash/（手动上传用）
 *
 * 部署产物清单（共 10 个）:
 *   _worker.js          打包后的 Worker
 *   _routes.json        路由配置
 *   index.html          首页（三平台入口）
 *   douyin.html         抖音解析页
 *   kuaishou.html       快手解析页
 *   bilibili.html       哔哩哔哩解析页
 *   assets/warmth.css   设计系统样式
 *   assets/warmth.js    公共脚本
 *   assets/parse.css    解析页样式
 *   assets/parse.js     解析页逻辑
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const toDash = process.argv.includes('--to-dash');
const dash = path.resolve(root, '..', 'dash');

/** 需要复制的静态文件（相对仓库根目录） */
const STATIC_FILES = [
  'index.html',
  'douyin.html',
  'kuaishou.html',
  'bilibili.html',
  '_routes.json',
  'assets/warmth.css',
  'assets/warmth.js',
  'assets/parse.css',
  'assets/parse.js'
];

/**
 * 历史上产出过、现已从仓库删除的文件
 *
 * dist/ 不会被整体清空，所以升级后可能残留这些旧文件；
 * 复制时顺带清理，避免把废弃页面一起部署上去。
 */
const STALE_FILES = [
  'assets/academia.css',
  'assets/academia.js',
  // v5.0.0 收敛为三平台，旧页面不再产出
  'video.html',
  'music.html',
  'option.html'
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** 递归收集目录下所有文件的相对路径 */
function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

function copyStatic(targetDir) {
  let count = 0;
  for (const rel of STATIC_FILES) {
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) {
      console.warn(`  ! 跳过缺失文件: ${rel}`);
      continue;
    }
    const dest = path.join(targetDir, rel);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    count++;
  }
  return count;
}

/**
 * 清理由旧版本遗留、当前已不再产出的文件
 * （例如重命名后的 assets/academia.*）
 */
function pruneStale(targetDir) {
  const removed = [];
  for (const rel of STALE_FILES) {
    const p = path.join(targetDir, rel);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
      removed.push(rel);
    }
  }
  // 清掉 assets/ 下的空目录残留
  const assetsDir = path.join(targetDir, 'assets');
  if (fs.existsSync(assetsDir) && fs.readdirSync(assetsDir).length === 0) {
    fs.rmdirSync(assetsDir);
  }
  return removed;
}

/* ---------- 主流程 ---------- */

if (!toDash) {
  // 阶段一：把静态资源复制进 dist/
  ensureDir(dist);
  const pruned = pruneStale(dist);
  if (pruned.length) console.log(`✓ 已清理陈旧文件: ${pruned.join(', ')}`);

  const n = copyStatic(dist);
  console.log(`✓ 已复制 ${n} 个静态文件到 dist/`);

  if (!fs.existsSync(path.join(dist, '_worker.js'))) {
    console.warn('  ! dist/_worker.js 不存在，请先执行 npm run build');
  }
  console.log('\ndist/ 内容:');
  for (const f of walk(dist).sort()) {
    const size = fs.statSync(path.join(dist, f)).size;
    console.log(`  - ${f.padEnd(28)} ${(size / 1024).toFixed(1)} KB`);
  }
} else {
  // 阶段二：把 dist/ 全量同步到 dash/（供 Cloudflare Pages 手动上传）
  //
  // 注意：dash/ 是 dist/ 的镜像。为避免同步到过期的页面副本，
  // 这里先从仓库根目录刷新 dist/ 中的静态文件，再整体复制。
  if (!fs.existsSync(dist)) {
    console.error('✗ dist/ 不存在，请先执行 npm run build:dist');
    process.exit(1);
  }

  const refreshed = copyStatic(dist);
  console.log(`✓ 已从源码刷新 dist/ 中的 ${refreshed} 个静态文件`);

  const pruned = pruneStale(dist);
  if (pruned.length) console.log(`✓ 已清理陈旧文件: ${pruned.join(', ')}`);

  if (!fs.existsSync(path.join(dist, '_worker.js'))) {
    console.warn('  ! dist/_worker.js 不存在，请先执行 npm run build');
  }

  fs.rmSync(dash, { recursive: true, force: true });
  ensureDir(dash);

  let n = 0;
  for (const rel of walk(dist)) {
    const dest = path.join(dash, rel);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(path.join(dist, rel), dest);
    n++;
  }

  console.log(`✓ 已同步 ${n} 个部署文件到 dash/`);
  console.log('\ndash/ 内容（手动上传 Cloudflare Pages 时全选这些文件）:');
  for (const f of walk(dash).sort()) {
    const size = fs.statSync(path.join(dash, f)).size;
    console.log(`  - ${f.padEnd(28)} ${(size / 1024).toFixed(1)} KB`);
  }
}
