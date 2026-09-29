"""Genera build/icon.png (1024x1024): rejilla de commits sobre degradado."""
from PIL import Image, ImageDraw
import math
S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
# degradado diagonal
grad = Image.new('RGBA', (S, S))
px = grad.load()
c1, c2 = (32, 41, 82), (86, 116, 235)
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * S)
        px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((40, 40, S - 40, S - 40), radius=210, fill=255)
img.paste(grad, (0, 0), mask)
d = ImageDraw.Draw(img)
white = (255, 255, 255, 255)
green = (78, 201, 138, 255)
orange = (240, 146, 90, 255)
W = 30
# rama principal
d.line([(380, 250), (380, 780)], fill=white, width=W)
# rama lateral (curva)
pts = []
for i in range(31):
    t = i / 30
    x = 380 + 250 * (1 - (1 - t) ** 2)
    y = 400 + 220 * t
    pts.append((x, y))
d.line(pts, fill=green, width=W, joint='curve')
pts = []
for i in range(31):
    t = i / 30
    x = 630 - 250 * (t ** 2)
    y = 700 + 90 * t
    pts.append((x, y))
def node(x, y, r, col):
    d.ellipse((x - r - 14, y - r - 14, x + r + 14, y + r + 14), fill=(24, 30, 60, 255))
    d.ellipse((x - r, y - r, x + r, y + r), fill=col)
node(380, 250, 46, white)
node(380, 470, 46, white)
node(380, 780, 46, white)
node(630, 620, 46, green)
# punta de "brújula": flecha hacia arriba-derecha
d.polygon([(720, 230), (800, 330), (735, 315), (700, 380), (680, 300)], fill=orange)
img.save('build/icon.png')
print('ok')
