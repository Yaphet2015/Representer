import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { chromeKV, KEYS } from '@/lib/storage';
import { clampWidth, DEFAULT_WIDTH, viewportWidth } from '@/lib/width';

type Ev = PointerEvent<HTMLDivElement>;

/** Panel width: drag the left-edge handle (pointer capture), double-click resets, persisted in storage. */
export function useResizableWidth() {
  const [width, setWidthState] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const lastDown = useRef(0);
  const moved = useRef(false);
  const setWidth = (w: number) => { widthRef.current = w; setWidthState(w); };
  const save = (w: number) => chromeKV.set(KEYS.panelWidth, w);

  useEffect(() => {
    chromeKV.get(KEYS.panelWidth).then((w) => { if (typeof w === 'number') setWidth(clampWidth(w, viewportWidth())); });
    const onResize = () => setWidth(clampWidth(widthRef.current, viewportWidth()));
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  const reset = () => { setWidth(clampWidth(DEFAULT_WIDTH, viewportWidth())); save(DEFAULT_WIDTH); };
  const onPointerDown = (e: Ev) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Manual double-click detection: pointer capture + preventDefault can swallow the native dblclick.
    if (e.detail >= 2 || (e.timeStamp - lastDown.current < 350 && !moved.current)) { lastDown.current = 0; reset(); return; }
    lastDown.current = e.timeStamp; moved.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: widthRef.current };
    setResizing(true);
  };
  const onPointerMove = (e: Ev) => {
    if (!drag.current) return;
    if (Math.abs(e.clientX - drag.current.x) > 2) moved.current = true;
    setWidth(clampWidth(drag.current.w + (drag.current.x - e.clientX), viewportWidth())); // right-anchored: drag left = wider
  };
  const endDrag = (e: Ev) => {
    if (!drag.current) return;
    drag.current = null; setResizing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    save(widthRef.current);
  };
  const handleProps = {
    onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag,
    onMouseDown: (e: React.MouseEvent) => { if (e.detail === 2) reset(); },
  };
  return { width, resizing, handleProps };
}
