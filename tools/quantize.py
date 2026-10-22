# Shrinks a TensorFlow.js layers model by storing its weights as 8-bit (uint8) or 16-bit floats (float16).
# The browser expands them again when loading (TensorFlow.js reads the "quantization" entries), so no app code changes.
# Usage: python3 tools/quantize.py <model folder> <output folder> [uint8|float16]
import json, sys, os, struct
import numpy as np
src, dst = sys.argv[1], sys.argv[2]; dtype = sys.argv[3] if len(sys.argv) > 3 else 'uint8'
m = json.load(open(os.path.join(src, 'model.json')))
os.makedirs(dst, exist_ok=True)
for gi, group in enumerate(m['weightsManifest']):
    raw = b''.join(open(os.path.join(src, p), 'rb').read() for p in group['paths'])
    off = 0; out = bytearray()
    for w in group['weights']:
        n = int(np.prod(w['shape'])) if w['shape'] else 1
        assert w.get('dtype', 'float32') == 'float32' and 'quantization' not in w, w['name']
        a = np.frombuffer(raw, dtype='<f4', count=n, offset=off); off += 4 * n
        if dtype == 'float16':
            out += a.astype('<f2').tobytes(); w['quantization'] = {'dtype': 'float16', 'original_dtype': 'float32'}
        else:
            lo, hi = float(a.min()), float(a.max()); scale = (hi - lo) / 255 if hi > lo else 1.0
            q = np.clip(np.round((a - lo) / scale), 0, 255).astype(np.uint8)
            out += q.tobytes(); w['quantization'] = {'dtype': 'uint8', 'min': lo, 'scale': scale, 'original_dtype': 'float32'}
    name = f'group{gi + 1}-shard1of1.bin'; open(os.path.join(dst, name), 'wb').write(out); group['paths'] = [name]
json.dump(m, open(os.path.join(dst, 'model.json'), 'w'))
print(f"{src}: {sum(os.path.getsize(os.path.join(src, f)) for f in os.listdir(src))//1024} KB -> {sum(os.path.getsize(os.path.join(dst, f)) for f in os.listdir(dst))//1024} KB ({dtype})")
