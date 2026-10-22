# Find the pressed mark inside an upright chocolate close-up: the densest patch of fine edges near the middle.
import numpy as np
from scipy import ndimage as ndi
def locate(gray):
    S = gray.shape[0]; g = ndi.gaussian_filter(gray.astype(np.float32), 1.0)
    mag = np.hypot(ndi.sobel(g, 1), ndi.sobel(g, 0))
    fine = mag - ndi.gaussian_filter(mag, 6)                 # keep thin strokes, drop broad edges/shading
    dens = ndi.gaussian_filter(np.clip(fine, 0, None), S * 0.07)
    yy, xx = np.mgrid[0:S, 0:S] / S
    dens *= np.exp(-(((xx - .5) ** 2 + (yy - .52) ** 2) / (2 * .2 ** 2)))   # prefer the middle
    y, x = np.unravel_index(np.argmax(dens), dens.shape)
    return x / S, y / S
