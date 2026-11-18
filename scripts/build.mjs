// 정적 호스팅(CDN)용: 브라우저가 쓰는 라이브러리·공용 모듈을 public/ 아래로 복사한다.
// (로컬에서 `npm start` 로 띄울 때는 서버가 같은 경로를 직접 제공하므로 필요 없음)
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const copies = [
  ['node_modules/three/build/three.module.js', 'public/vendor/three/build/three.module.js'],
  ['node_modules/three/build/three.core.js', 'public/vendor/three/build/three.core.js'],
  ['node_modules/three/examples/jsm/controls/OrbitControls.js', 'public/vendor/three/examples/jsm/controls/OrbitControls.js'],
  ['node_modules/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css', 'public/vendor/pretendard/pretendardvariable-dynamic-subset.css'],
  ['node_modules/pretendard/dist/web/variable/woff2-dynamic-subset', 'public/vendor/pretendard/woff2-dynamic-subset'],
  ['shared', 'public/shared'],
];

await rm(path.join(root, 'public/vendor'), { recursive: true, force: true });
await rm(path.join(root, 'public/shared'), { recursive: true, force: true });
for (const [from, to] of copies) {
  await mkdir(path.dirname(path.join(root, to)), { recursive: true });
  await cp(path.join(root, from), path.join(root, to), { recursive: true });
}
console.log(`copied ${copies.length} entries into public/`);
