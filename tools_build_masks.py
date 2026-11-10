# Builds the larger recolour area (helmet + shoe accents added to 遊戲模組部門's vest/chalk-bag/glove mask).
# Teal pixels of the base sheet are converted to bright greyscale (so base*colour reads as the team colour)
# and added to the mask. Output: assets/{male,female}_tb.png (base) + _tm.png (mask). Originals stay untouched.
from PIL import Image
import colorsys, sys
d = sys.argv[1] if len(sys.argv) > 1 else 'assets'
for k in ['male', 'female']:
    b = Image.open(f'{d}/{k}.png').convert('RGBA'); m = Image.open(f'{d}/{k}_mask.png').convert('RGBA')
    bp, mp = b.load(), m.load(); n = 0
    for y in range(b.size[1]):
        for x in range(b.size[0]):
            r, g, bl, a = bp[x, y]
            if a < 8: continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, bl / 255)
            if 0.43 < h < 0.56 and s > 0.35 and v > 0.3:
                L = 0.3 * r + 0.59 * g + 0.11 * bl; gv = int(min(255, L * 1.45 + 45))
                bp[x, y] = (gv, gv, gv, a); mr, mg, mb, ma = mp[x, y]; mp[x, y] = (255, 255, 255, max(ma, a)); n += 1
    b.save(f'{d}/{k}_tb.png', optimize=True); m.save(f'{d}/{k}_tm.png', optimize=True); print(k, 'teal px added', n)
