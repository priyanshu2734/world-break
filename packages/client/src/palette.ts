export const COLOR = {
  void: 0x04070d,
  cyan: 0x3de8ff,
  cyanDim: 0x0e5b6b,
  amber: 0xffb02e,
  amberDim: 0x6b4608,
  danger: 0xff4d4d,
  text: '#d8f6ff',
} as const;
export const FONT = { fontFamily: '"Share Tech Mono", "Courier New", monospace' };

/** One identity colour per player slot (stable for the whole run). */
export const SLOT_COLORS = [0x3de8ff, 0xffb02e, 0xff5ccf, 0x9dff5c] as const;
export const SLOT_HEX = ['#3de8ff', '#ffb02e', '#ff5ccf', '#9dff5c'] as const;
