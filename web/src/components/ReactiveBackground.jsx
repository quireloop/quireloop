import { useEffect, useRef } from 'react';

// A constellation of real mathematical notation — the way a citation graph
// or a knowledge graph looks, built out of the actual symbols researchers
// stare at all day. Nodes drift gently, tether to a resting point, and pull
// toward the cursor when it passes near; nearby nodes link up into a faint
// graph, and the links closest to the cursor brighten, like current running
// through the network. A soft spotlight follows the pointer for depth.
const GLYPHS = [
  '∫', '∑', '∏', '√', '∂', '∇', '∞', '∀', '∃', '∈', '⊂', '⊗', '≈', '≤', '≥',
  '×', '±', '⋅', '→', '∪', '∩', 'α', 'β', 'γ', 'θ', 'λ', 'π', 'Ω', 'Σ', 'Δ',
  'ε', 'φ', 'ψ', 'ħ', 'μ', '⟨ψ|', '∅',
];

const EQUATIONS = [
  'E = mc²', 'a² + b² = c²', '∇·B = 0', 'H|ψ⟩ = E|ψ⟩', 'F = ma',
  'e^{iπ} + 1 = 0', 'lim 1/x = 0', 'P(A|B)', '∀ε ∃δ', 'argmin L(θ)',
  'χ² test', 'O(n log n)', '∇×E = -∂B/∂t', 'σ² = Var(X)', 'p < 0.05',
];

function buildPool() {
  // Weighted so single glyphs (small, plentiful) outnumber full equations
  // (larger, rarer) — mirrors how a page of notes actually looks.
  const pool = [];
  for (const g of GLYPHS) pool.push({ text: g, equation: false });
  for (const e of EQUATIONS) pool.push({ text: e, equation: true });
  return pool;
}

const POOL = buildPool();

const SPRING_K = 0.02;
const DAMPING = 0.9;
const REPEL_RADIUS = 130;
const REPEL_STRENGTH = 2000;
const CONNECT_RADIUS = 150;

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
      const count = Math.max(20, Math.min(70, Math.floor((width * height) / 26000)));
      nodes = Array.from({ length: count }, () => {
        const bx = Math.random() * width;
        const by = Math.random() * height;
        const pick = POOL[Math.floor(Math.random() * POOL.length)];
        const depth = 0.5 + Math.random(); // parallax/size factor
        return {
          text: pick.text,
          equation: pick.equation,
          baseX: bx,
          baseY: by,
          x: bx,
          y: by,
          vx: 0,
          vy: 0,
          depth,
          fontSize: (pick.equation ? 15 : 17) * depth + (pick.equation ? 4 : 6),
          phase: Math.random() * Math.PI * 2,
          speed: 0.25 + Math.random() * 0.35,
          driftR: 5 + Math.random() * 10,
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

    const linkColor = dark ? '150, 160, 190' : '130, 130, 160';
    const glowColor = dark ? '240, 190, 110' : '110, 80, 220';
    const textColor = dark ? '210, 213, 228' : '80, 80, 100';
    const eqColor = dark ? '190, 196, 220' : '95, 95, 130';
    const spotlight = dark ? '240, 190, 110' : '150, 130, 240';

    function tick() {
      t += 1;
      ctx.clearRect(0, 0, width, height);

      // Soft spotlight following the cursor — cheap depth cue, à la
      // modern SaaS hero sections.
      if (mouse.active) {
        const grad = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 260);
        grad.addColorStop(0, `rgba(${spotlight}, 0.06)`);
        grad.addColorStop(1, `rgba(${spotlight}, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }

      // Physics pass — drift toward an idle orbit, spring back to the
      // resting point, repel away from the cursor.
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
        n.glow = glow;
      }

      // Constellation links — connect nearby nodes, brightening whichever
      // edges sit closest to the cursor so the graph feels alive rather
      // than static wallpaper.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > CONNECT_RADIUS) continue;
          const proximity = 1 - dist / CONNECT_RADIUS;
          const edgeGlow = Math.max(a.glow, b.glow);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(${linkColor}, ${proximity * (0.08 + edgeGlow * 0.35)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Symbols on top of the links.
      for (const n of nodes) {
        ctx.font = `${n.equation ? '' : ''}${n.fontSize}px ${
          n.equation ? 'Georgia, "Times New Roman", serif' : 'ui-monospace, "SF Mono", monospace'
        }`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.shadowColor = `rgba(${glowColor}, ${n.glow})`;
        ctx.shadowBlur = 4 + n.glow * 26;
        const base = n.equation ? eqColor : textColor;
        ctx.fillStyle = n.glow > 0.02 ? `rgba(${glowColor}, ${0.4 + n.glow * 0.55})` : `rgba(${base}, ${0.28 + n.depth * 0.1})`;
        ctx.fillText(n.text, n.x, n.y);
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
