#!/usr/bin/env python3
"""Analisa o chunk vendor para achar os módulos mais pesados."""
import re, sys
data = open('dist/assets/vendor-BLjTgNdy.js', encoding='utf-8', errors='ignore').read()

# Padrão de módulos embutidos: comentários de sourcemap não disponíveis; usar heurística
# de encontrar strings típicas de libs conhecidas e reportar
markers = [
    ('recharts', 100), ('date-fns', 200), ('framer-motion', 10), ('embla-carousel', 20),
    ('motion', 30), ('quill', 100), ('lexical', 50), ('zustand', 30), ('immer', 50),
    ('sonner', 20), ('hook-form', 30), ('zod', 100), ('radix', 50), ('lucide', 500),
    ('dnd-kit', 20), ('floating-ui', 30), ('react-markdown', 20), ('react-day-picker', 20),
    ('cmdk', 20), ('dompurify', 20), ('SheetJS', 20), ('xlsx', 100), ('pdfjs', 10),
    ('pdfjs-dist', 5), ('jspdf', 20), ('html2canvas', 20), ('react-dropzone', 10),
    ('react-virtual', 10), ('tabbable', 20), ('react-remove-scroll', 10), ('clsx', 30),
    ('tailwind-merge', 10), ('classnames', 20), ('input-otp', 10), ('vaul', 10),
    ('aria-hidden', 10), ('react-hot-toast', 5), ('react-helmet', 5), ('leaflet', 200),
    ('Leaflet', 50), ('mapbox', 10), ('turf', 10), ('geolib', 10), ('js-cookie', 10),
    ('crypto-js', 10), ('papaparse', 10), ('marked', 20), ('uuid', 20), ('qrcode', 10),
    ('libphonenumber', 10), ('validator', 50), ('decimal.js', 20), ('big.js', 20),
    ('micromark', 20), ('unified', 20), ('mdast-util', 10), ('remark-parse', 5),
    ('hast-util', 5), ('mdast-util-to-hast', 5),
]
for m, thresh in markers:
    n = data.count(m)
    if n >= thresh:
        print(f'{m}: {n} ocorrências')
