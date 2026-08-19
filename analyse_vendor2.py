#!/usr/bin/env python3
"""Busca assinaturas de libs conhecidas dentro do vendor chunk."""
import re
d = open('dist/assets/vendor-BLjTgNdy.js', encoding='utf-8', errors='ignore').read()
# Assinaturas típicas
sigs = [
    ('recharts', ['recharts', 'ResponsiveContainer', 'LineChart']),
    ('date-fns', ['YYYY', 'yyyy-MM-dd', 'parseISO']),
    ('framer-motion', ['framer-motion', 'useMotionValue', 'Presence']),
    ('embla', ['EmblaCarousel', 'emblaCarousel']),
    ('quill', ['ql-toolbar', 'Quill']),
    ('lexical', ['LexicalEditor', 'createEditor']),
    ('zustand', ['zustand', 'createStore', 'useSyncExternalStore']),
    ('immer', ['immer', 'produce', 'draft']),
    ('sonner', ['toast', 'Sonner']),
    ('hookform', ['useForm', 'react-hook-form']),
    ('zod', ['ZodSchema', 'zod']),
    ('radix-dialog', ['AlertDialog', 'DialogPrimitive', 'radix']),
    ('lucide', ['lucide', 'createLucideIcon']),
    ('dnd-kit', ['dnd-kit', 'useDroppable', 'DndContext']),
    ('floating-ui', ['floating-ui', 'computePosition', 'useFloating']),
    ('react-markdown', ['react-markdown', 'Markdown']),
    ('react-day-picker', ['DayPicker', 'react-day-picker']),
    ('cmdk', ['cmdk', 'Command']),
    ('dompurify', ['DOMPurify', 'DOMPURIFY']),
    ('xlsx', ['SheetJS', 'XLSX']),
    ('pdfjs-core', ['pdfjs-dist', 'getDocument', 'PDFDocumentProxy']),
    ('html2canvas', ['html2canvas']),
    ('jspdf', ['jspdf', 'jsPDF']),
    ('react-dropzone', ['react-dropzone', 'useDropzone']),
    ('react-virtual', ['react-virtual', 'useVirtualizer']),
    ('tabbable', ['tabbable']),
    ('react-remove-scroll', ['remove-scroll']),
    ('react-helmet', ['helmet', 'Helmet']),
    ('leaflet', ['Leaflet', 'L.map(']),
    ('react-router', ['react-router', 'BrowserRouter', 'useNavigate']),
    ('aria-hidden', ['aria-hidden', 'ariaHider']),
    ('uuid', ['uuid']),
    ('marked', ['marked', 'parse']),
    ('input-otp', ['input-otp', 'OTPInput']),
    ('vaul', ['vaul', 'Drawer']),
    ('tailwind-merge', ['tailwind-merge', 'twMerge']),
    ('classnames', ['classnames', 'clsx']),
    ('react-big-calendar', ['big-calendar', 'Calendar']),
    ('chartjs', ['chart.js', 'Chart']),
    ('decimal', ['decimal.js', 'Decimal']),
]
for name, terms in sigs:
    hits = sum(d.count(t) for t in terms)
    if hits >= 5:
        print(f'{name}: {hits}')
