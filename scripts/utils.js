const fs = require('fs');
const path = require('path');

function sluggify(text) {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

function sanitizeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeHtml(filePath, html) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, html, 'utf-8');
  console.log(`  ✓ ${filePath}`);
}

function parseNotionRichText(richTextArray) {
  if (!richTextArray || richTextArray.length === 0) return '';
  return richTextArray.map(rt => {
    let text = rt.plain_text || '';
    if (rt.annotations?.bold) text = `<strong>${text}</strong>`;
    if (rt.annotations?.italic) text = `<em>${text}</em>`;
    if (rt.annotations?.code) text = `<code>${text}</code>`;
    if (rt.href) text = `<a href="${rt.href}" target="_blank" rel="noopener">${text}</a>`;
    return text;
  }).join('');
}

function extractNotionTitle(property) {
  if (!property) return '';
  if (property.type === 'title') return parseNotionRichText(property.title);
  if (property.type === 'rich_text') return parseNotionRichText(property.rich_text);
  if (property.type === 'select') return property.select?.name || '';
  if (property.type === 'multi_select') return property.multi_select?.map(s => s.name).join(', ') || '';
  if (property.type === 'url') return property.url || '';
  return '';
}

module.exports = { sluggify, sanitizeHtml, ensureDir, writeHtml, parseNotionRichText, extractNotionTitle };
