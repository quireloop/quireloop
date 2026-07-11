import { useEffect, useRef } from 'react';

// LaTeX-flavored symbols scattered across the canvas, each tethered to a
// resting point by an invisible "string" — moving the cursor near one
// plucks it away from its anchor and it springs back, Stanford-homepage
// style, just built from \int and \alpha instead of literal wire letters.
const SYMBOLS = [
  '\\int', '\\sum', '\\prod', '\\sqrt{x}', '\\frac{a}{b}', '\\partial',
  '\\nabla', '\\infty', '\\alpha', '\\beta', '\\gamma', '\\theta', '\\lambda',
  '\\pi', '\\Omega', '\\Sigma', '\\Delta', '\\epsilon', '\\phi', '\\psi',
  '\\forall', '\\exists', '\\in', '\\subset', '\\otimes', '\\approx',
  '\\cite{}', '\\ref{}', '\\label{}', '\\begin{eq}', '\\end{eq}',
  '\\mathbb{R}', '\\mathcal{L}', '\\LaTeX', '\\times', '\\cdot', '\\pm',
  '\\leq', '\\geq', '\\rightarrow', '\\emptyset', '\\cup', '\\cap', '\\hbar',
];

const SPRING_K = 0.02;
const DAMPING = 0.9;
const REPEL_RADIUS = 140;
const REPEL_STRENGTH = 2200;

export default function ReactiveBackground({ dark }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const ctx = canvas.getContext('2d');
    const mouse = { x: -9999, y: -9999, active: false };
    let nodes = [];
    let width = 0;
    let height = 0;
    let rafId = null;
    let t = 0;

    function initNodes() {
      const count = Math.max(16, Math.min(60, Math.floor((width * height) / 34000)));
      nodes = Array.from({ length: count }, () => {
        const bx = Math.random() * width;
        const by = Math.random() * height;
        return {
          symbol: SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
          baseX: bx,
          baseY: by,
          x: bx,
          y: by,
          vx: 0,
          vy: 0,
          fontSize: 13 + Math.random() * 13,
          phase: Math.random() * Math.PI * 2,
          speed: 0.3 + Math.random() * 0.4,
          driftR: 6 + Math.random() * 12,
        };
      });
    }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initNodes();
    }

    function handlePointerMove(e) {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    }
    function handlePointerLeave() {
      mouse.active = false;
    }

    const stringColor = dark ? '150, 160, 190' : '120, 120, 150';
    const glowColor = dark ? '255, 205, 130' : '90, 70, 220';
    const textColor = dark ? '215, 218, 232' : '85, 85, 105';

    function tick() {
      t += 1;
      ctx.clearRect(0, 0, width, height);

      for (const n of nodes) {
        const driftX = n.baseX + Math.cos(t * 0.01 * n.speed + n.phase) * n.driftR;
        const driftY = n.baseY + Math.sin(t * 0.013 * n.speed + n.phase) * n.driftR;

        let fx = (driftX - n.x) * SPRING_K;
        let fy = (driftY - n.y) * SPRING_K;
        let glow = 0;

        if (mouse.active) {
          const dx = n.x - mouse.x;
          const dy = n.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
          if (dist < REPEL_RADIUS) {
            const force = ((1 - dist / REPEL_RADIUS) * REPEL_STRENGTH) / (dist * dist + 400);
            fx += (dx / dist) * force;
            fy += (dy / dist) * force;
            glow = 1 - dist / REPEL_RADIUS;
          }
        }

        n.vx = (n.vx + fx) * DAMPING;
        n.vy = (n.vy + fy) * DAMPING;
        n.x += n.vx;
        n.y += n.vy;

        // The tether — a faint line back to the resting point that
        // stretches as the cursor pulls the symbol away from it.
        ctx.beginPath();
        ctx.moveTo(n.baseX, n.baseY);
        ctx.lineTo(n.x, n.y);
        ctx.strokeStyle = `rgba(${stringColor}, ${0.05 + glow * 0.25})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.font = `${n.fontSize}px ui-monospace, "SF Mono", monospace`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.shadowColor = `rgba(${glowColor}, ${glow})`;
        ctx.shadowBlur = 4 + glow * 24;
        ctx.fillStyle = glow > 0.02 ? `rgba(${glowColor}, ${0.35 + glow * 0.6})` : `rgba(${textColor}, 0.3)`;
        ctx.fillText(n.symbol, n.x, n.y);
      }
      ctx.shadowBlur = 0;

      rafId = requestAnimationFrame(tick);
    }

    function handleVisibility() {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
        rafId = null;
      } else if (!rafId) {
        tick();
      }
    }

    resize();
    tick();

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerleave', handlePointerLeave);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [dark]);

  return (
    <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} />
  );
}
