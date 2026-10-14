#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 three.min.js / blob.js / nailong2-model.js 内联进预览页，
   产出可离线打开的单文件 HTML。"""
import io, os, sys

D = '/root/nnnnlll/game/fps/test'
SRC = os.path.join(D, 'nailong2-page-src.html')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/sdcard/Download/nailong/nailong-v2.0.html'

def rd(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()

three = rd(os.path.join(D, 'lib', 'three.min.js'))
blob  = rd(os.path.join(D, 'blob.js'))
baked = rd(os.path.join(D, 'nailong2-baked.js'))
model = rd(os.path.join(D, 'nailong2-model.js'))
page  = rd(SRC)

# blob.js 与 model 都走 UMD，浏览器环境下把自己挂到 window。
# blob.js 挂 window.BLOB，model 挂 window.buildNailong —— 已由 UMD 处理。

for tag, code in (('__THREE__', three), ('__BLOB__', blob),
                  ('__BAKED__', baked), ('__MODEL__', model)):
    if tag not in page:
        raise SystemExit('占位符缺失: ' + tag)
    page = page.replace(tag, code, 1)

# 防止 </script> 出现在内联代码里把标签提前闭合
page = page.replace('</script>', '<\\/script>') if False else page

with io.open(OUT, 'w', encoding='utf-8') as f:
    f.write(page)

print('OK ->', OUT)
print('size = %.1f KB' % (os.path.getsize(OUT) / 1024.0))
