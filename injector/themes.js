// Theme manifest 加载与编译:extends 继承链 + variables/customCss 合并 → 最终 CSS 字符串。
import fs from 'node:fs';
import path from 'node:path';

/**
 * 加载一个主题并解析 extends 继承链。
 * 合并规则:variables 子级覆盖父级;customCss 父级在前、子级在后;mode 子级优先。
 */
export function loadTheme(name, skinsDir, seen = new Set()) {
  if (seen.has(name)) {
    throw new Error(`主题继承成环: ${[...seen, name].join(' -> ')}`);
  }
  seen.add(name);

  const file = path.join(skinsDir, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`找不到主题 "${name}"(${file});可用主题: ${listThemes(skinsDir).join(', ')}`);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));

  let base = { variables: {}, customCss: [], mode: null };
  if (raw.extends) base = loadTheme(raw.extends, skinsDir, seen);

  return {
    id: name,
    name: raw.name ?? name,
    variables: { ...base.variables, ...(raw.variables ?? {}) },
    customCss: [...base.customCss, ...(raw.customCss ?? [])],
    mode: raw.mode ?? base.mode,
  };
}

/** 把解析后的主题编译成一段注入用 CSS */
export function compileCss(theme) {
  const parts = [`/* Claude Dream Skin — ${theme.name} */`];

  const entries = Object.entries(theme.variables);
  if (entries.length > 0) {
    // 同时打在 :root 和 body 上并加 !important:
    // 应用会在 body/.darkTheme 上重定义变量,元素自有值优先于继承值,只覆盖 :root 会被压住
    parts.push(':root, html, body, body.darkTheme {');
    for (const [key, value] of entries) {
      parts.push(`  ${key}: ${value} !important;`);
    }
    parts.push('}');
  }

  // customCss 兜底层排在变量层之后,用于覆盖硬编码色值等变量够不着的地方
  if (theme.customCss.length > 0) {
    parts.push(theme.customCss.join('\n'));
  }

  return parts.join('\n');
}

/** 列出 skins 目录下所有主题 id */
export function listThemes(skinsDir) {
  try {
    return fs.readdirSync(skinsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.basename(f, '.json'))
      .sort();
  } catch {
    return [];
  }
}
