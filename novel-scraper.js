// 小说爬虫工具 - 仅用于爬取公开免费内容作个人学习参考
// 用法:
//   单章: node novel-scraper.js <章节URL> [输出目录]
//   批量: node novel-scraper.js --batch <目录页URL> [输出目录]
//   交互: node novel-scraper.js

const fs = require('fs');
const path = require('path');

const DEFAULT_OUTPUT = path.join(process.env.USERPROFILE || process.env.HOME, '小说素材/原文');
const DELAY_MS = 1500; // 每章请求间隔，避免给服务器造成压力

// ====== 工具函数 ======

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(html) {
  return html
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名';
}

// ====== 章节内容提取 ======

function extractChapter(url, html) {
  // 1) 提取标题
  let title = '';
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    title = cleanText(h1Match[1]);
  } else {
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = cleanText(titleMatch[1]).split(/[-_|]/)[0].trim();
    }
  }

  // 2) 提取正文 - 尝试多种常见容器
  let content = '';
  const patterns = [
    /<div[^>]*id\s*=\s*["']content["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class\s*=\s*["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id\s*=\s*["']chaptercontent["'][^>]*>([\s\S]*?)<\/div>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*class\s*=\s*["'][^"']*article[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id\s*=\s*["']txt["'][^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      content = match[1];
      break;
    }
  }

  // Fallback: 取 body 中最长的文本块
  if (!content) {
    const bodyMatch = html.match(/<body[\s\S]*?>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      // 去掉 script/style/nav/header/footer
      const body = bodyMatch[1]
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '');
      content = body;
    }
  }

  content = cleanText(content);

  return { title, content, url };
}

// ====== 目录页解析 ======

function extractChapterList(html, baseUrl) {
  // 提取所有可能的章节链接
  const linkPattern = /<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const chapters = [];
  let match;

  while ((match = linkPattern.exec(html)) !== null) {
    let href = match[1];
    const text = cleanText(match[2]);

    // 过滤明显不是章节的链接
    if (text.length < 2) continue;
    if (/首页|下一页|上一页|目录|返回|登录|注册|搜索|排行|下载|书架/.test(text)) continue;

    // 补全相对URL
    if (href.startsWith('/')) {
      const urlObj = new URL(baseUrl);
      href = urlObj.origin + href;
    } else if (!href.startsWith('http')) {
      const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
      href = base + href;
    }

    chapters.push({ title: text, url: href });
  }

  return chapters;
}

// ====== 下载章节 ======

async function downloadChapter(url) {
  console.log(`  下载中: ${url}`);
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} - ${resp.url}`);
  }

  // 尝试按 UTF-8 读取，失败时可能是 GBK
  let html;
  try {
    const buffer = await resp.arrayBuffer();
    html = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    const buffer = await resp.arrayBuffer();
    try {
      html = new TextDecoder('gbk').decode(buffer);
    } catch {
      html = new TextDecoder('gb2312').decode(buffer);
    }
  }

  return extractChapter(url, html);
}

// ====== 主流程 ======

async function scrapeSingle(url, outputDir) {
  console.log(`\n  单章下载模式`);
  const ch = await downloadChapter(url);

  if (!ch.content) {
    console.error('  未能提取到正文内容，URL可能需要手动检查');
    return;
  }

  const filename = `${safeFilename(ch.title)}.txt`;
  const filePath = path.join(outputDir, filename);
  fs.mkdirSync(outputDir, { recursive: true });

  const fileContent = `${ch.title}\n${'='.repeat(40)}\n来源: ${url}\n\n${ch.content}`;
  fs.writeFileSync(filePath, fileContent, 'utf-8');

  console.log(`  已保存: ${filePath}`);
  console.log(`  标题: ${ch.title}`);
  console.log(`  字数: ${ch.content.length} 字`);
}

async function scrapeBatch(listUrl, outputDir) {
  console.log(`\n  批量下载模式`);
  console.log(`  正在读取目录页: ${listUrl}`);

  const resp = await fetch(listUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  const html = await resp.text();
  const chapters = extractChapterList(html, listUrl);

  if (chapters.length === 0) {
    console.error('  未在目录页中找到章节链接');
    return;
  }

  // 去重
  const seen = new Set();
  const unique = chapters.filter(ch => {
    const key = ch.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`  找到 ${unique.length} 个章节链接\n`);

  const bookName = safeFilename(
    (html.match(/<title>([\s\S]*?)<\/title>/i) || ['', '未命名小说'])[1]
      .replace(/[-_|].*$/, '').trim()
  );
  const bookDir = path.join(outputDir, bookName);
  fs.mkdirSync(bookDir, { recursive: true });

  let success = 0;
  let fail = 0;

  for (let i = 0; i < unique.length; i++) {
    const ch = unique[i];
    const idx = String(i + 1).padStart(4, '0');
    const filename = `${idx}_${safeFilename(ch.title)}.txt`;
    const filePath = path.join(bookDir, filename);

    console.log(`[${i + 1}/${unique.length}] ${ch.title}`);

    try {
      const chapter = await downloadChapter(ch.url);

      const fileContent = `${chapter.title}\n${'='.repeat(40)}\n来源: ${ch.url}\n\n${chapter.content}`;
      fs.writeFileSync(filePath, fileContent, 'utf-8');
      console.log(`  OK (${chapter.content.length}字)`);
      success++;
    } catch (err) {
      console.error(`  失败: ${err.message}`);
      fail++;
    }

    // 礼貌延迟
    if (i < unique.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n  完成: ${success} 成功, ${fail} 失败`);
  console.log(`  保存位置: ${bookDir}`);
}

// ====== 交互模式 ======

async function interactive() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  function question(prompt) {
    return new Promise(resolve => rl.question(prompt, resolve));
  }

  console.log('\n  小说爬虫工具');
  console.log('  ────────────');
  console.log('  仅用于公开免费站点的个人学习参考\n');

  const mode = await question('  模式: [1] 单章下载  [2] 批量下载 (输入1或2): ');

  if (mode === '1') {
    const url = await question('  请输入章节URL: ');
    rl.close();
    await scrapeSingle(url, DEFAULT_OUTPUT);
  } else if (mode === '2') {
    const url = await question('  请输入目录页URL: ');
    const out = await question(`  输出目录 (回车默认: ${DEFAULT_OUTPUT}): `);
    rl.close();
    await scrapeBatch(url, out || DEFAULT_OUTPUT);
  } else {
    console.log('  无效选择');
    rl.close();
  }
}

// ====== 入口 ======

(async () => {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await interactive();
  } else if (args[0] === '--batch' && args[1]) {
    await scrapeBatch(args[1], args[2] || DEFAULT_OUTPUT);
  } else {
    await scrapeSingle(args[0], args[1] || DEFAULT_OUTPUT);
  }
})();
