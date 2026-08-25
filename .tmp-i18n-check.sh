#!/bin/bash
# 临时脚本：找 fork 独有 i18n key（zh-CN vs 上游）并检查代码引用
cd /d/GitHub/paseo.me
git show v0.6.0:packages/app/src/i18n/resources/zh-CN.ts > /tmp/zh-cn-upstream.ts
git show local/v0.5.2:packages/app/src/i18n/resources/zh-CN.ts > /tmp/zh-cn-fork.ts

# 提取两边所有 key 路径（叶子 key），用点号连接
extract_keys() {
  local file="$1"
  node -e "
const ts = require('fs').readFileSync('$file', 'utf8');
// 去掉 import/export 语句和类型，用正则粗提取叶子字符串 key 不太可靠；
// 改用简单方法：借助 esbuild 不在，就用 tsc 不现实——直接用 require 不行（TS）。
// 实用方法：按缩进层级解析对象字面量 key 路径。
const lines = ts.split('\n');
const stack = [];
const keys = [];
for (const line of lines) {
  const indent = (line.match(/^\s*/) || [''])[0].length;
  const objectOpen = /[{,]\s*$/.test(line) && /(\w+|\"[^\"]+\")\s*:?\s*\{/.test(line);
  const m = line.match(/^\s*(\w+|\"[^\"]+\")\s*:\s*\{/) || line.match(/^\s*(\w+|\"[^\"]+\")\s*\{/) || (/\{\s*$/.test(line) ? line.match(/^\s*(\w+|\"[^\"]+\")\s*:\s*\{/) : null);
  const leaf = line.match(/^\s*(\w+|\"[^\"]+\")\s*:\s*[\"'{\[]/);
  // 简化：任何 'key:' 行
  const km = line.match(/^\s*(?:\w+|\"[^\"]+\")(?=\s*:)/g);
  while (stack.length && indent <= stack[stack.length-1].indent) stack.pop();
  if (km) {
    const k = km[km.length-1].replace(/\"/g, '');
    const path = [...stack.map(s=>s.key), k].join('.');
    keys.push(path);
    if (/\{\s*$/.test(line)) stack.push({indent, key: k});
  } else if (/\{\s*$/.test(line) && /(\w+)\s*:?\s*\{/.test(line)) {
    const nm = line.match(/(\w+|\"[^\"]+\")\s*:?\s*\{\s*$/);
    if (nm) stack.push({indent, key: nm[1].replace(/\"/g,'')});
  }
}
console.log(keys.join('\n'));
"
}
extract_keys /tmp/zh-cn-fork.ts | sort > /tmp/keys-fork.txt
extract_keys /tmp/zh-cn-upstream.ts | sort > /tmp/keys-upstream.txt
comm -23 /tmp/keys-fork.txt /tmp/keys-upstream.txt > /tmp/keys-forkonly.txt
echo "=== fork 独有 key（$(wc -l < /tmp/keys-forkonly.txt) 个），检查代码引用 ==="
while IFS= read -r key; do
  # 取 key 的各段，最后两段拼成 t() 常见引用形态
  last2=$(echo "$key" | awk -F. '{if (NF>=2) print $(NF-1) "." $NF; else print $NF}')
  last1=$(echo "$key" | awk -F. '{print $NF}')
  # 在 app src 里查 t("...last2") 或 last1 引用（粗查）
  hits=$(grep -rl "$last1" packages/app/src --include='*.ts' --include='*.tsx' | grep -v 'i18n/resources' | wc -l)
  echo "$hits  $key"
done < /tmp/keys-forkonly.txt
