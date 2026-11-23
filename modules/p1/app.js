
  'use strict';

  /* =========================================================================
     1. SHARED TOOLKIT HELPERS (copied from Homework 1, Module 1)
        Number formatting, chart theme, a small annotation plugin, legends,
        the validation table and the "Predict, then check" component.
        Homework 2 additions are marked "HW2".
     ========================================================================= */

  /** Colours used by every chart, kept in one place. */
  const THEME = {
    font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    text: '#475569',
    grid: '#e6ebf1',
    axis: '#cbd5e1',
    output: '#0f766e',     // sensor output y(t)
    ideal: '#1e293b',      // ideal gain-scaled input K·x(t)
    reference: '#94a3b8',  // pinned comparison curve
    tau: '#2563eb',        // anything that is "one time constant" (τ marker, time lag)
    tau3: '#0f172a',       // the 3τ marker
    error: '#d97706',      // output error, drawn lines
    errorText: '#b45309',  // output error, text (darker for contrast)
    // HW2 colours
    setpoint: '#1e293b',   // setpoint r(t), dashed
    sensor: '#c2410c',     // sensor measurement m(t) (P2), dashed orange
    control: '#2563eb',    // control signal u(t)
    limit: '#b91c1c',      // actuator limits u_min and u_max
    pTerm: '#7c3aed',      // proportional part Kp·e
    iTerm: '#d97706',      // integral part Ki·∫e
    dTerm: '#db2777',      // derivative part
    saturated: 'rgba(185, 28, 28, 0.08)'   // shading while u is held at a limit
  };

  /** True when the bundled Chart.js script loaded. */
  const CHARTS_AVAILABLE = typeof window.Chart === 'function';

  /** Format a number with fixed decimals and a true minus sign (−). */
  function fmt(value, decimals = 3) {
    if (!Number.isFinite(value)) return '—';
    const rounded = Math.abs(value) < 0.5 * Math.pow(10, -decimals) ? 0 : value;
    const text = rounded.toFixed(decimals);
    return text.charAt(0) === '-' ? '\u2212' + text.slice(1) : text;
  }

  /** Short axis-tick format: 2.50 → "2.5", 12.00 → "12". */
  function fmtTick(value) {
    return String(Number(value.toFixed(2)));
  }

  /** Escape text before inserting it into HTML. */
  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replace(/[&<>"']/g, (ch) => map[ch]);
  }

  /** "#rrggbb" → "rgba(r, g, b, alpha)". */
  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  /** Global Chart.js look: fonts and colours. */
  function applyChartDefaults() {
    Chart.defaults.font.family = THEME.font;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = THEME.text;
    Chart.defaults.borderColor = THEME.grid;
  }

  /** Dark tooltip style shared by all charts. */
  function tooltipStyle() {
    return {
      backgroundColor: 'rgba(15, 23, 42, 0.94)',
      titleColor: '#ffffff',
      bodyColor: '#e2e8f0',
      footerColor: '#5eead4',
      titleFont: { weight: '600' },
      footerFont: { weight: '500' },
      padding: 10,
      cornerRadius: 8,
      boxPadding: 4,
      caretSize: 5
    };
  }

  /**
   * Time axis from 0 to spanInTau·τ with one tick (and gridline) per time constant.
   * Each tick label has two lines: the time in seconds and the multiple of τ.
   * getTau() is called on every redraw, so the axis follows the τ slider.
   */
  function tauTimeAxis(getTau, spanInTau) {
    return {
      type: 'linear',
      min: 0,
      max: spanInTau * getTau(),
      title: { display: true, text: 'Time t (s)', font: { weight: '600' } },
      grid: { color: THEME.grid },
      border: { color: THEME.axis },
      ticks: {
        autoSkip: false,
        maxRotation: 0,
        callback: (value) => {
          const n = Math.round(value / getTau());
          return [fmtTick(value), n === 0 ? '' : n === 1 ? 'τ' : n + 'τ'];
        }
      },
      afterBuildTicks: (axis) => {
        const tau = getTau();
        axis.ticks = Array.from({ length: spanInTau + 1 }, (_, n) => ({ value: n * tau }));
      }
    };
  }

  /* ---------- Annotation plugin ----------
     Draws teaching annotations in data coordinates (no extra library):
       lines    – thin dashed guides, drawn BEHIND the curves
       segments – emphasised segments (optional end caps), drawn ON TOP
       markers  – filled circles on characteristic points
       labels   – short text tags on a white background
       spans    – HW2: shaded time intervals (x1 … x2, full height), drawn BEHIND the curves
     getGuides() returns { spans, lines, segments, markers, labels } for the current state. */
  function createGuidesPlugin(getGuides) {
    return {
      id: 'teachingGuides',
      beforeDatasetsDraw(chart) {
        const guides = getGuides();
        if (guides) drawClipped(chart, () => {
          (guides.spans || []).forEach((s) => drawSpan(chart, s));
          (guides.lines || []).forEach((s) => drawSegment(chart, s));
        });
      },
      afterDatasetsDraw(chart) {
        const guides = getGuides();
        if (!guides) return;
        drawClipped(chart, () => {
          (guides.segments || []).forEach((s) => drawSegment(chart, s));
          (guides.markers || []).forEach((m) => drawMarker(chart, m));
        });
        (guides.labels || []).forEach((label) => drawLabel(chart, label));
      }
    };
  }

  /** Run a drawing function clipped to the plotting area. */
  function drawClipped(chart, drawFn) {
    const { ctx, chartArea: a } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top);
    ctx.clip();
    drawFn();
    ctx.restore();
  }

  /** HW2: shaded vertical band between x1 and x2 (for example "the actuator is saturated here"). */
  function drawSpan(chart, s) {
    const { ctx, chartArea: a } = chart;
    const x1 = chart.scales.x.getPixelForValue(s.x1);
    const x2 = chart.scales.x.getPixelForValue(s.x2);
    if (!Number.isFinite(x1) || !Number.isFinite(x2)) return;
    ctx.save();
    ctx.fillStyle = s.color;
    ctx.fillRect(Math.min(x1, x2), a.top, Math.max(1, Math.abs(x2 - x1)), a.bottom - a.top);
    ctx.restore();
  }

  /** Data coordinates → canvas pixels. */
  function toPixels(chart, x, y, yAxis) {
    return { px: chart.scales.x.getPixelForValue(x), py: chart.scales[yAxis || 'y'].getPixelForValue(y) };
  }

  function drawSegment(chart, s) {
    const a = toPixels(chart, s.x1, s.y1, s.yAxis);
    const b = toPixels(chart, s.x2, s.y2, s.yAxis);
    if (![a.px, a.py, b.px, b.py].every(Number.isFinite)) return;
    const { ctx } = chart;
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width || 1.25;
    ctx.setLineDash(s.dash || []);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
    if (s.caps) {                                   // short perpendicular ticks at both ends
      const len = Math.hypot(b.px - a.px, b.py - a.py) || 1;
      const nx = (-(b.py - a.py) / len) * 5;
      const ny = ((b.px - a.px) / len) * 5;
      [a, b].forEach((p) => { ctx.moveTo(p.px - nx, p.py - ny); ctx.lineTo(p.px + nx, p.py + ny); });
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawMarker(chart, m) {
    const p = toPixels(chart, m.x, m.y, m.yAxis);
    if (!Number.isFinite(p.px) || !Number.isFinite(p.py)) return;
    const { ctx } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.px, p.py, m.radius || 5.5, 0, Math.PI * 2);
    ctx.fillStyle = m.color;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }

  /** Rounded rectangle path (ctx.roundRect is missing in some older browsers). */
  function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Text tag anchored at (x, y) + (dx, dy) px, kept inside the plotting area. */
  function drawLabel(chart, label) {
    const p = toPixels(chart, label.x, label.y, label.yAxis);
    if (!Number.isFinite(p.px) || !Number.isFinite(p.py)) return;
    const { ctx, chartArea: area } = chart;
    const narrow = area.right - area.left < 440;     // phones: use the short text
    const text = narrow && label.short ? label.short : label.text;
    ctx.save();
    ctx.font = `600 11.5px ${THEME.font}`;
    const w = ctx.measureText(text).width + 12;
    const h = 20;
    const ax = p.px + (label.dx || 0);
    const ay = p.py + (label.dy || 0);
    let left = label.align === 'right' ? ax - w : label.align === 'center' ? ax - w / 2 : ax;
    let top = ay - h / 2;
    left = Math.min(Math.max(left, area.left + 2), area.right - w - 2);
    top = Math.min(Math.max(top, area.top + 2), area.bottom - h - 2);
    roundedRectPath(ctx, left, top, w, h, 6);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.fill();
    ctx.strokeStyle = hexToRgba(label.color, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = label.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + 6, top + h / 2 + 0.5);
    ctx.restore();
  }

  /* ---------- HTML legend (matches the line styles drawn on the canvas) ---------- */
  const LEGEND_SWATCHES = {
    line:   (c) => `<line x1="1" y1="6" x2="23" y2="6" stroke="${c}" stroke-width="2.75" stroke-linecap="round"/>`,
    dashed: (c) => `<line x1="1" y1="6" x2="23" y2="6" stroke="${c}" stroke-width="2" stroke-dasharray="6 4"/>`,
    dotted: (c) => `<line x1="1" y1="6" x2="23" y2="6" stroke="${c}" stroke-width="2" stroke-dasharray="2 3"/>`,
    dot:    (c) => `<circle cx="12" cy="6" r="4.5" fill="${c}" stroke="#fff" stroke-width="1.5"/>`,
    vbar:   (c) => `<path d="M12 1.5v9M9 1.5h6M9 10.5h6" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    hbar:   (c) => `<path d="M3 6h18M3 3v6M21 3v6" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`
  };

  /** items: [{ label, kind: 'line'|'dashed'|'dotted'|'dot'|'vbar'|'hbar', color }] */
  function renderLegend(listEl, items) {
    listEl.innerHTML = items.map((item) =>
      `<li><svg class="legend-swatch" viewBox="0 0 24 12" width="24" height="12" aria-hidden="true">${LEGEND_SWATCHES[item.kind](item.color)}</svg>${escapeHtml(item.label)}</li>`
    ).join('');
  }

  /* ---------- Validation table ----------
     checks: [{ name, detail, expected: { main, sub }, calculated: { main, sub }, pass }]
     Returns the number of passing checks. Reusable by Modules 2 and 3. */
  function renderValidation(tbody, checks) {
    tbody.replaceChildren(...checks.map((check) => {
      const row = document.createElement('tr');
      row.append(
        validationCell('Check', check.name, check.detail),
        validationCell('Expected', check.expected.main, check.expected.sub),
        validationCell('Calculated', check.calculated.main, check.calculated.sub),
        statusCell(check.pass)
      );
      return row;
    }));
    return checks.filter((check) => check.pass).length;
  }

  function validationCell(label, main, sub) {
    const td = document.createElement('td');
    td.dataset.label = label;                      // used by the stacked phone layout
    const wrap = document.createElement('div');
    const mainEl = document.createElement('span');
    mainEl.className = 'cell-main';
    mainEl.textContent = main;
    wrap.append(mainEl);
    if (sub) {
      const subEl = document.createElement('span');
      subEl.className = 'cell-sub';
      subEl.textContent = sub;
      wrap.append(subEl);
    }
    td.append(wrap);
    return td;
  }

  function statusCell(pass) {
    const td = document.createElement('td');
    td.dataset.label = 'Status';
    const badge = document.createElement('span');
    badge.className = 'status ' + (pass ? 'status--pass' : 'status--fail');
    badge.textContent = pass ? 'PASS' : 'FAIL';
    const wrap = document.createElement('div');
    wrap.append(badge);
    td.append(wrap);
    return td;
  }

  /* ---------- "Predict, then check" component ----------
     root: the activity card (uses data-role attributes for its parts).
     questions: [{ prompt, choices: [{ text, correct }], explanation, tryIt }]
     hooks.onCheck(question, isCorrect) runs after each check.
     Returns { notifyInteraction() } — call it when the user moves a control. */
  function createPredictCheck(root, questions, hooks = {}) {
    const part = (role) => root.querySelector(`[data-role="${role}"]`);
    const prompt = part('prompt');
    const choicesBox = part('choices');
    const checkBtn = part('check');
    const retryBtn = part('retry');
    const nextBtn = part('next');
    const hint = part('hint');
    const feedback = part('feedback');
    const progress = part('progress');
    const steps = root.querySelectorAll('[data-step]');
    const groupName = root.id + '-choice';
    let current = 0;
    let checked = false;
    let observed = false;

    /** stage: 'predict' | 'observe' | 'done' */
    function setStage(stage) {
      const order = ['predict', 'check', 'observe'];
      const activeIndex = stage === 'predict' ? 0 : stage === 'observe' ? 2 : 3;
      steps.forEach((li) => {
        const i = order.indexOf(li.dataset.step);
        li.classList.toggle('is-done', i < activeIndex);
        li.classList.toggle('is-active', i === activeIndex);
      });
    }

    function renderQuestion() {
      const q = questions[current];
      checked = false;
      observed = false;
      prompt.textContent = q.prompt;
      progress.textContent = `Question ${current + 1} of ${questions.length}`;
      choicesBox.replaceChildren(...q.choices.map((choice, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'choice';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = groupName;
        input.id = `${groupName}-${current}-${i}`;
        input.value = String(i);
        const label = document.createElement('label');
        label.htmlFor = input.id;
        label.textContent = choice.text;
        wrap.append(input, label);
        return wrap;
      }));
      checkBtn.hidden = false;
      checkBtn.disabled = true;
      hint.hidden = false;
      retryBtn.hidden = true;
      nextBtn.hidden = true;
      feedback.hidden = true;
      feedback.replaceChildren();
      setStage('predict');
    }

    function addParagraph(text, className) {
      const p = document.createElement('p');
      if (className) p.className = className;
      p.textContent = text;
      feedback.append(p);
      return p;
    }

    choicesBox.addEventListener('change', () => {
      if (!checked) { checkBtn.disabled = false; hint.hidden = true; }
    });

    checkBtn.addEventListener('click', () => {
      const selected = choicesBox.querySelector('input:checked');
      if (!selected) return;
      const q = questions[current];
      const picked = Number(selected.value);
      const isCorrect = q.choices[picked].correct;
      const correctChoice = q.choices.find((c) => c.correct);
      checked = true;

      choicesBox.querySelectorAll('.choice').forEach((wrap, i) => {
        wrap.querySelector('input').disabled = true;
        const tag = document.createElement('span');
        tag.className = 'choice-tag';
        if (q.choices[i].correct) {
          wrap.classList.add('is-correct');
          tag.textContent = i === picked ? 'Your answer: correct' : 'Correct answer';
          wrap.querySelector('label').append(tag);
        } else if (i === picked) {
          wrap.classList.add('is-wrong');
          tag.textContent = 'Your answer';
          wrap.querySelector('label').append(tag);
        }
      });

      feedback.className = 'feedback ' + (isCorrect ? 'is-correct' : 'is-wrong');
      feedback.replaceChildren();
      addParagraph(isCorrect ? `Correct: ${correctChoice.text}` : `Not quite. The answer is: ${correctChoice.text}`, 'feedback-title');
      addParagraph(q.explanation);
      addParagraph(q.tryIt);
      feedback.hidden = false;

      checkBtn.hidden = true;
      retryBtn.hidden = false;
      nextBtn.hidden = false;
      nextBtn.textContent = current === questions.length - 1 ? 'Back to question 1' : 'Next question';
      setStage('observe');
      if (hooks.onCheck) hooks.onCheck(q, isCorrect);
      feedback.focus({ preventScroll: true });
    });

    retryBtn.addEventListener('click', () => {
      renderQuestion();
      const first = choicesBox.querySelector('input');
      if (first) first.focus();
    });

    nextBtn.addEventListener('click', () => {
      current = (current + 1) % questions.length;
      renderQuestion();
      prompt.scrollIntoView({ block: 'nearest' });
    });

    renderQuestion();

    return {
      notifyInteraction() {
        if (!checked || observed) return;
        observed = true;
        setStage('done');
        addParagraph('Observed: compare the live curve with the dotted reference curve.', 'feedback-observed');
      }
    };
  }


  /* =========================================================================
     PID SIMULATION ENGINE (pure functions, no page access)
     The same engine is embedded, unchanged, in P1 (modules/p1/p1.html) and
     P2 (modules/p2/p2.html), so each page works on its own. P3, P4 and the
     MySystem page can copy this block as well.

     Closed loop simulated here:

        r ──►(Σ)── e ──► PID ── u_raw ──► [limit] ── u ──► plant ──► y
              ▲ −                                                  │
              └──────────── m ◄── sensor H_s(s) ◄──────────────────┘

       Plant (first order, Module 1):   τ dy/dt = K·u − y            G(s) = K / (τs + 1)
       Plant (second order, Module 3):  ÿ + 2ζω_n ẏ + ω_n² y = K ω_n² u
                                                           G(s) = K ω_n² / (s² + 2ζω_n s + ω_n²)
       Sensor:                          τ_s dm/dt = y − m            H_s(s) = 1 / (τ_s s + 1)
                                        τ_s = 0 means an ideal sensor, m = y (no division)
       Controller (parallel PID):       e = r − m
                                        u_raw = Kp·e + Ki·∫e dt + Kd·(filtered derivative)
                                        u = min(max(u_raw, u_min), u_max)   ← enforced, not just drawn
       Derivative: d/dt is replaced by s / (T_f s + 1) with T_f = 0.01 s, so a step
       in e gives a tall but finite "derivative kick" instead of an infinite impulse.
       It can act on the error e (the textbook form) or on −m (no kick on setpoint steps).
       There is no anti-windup here: the integral keeps integrating e even while u is
       limited. (P3 adds anti-windup.)

     Solver: classic fourth-order Runge–Kutta (RK4) with a fixed step Δt chosen
     from the fastest pole of the loop (Δt = 0.25 / |p|max, never above 1 ms).
     ========================================================================= */
  const PidEngine = (function () {
    'use strict';

    const DERIV_TF = 0.01;          // derivative filter time constant T_f (s)
    const SETTLE_BAND = 0.02;       // ±2 % settling band, as in Module 3
    const CONVERGE_TOL = 1e-3;      // "converged": y varies by ≤ 0.1 % of |r| over the last 20 % of the run
    const DIVERGE_LIMIT = 1e4;      // |y| above 10 000·|r| counts as unstable
    const MAX_STEPS = 2000000;       // safety cap on RK4 steps per run

    /* ---------- Small polynomial toolkit (coefficients in ascending powers of s) ---------- */
    function polyMul(a, b) {
      const out = new Array(a.length + b.length - 1).fill(0);
      a.forEach((ai, i) => b.forEach((bj, j) => { out[i + j] += ai * bj; }));
      return out;
    }
    function polyAdd(a, b) {
      const out = new Array(Math.max(a.length, b.length)).fill(0);
      a.forEach((v, i) => { out[i] += v; });
      b.forEach((v, i) => { out[i] += v; });
      return out;
    }
    function polyTrim(p) {
      const out = p.slice();
      while (out.length > 1 && Math.abs(out[out.length - 1]) < 1e-14) out.pop();
      return out;
    }

    /** All complex roots of a real polynomial (ascending coefficients), Durand–Kerner iteration. */
    function polyRoots(coeffs) {
      const p = polyTrim(coeffs);
      const n = p.length - 1;
      if (n < 1) return [];
      const lead = p[n];
      const a = p.map((c) => c / lead);                    // monic
      const evalAt = (zr, zi) => {                          // Horner in complex arithmetic
        let re = 1, im = 0;
        for (let k = n - 1; k >= 0; k--) {
          const nr = re * zr - im * zi + a[k];
          im = re * zi + im * zr;
          re = nr;
        }
        return [re, im];
      };
      const bound = 1 + Math.max(...a.slice(0, n).map(Math.abs));
      let roots = Array.from({ length: n }, (_, k) => {
        const ang = (2 * Math.PI * k) / n + 0.4;
        return [0.5 * bound * Math.cos(ang), 0.5 * bound * Math.sin(ang)];
      });
      for (let iter = 0; iter < 2000; iter++) {
        let delta = 0;
        roots = roots.map(([zr, zi], i) => {
          let [nr, ni] = evalAt(zr, zi);
          roots.forEach(([wr, wi], j) => {
            if (j === i) return;
            const dr = zr - wr, di = zi - wi;
            const den = dr * dr + di * di || 1e-30;
            const qr = (nr * dr + ni * di) / den;            // (nr + j ni) / (dr + j di)
            const qi = (ni * dr - nr * di) / den;
            nr = qr; ni = qi;
          });
          delta = Math.max(delta, Math.hypot(nr, ni));
          return [zr - nr, zi - ni];
        });
        if (delta < 1e-13 * bound) break;
      }
      return roots.map(([re, im]) => ({ re, im: Math.abs(im) < 1e-9 * bound ? 0 : im }));
    }

    /* ---------- Configuration ---------- */

    /** Fill in defaults and validate. Throws a readable Error on a bad value. */
    function normalise(config) {
      const c = Object.assign({
        plant: { type: 'first', K: 1, tau: 1 },
        sensorTau: 0, Kp: 1, Ki: 0, Kd: 0, r: 1,
        uMin: -Infinity, uMax: Infinity, dMode: 'error', disturbance: null
      }, config);
      const p = c.plant;
      const bad = (msg) => { throw new Error(msg); };
      if (!(p.K > 0)) bad('The plant gain K must be positive.');
      if (p.type === 'first' && !(p.tau > 0)) bad('The plant time constant τ must be positive.');
      if (p.type === 'second' && (!(p.zeta >= 0) || !(p.wn > 0))) bad('ζ must be ≥ 0 and ω_n must be positive.');
      if (!(c.sensorTau >= 0)) bad('The sensor time constant τ_s cannot be negative.');
      if ([c.Kp, c.Ki, c.Kd].some((g) => !(g >= 0))) bad('The PID gains must be zero or positive.');
      if (!(c.uMax > c.uMin)) bad('The upper control limit must be above the lower limit.');
      if (!Number.isFinite(c.r) || c.r === 0) bad('The setpoint step must be a non-zero number.');
      return c;
    }

    /** Closed-loop characteristic polynomial of the linear (unsaturated) loop: Cd·Gd·Hd + Cn·Gn·Hn. */
    function characteristicPolynomial(config) {
      const c = normalise(config);
      const p = c.plant;
      const Gn = p.type === 'first' ? [p.K] : [p.K * p.wn * p.wn];
      const Gd = p.type === 'first' ? [1, p.tau] : [p.wn * p.wn, 2 * p.zeta * p.wn, 1];
      const Hn = [1];
      const Hd = c.sensorTau > 0 ? [1, c.sensorTau] : [1];
      let Cn = [c.Kp];
      let Cd = [1];
      if (c.Ki > 0) { Cn = [c.Ki, c.Kp]; Cd = [0, 1]; }                 // Kp + Ki/s
      if (c.Kd > 0) {                                                    // + Kd s/(T_f s + 1)
        Cn = polyAdd(polyMul(Cn, [1, DERIV_TF]), polyMul([0, c.Kd], Cd));
        Cd = polyMul(Cd, [1, DERIV_TF]);
      }
      return polyTrim(polyAdd(polyMul(polyMul(Cd, Gd), Hd), polyMul(polyMul(Cn, Gn), Hn)));
    }

    /** Closed-loop poles and a stability verdict for the unsaturated loop. */
    function analyse(config) {
      const poles = polyRoots(characteristicPolynomial(config));
      const maxRe = Math.max(...poles.map((q) => q.re));
      const scale = Math.max(1, ...poles.map((q) => Math.hypot(q.re, q.im)));
      const stable = maxRe < -1e-9 * scale;
      const marginal = !stable && maxRe <= 1e-7 * scale;
      return { poles, maxRe, stable, marginal };
    }

    /* ---------- Simulation ---------- */
    // State vector: [y, v, m, I, f]
    //   y plant output, v = dy/dt (second-order plant only), m sensor reading (τ_s > 0 only),
    //   I = ∫e dt, f = derivative-filter state.
    function makeModel(c) {
      const p = c.plant;
      const second = p.type === 'second';
      const hasSensor = c.sensorTau > 0;
      const hasD = c.Kd > 0;
      const dist = c.disturbance;

      /** Every signal of the loop at time t for state x (used by the solver and for recording). */
      function signals(t, x) {
        const y = x[0];
        const m = hasSensor ? x[2] : y;                 // ideal sensor: the controller sees y itself
        const e = c.r - m;                              // the controller only sees the measurement
        const q = c.dMode === 'measurement' ? -m : e;   // what the derivative acts on
        const P = c.Kp * e;
        const I = c.Ki * x[3];
        const D = hasD ? (c.Kd * (q - x[4])) / DERIV_TF : 0;
        const uRaw = P + I + D;
        const u = Math.min(Math.max(uRaw, c.uMin), c.uMax);
        const d = dist && t >= dist.time ? dist.size : 0;
        return { y, m, e, q, P, I, D, uRaw, u, d, saturated: u !== uRaw };
      }

      /** Right-hand side dx/dt, written into `dx` (no allocation: this runs four times per step). */
      function deriv(t, x, dx) {
        const s = signals(t, x);
        const w = s.u + s.d;                            // plant input (control + load disturbance)
        if (second) {
          dx[0] = x[1];
          dx[1] = p.wn * p.wn * (p.K * w - x[0]) - 2 * p.zeta * p.wn * x[1];
        } else {
          dx[0] = (p.K * w - x[0]) / p.tau;
          dx[1] = 0;
        }
        dx[2] = hasSensor ? (x[0] - x[2]) / c.sensorTau : 0;
        dx[3] = s.e;
        dx[4] = hasD ? (s.q - x[4]) / DERIV_TF : 0;
        return dx;
      }

      // States that actually exist for this configuration (used for linearisation).
      const active = [0];
      if (second) active.push(1);
      if (hasSensor) active.push(2);
      if (c.Ki > 0) active.push(3);
      if (hasD) active.push(4);
      return { signals, deriv, active };
    }

    /** One classic RK4 step of length dt, in place on x (scratch arrays are reused). */
    const K1 = new Float64Array(5), K2 = new Float64Array(5), K3 = new Float64Array(5), K4 = new Float64Array(5);
    const XT = new Float64Array(5);
    function rk4Step(deriv, t, x, dt) {
      deriv(t, x, K1);
      for (let i = 0; i < 5; i++) XT[i] = x[i] + 0.5 * dt * K1[i];
      deriv(t + 0.5 * dt, XT, K2);
      for (let i = 0; i < 5; i++) XT[i] = x[i] + 0.5 * dt * K2[i];
      deriv(t + 0.5 * dt, XT, K3);
      for (let i = 0; i < 5; i++) XT[i] = x[i] + dt * K3[i];
      deriv(t + dt, XT, K4);
      for (let i = 0; i < 5; i++) x[i] += (dt / 6) * (K1[i] + 2 * K2[i] + 2 * K3[i] + K4[i]);
    }

    /** Step size from the fastest pole of the loop (closed loop, open loop, sensor and filter). */
    function chooseStep(c, lin) {
      const p = c.plant;
      const rates = lin.poles.map((q) => Math.hypot(q.re, q.im));
      rates.push(p.type === 'first' ? 1 / p.tau : p.wn);
      if (c.sensorTau > 0) rates.push(1 / c.sensorTau);
      if (c.Kd > 0) rates.push(1 / DERIV_TF);
      const fastest = Math.max(...rates);
      return Math.min(1e-3, Math.max(2e-5, 0.25 / fastest));
    }

    /** Horizon long enough for the slowest stable pole to die out (≈ 6 time constants, ×2 margin). */
    function chooseHorizon(lin) {
      if (!lin.stable) return 20;
      const slowest = Math.min(...lin.poles.map((q) => Math.abs(q.re)));
      return Math.min(60, Math.max(3, 12 / slowest));
    }

    /**
     * Simulate the closed loop for a step r applied at t = 0 (zero initial state).
     * options.horizon fixes the run length; otherwise it is chosen from the poles (at least
     * options.minHorizon) and
     * doubled (up to 120 s) while a stable response has not converged yet.
     * Returns arrays of every recorded signal plus the analysis and the step size used.
     */
    function simulate(config, options = {}) {
      const c = normalise(config);
      const lin = analyse(c);
      const dt = options.dt || chooseStep(c, lin);
      let horizon = options.horizon || Math.max(chooseHorizon(lin), options.minHorizon || 0);
      const model = makeModel(c);
      const limit = DIVERGE_LIMIT * Math.max(1, Math.abs(c.r));

      const rec = { t: [], y: [], m: [], e: [], u: [], uRaw: [], P: [], I: [], D: [], sat: [] };
      const record = (t, x) => {
        const s = model.signals(t, x);
        rec.t.push(t); rec.y.push(s.y); rec.m.push(s.m); rec.e.push(s.e);
        rec.u.push(s.u); rec.uRaw.push(s.uRaw); rec.P.push(s.P); rec.I.push(s.I); rec.D.push(s.D);
        rec.sat.push(s.saturated);
      };

      // Record about 20 000 samples per run (every step when Δt is already that coarse).
      const every = Math.max(1, Math.floor(horizon / 20000 / dt));
      const x = new Float64Array(5);
      let t = 0;
      let k = 0;
      let diverged = false;
      record(t, x);
      for (;;) {
        const steps = Math.round(horizon / dt);
        while (k < steps && k < MAX_STEPS) {
          rk4Step(model.deriv, t, x, dt);
          k += 1;
          t = k * dt;
          if (k % every === 0 || k === steps) record(t, x);
          if (!(Number.isFinite(x[0]) && Number.isFinite(x[3])) || Math.abs(x[0]) > limit) {
            if (k % every !== 0) record(t, x);
            diverged = true;
            break;
          }
        }
        if (diverged || options.horizon || !lin.stable || k >= MAX_STEPS || horizon >= 120) break;
        if (convergence(rec, c.r).converged) break;
        horizon = Math.min(120, horizon * 2);           // slow (often saturated) response: run longer
      }
      return { config: c, analysis: lin, dt, horizon: t, diverged, model, rec };
    }

    /* ---------- Performance metrics ---------- */

    function convergence(rec, r) {
      const n = rec.y.length;
      const tEnd = rec.t[n - 1];
      let lo = Infinity, hi = -Infinity;
      for (let i = n - 1; i >= 0 && rec.t[i] >= 0.8 * tEnd; i--) {
        lo = Math.min(lo, rec.y[i]);
        hi = Math.max(hi, rec.y[i]);
      }
      return { converged: hi - lo <= CONVERGE_TOL * Math.abs(r), spread: hi - lo };
    }

    /** First time the signal crosses `level` going toward the final value (linear interpolation). */
    function firstCrossing(t, y, level, sign) {
      for (let i = 1; i < y.length; i++) {
        if (sign * (y[i] - level) >= 0) {
          const a = y[i - 1], b = y[i];
          const frac = b === a ? 0 : (level - a) / (b - a);
          return t[i - 1] + frac * (t[i] - t[i - 1]);
        }
      }
      return NaN;
    }

    /**
     * Metrics of a signal (default y) for a step 0 → r. All relative to the FINAL VALUE y_ss,
     * as in Modules 1 and 3: rise time 10 %→90 % of y_ss, overshoot (y_max − y_ss)/|y_ss|,
     * settling time = last exit from the ±2 % band around y_ss, e_ss = r − y_ss.
     * Nothing is reported as a number unless the run converged.
     */
    function metrics(result, signal = 'y') {
      const { rec, config, diverged } = result;
      const r = config.r;
      const y = rec[signal];
      const t = rec.t;
      const n = y.length;
      const out = { status: 'ok', reason: '', yss: NaN, ess: NaN, essPct: NaN, tr: NaN, mp: NaN, ts: NaN,
                    yPeak: NaN, tPeak: NaN, t10: NaN, t90: NaN, peakU: 0, satTime: 0, horizon: t[n - 1] };

      // Control-effort facts are meaningful even for bad responses.
      for (let i = 1; i < n; i++) if (rec.sat[i]) out.satTime += t[i] - t[i - 1];
      for (let i = 0; i < n; i++) out.peakU = Math.max(out.peakU, Math.abs(rec.u[i]));
      let peakIdx = 0;
      for (let i = 1; i < n; i++) if (Math.sign(r) * y[i] > Math.sign(r) * y[peakIdx]) peakIdx = i;
      out.yPeak = y[peakIdx];
      out.tPeak = t[peakIdx];

      if (diverged) {
        out.status = 'unstable';
        out.reason = `The output grew without bound (|y| passed ${fmtNum(DIVERGE_LIMIT * Math.abs(r))} at t = ${fmtNum(t[n - 1])} s).`;
        return out;
      }
      const conv = convergence(rec, r);
      if (!conv.converged) {
        out.status = result.analysis.stable ? 'not-settled' : 'oscillating';
        out.reason = result.analysis.stable
          ? `Still moving after ${fmtNum(t[n - 1])} s: y varies by ${fmtNum(conv.spread)} over the last 20 % of the run.`
          : `The loop is not stable: y keeps swinging by ${fmtNum(conv.spread)} after ${fmtNum(t[n - 1])} s.`;
        return out;
      }
      const yss = y[n - 1];
      out.yss = yss;
      out.ess = r - yss;
      out.essPct = (100 * (r - yss)) / r;
      if (Math.sign(yss) !== Math.sign(r) || Math.abs(yss) < 0.01 * Math.abs(r)) {
        out.status = 'no-response';
        out.reason = 'The output settles at (almost) zero or on the wrong side, so rise time and overshoot are undefined.';
        return out;
      }
      const sign = Math.sign(yss);
      out.t10 = firstCrossing(t, y, 0.1 * yss, sign);
      out.t90 = firstCrossing(t, y, 0.9 * yss, sign);
      out.tr = out.t90 - out.t10;
      out.mp = Math.max(0, (100 * sign * (out.yPeak - yss)) / Math.abs(yss));
      const band = SETTLE_BAND * Math.abs(yss);
      let ts = 0;
      for (let i = n - 2; i > 0; i--) {
        if (Math.abs(y[i] - yss) > band) {                // last sample outside the band
          const a = Math.abs(y[i] - yss), b = Math.abs(y[i + 1] - yss);
          ts = t[i] + ((a - band) / (a - b)) * (t[i + 1] - t[i]);
          break;
        }
      }
      out.ts = ts;
      return out;
    }

    function fmtNum(v) {
      const a = Math.abs(v);
      return a >= 1000 || (a > 0 && a < 0.01) ? v.toExponential(2) : v.toFixed(a >= 100 ? 0 : 3);
    }

    /**
     * Linearise the simulated loop at the origin by finite differences of the solver's own
     * right-hand side (the unsaturated region). Returns the Jacobian on the active states.
     * Used by the validation to measure ω_n and ζ from the implementation itself.
     */
    function linearise(config) {
      const c = normalise(Object.assign({}, config, { r: 1 }));
      const model = makeModel(Object.assign({}, c, { uMin: -Infinity, uMax: Infinity }));
      const idx = model.active;
      const h = 1e-6;
      const base = [0, 0, 0, 0, 0];
      // With r applied the operating point is irrelevant for a linear system: differentiate around 0.
      return idx.map((row) => idx.map((col) => {
        const xp = base.slice(); xp[col] += h;
        const xm = base.slice(); xm[col] -= h;
        return (model.deriv(1, xp, [0, 0, 0, 0, 0])[row] - model.deriv(1, xm, [0, 0, 0, 0, 0])[row]) / (2 * h);
      }));
    }

    /** Value of a recorded signal at time tq (linear interpolation). */
    function valueAt(rec, key, tq) {
      const t = rec.t;
      if (tq <= t[0]) return rec[key][0];
      for (let i = 1; i < t.length; i++) {
        if (t[i] >= tq) {
          const f = (tq - t[i - 1]) / (t[i] - t[i - 1]);
          return rec[key][i - 1] + f * (rec[key][i] - rec[key][i - 1]);
        }
      }
      return rec[key][t.length - 1];
    }

    /**
     * Reduce a recorded signal to about `buckets` × 2 chart points between t0 and t1, keeping the
     * minimum and maximum of each bucket so short spikes (derivative kick, saturation) stay visible.
     */
    function decimate(rec, key, t0, t1, buckets = 400) {
      const t = rec.t, v = rec[key];
      const out = [];
      const width = (t1 - t0) / buckets;
      let i = 0;
      while (i < t.length && t[i] < t0) i++;
      for (let b = 0; b < buckets && i < t.length; b++) {
        const end = t0 + (b + 1) * width;
        let iMin = i, iMax = i;
        const start = i;
        while (i < t.length && t[i] <= end + 1e-12) {
          if (v[i] < v[iMin]) iMin = i;
          if (v[i] > v[iMax]) iMax = i;
          i++;
        }
        if (i === start) continue;
        const first = Math.min(iMin, iMax), second = Math.max(iMin, iMax);
        out.push({ x: t[first], y: v[first] });
        if (second !== first) out.push({ x: t[second], y: v[second] });
      }
      return out;
    }

    return {
      DERIV_TF, SETTLE_BAND, CONVERGE_TOL,
      simulate, metrics, analyse, characteristicPolynomial, polyRoots, linearise, valueAt, decimate, normalise
    };
  })();


  /* =========================================================================
     CONTROL-PAGE HELPERS (HW2): small UI pieces shared by P1 and P2.
     Slider wiring, chart axes, the time window, saturation shading and the
     closed-loop pole text. Each page has its own copy so it works alone.
     ========================================================================= */
  const ControlKit = (function () {
    'use strict';

    /** Paint the slider track up to the thumb (same look as Homework 1). */
    function setSliderFill(slider) {
      const min = Number(slider.min);
      const max = Number(slider.max);
      const pct = ((Number(slider.value) - min) / (max - min)) * 100;
      slider.style.setProperty('--fill', `${pct}%`);
    }

    /** Round up to 1, 1.5, 2, 3, 4, 5, 6, 8 × 10^n (a tidy axis end). */
    function niceCeil(x) {
      if (!(x > 0)) return 1;
      const p = Math.pow(10, Math.floor(Math.log10(x)));
      const m = x / p;
      const step = [1, 1.5, 2, 3, 4, 5, 6, 8, 10].find((s) => s >= m - 1e-9);
      return step * p;
    }

    /** Automatic time window: the settling time (or the peak) plus 60 %, or the whole run when it never settles. */
    function autoWindow(result, met) {
      if (met.status === 'ok') {
        const t = Math.max(met.ts, met.mp > 0.05 ? met.tPeak : 0, met.t90 || 0, 0.05);
        return Math.min(niceCeil(1.6 * t), niceCeil(result.horizon));
      }
      return result.horizon;
    }

    /** Linear tick spacing that gives about 6–10 gridlines. */
    function tickStep(span) {
      const raw = span / 8;
      const p = Math.pow(10, Math.floor(Math.log10(raw)));
      return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
    }

    /** Time axis 0 … window (seconds). */
    function timeAxis() {
      return {
        type: 'linear', min: 0, max: 1,
        title: { display: true, text: 'Time t (s)', font: { weight: '600' } },
        grid: { color: THEME.grid },
        border: { color: THEME.axis },
        ticks: { maxRotation: 0, callback: (v) => fmtTick(v).replace('-', '\u2212') },
        afterBuildTicks: (axis) => {
          const step = tickStep(axis.max - axis.min);
          const ticks = [];
          for (let v = 0; v <= axis.max + 1e-9; v += step) ticks.push({ value: Number(v.toFixed(10)) });
          axis.ticks = ticks;
        }
      };
    }

    /** y-range that holds all values, with 8 % padding; an unstable response is clipped to a readable range. */
    function valueRange(values, clip) {
      let lo = Math.min(...values);
      let hi = Math.max(...values);
      if (clip) { lo = Math.max(lo, clip[0]); hi = Math.min(hi, clip[1]); }
      if (hi - lo < 1e-9) { hi += 0.5; lo -= 0.5; }
      const pad = 0.08 * (hi - lo);
      return [lo - pad, hi + pad];
    }

    /** Min and max of a recorded signal inside [0, tEnd]. */
    function extent(rec, key, tEnd) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < rec.t.length && rec.t[i] <= tEnd + 1e-12; i++) {
        const v = rec[key][i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return [lo, hi];
    }

    /** Time intervals in which the actuator was held at a limit, as shaded spans. */
    function saturationSpans(rec, tEnd) {
      const spans = [];
      let start = null;
      for (let i = 0; i < rec.t.length && rec.t[i] <= tEnd; i++) {
        if (rec.sat[i] && start === null) start = rec.t[i];
        if (!rec.sat[i] && start !== null) { spans.push({ x1: start, x2: rec.t[i], color: THEME.saturated }); start = null; }
      }
      if (start !== null) spans.push({ x1: start, x2: Math.min(tEnd, rec.t[rec.t.length - 1]), color: THEME.saturated });
      return spans;
    }

    /** "−2.000 ± j3.162" style text for the closed-loop poles (conjugate pairs listed once). */
    function polesText(poles) {
      const list = [];
      poles.slice().sort((a, b) => b.re - a.re || b.im - a.im).forEach((p) => {
        if (Math.abs(p.im) <= 1e-6) list.push(fmt(p.re, 3));          // real pole (repeated poles are listed twice)
        else if (p.im > 0) list.push(`${fmt(p.re, 3)} ± j${fmt(p.im, 3)}`);   // complex pair, listed once
      });
      return list.join(',  ');
    }

    /** Write text into every element marked data-bd="key" (both block-diagram layouts). */
    function setDiagramText(root, key, text) {
      root.querySelectorAll(`[data-bd="${key}"]`).forEach((el) => { el.textContent = text; });
    }

    /** Format a metric for a card: the value, or "—" when it is undefined. */
    function metricText(value, decimals) {
      return Number.isFinite(value) ? fmt(value, decimals) : '—';
    }

    /** Short human sentence for a non-ok metrics status. */
    function statusSentence(met) {
      switch (met.status) {
        case 'unstable': return { cls: 'bad', title: 'Unstable.', text: met.reason };
        case 'oscillating': return { cls: 'bad', title: 'Unstable / oscillating.', text: met.reason + ' Rise time, overshoot, settling time and steady-state error are not defined, so none is reported.' };
        case 'not-settled': return { cls: 'warn', title: 'Not settled yet.', text: met.reason + ' The metrics are left blank rather than guessed.' };
        case 'no-response': return { cls: 'warn', title: 'No useful response.', text: met.reason };
        default: return null;
      }
    }

    /** Run a function at most once per animation frame (slider dragging stays smooth). */
    function frameThrottle(fn) {
      let queued = false;
      return function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; fn(); });
      };
    }

    return {
      setSliderFill, niceCeil, autoWindow, timeAxis, valueRange, extent, saturationSpans,
      polesText, setDiagramText, metricText, statusSentence, frameThrottle
    };
  })();


  /* =========================================================================
     CONTROL P1: PID PLAYGROUND (user interface)
     Reads the controls, runs PidEngine.simulate(), draws the two charts,
     fills the metrics and runs the validation tests.
     ========================================================================= */
  function initP1() {
    const DEFAULTS = Object.freeze({
      plant: 'first', K: 1, tau: 1, zeta: 0.5, wn: 2,
      Kp: 9, Ki: 0, Kd: 0, dMode: 'error', r: 1, uMax: 10, uMin: -10, window: 'auto'
    });
    // Presets are tuned for the default plant of each type (they keep the current K, τ, ζ, ω_n).
    const PRESETS = {
      first:  { P: { Kp: 9, Ki: 0, Kd: 0 }, PI: { Kp: 9, Ki: 20, Kd: 0 }, PID: { Kp: 9, Ki: 20, Kd: 0.1 } },
      second: { P: { Kp: 5, Ki: 0, Kd: 0 }, PI: { Kp: 5, Ki: 5, Kd: 0 }, PID: { Kp: 5, Ki: 5, Kd: 1 } }
    };
    const PRESET_HELP = {
      first: 'P = 9 → PI = 9 / 20 → PID = 9 / 20 / 0.1. Start with P, then add I, then D.',
      second: 'P = 5 → PI = 5 / 5 → PID = 5 / 5 / 1. Watch D damp the overshoot.'
    };

    const state = Object.assign({}, DEFAULTS, { reference: null });
    const $ = (id) => document.getElementById(id);

    // Sliders: state key → element id and readout format
    const SLIDERS = {
      K:    { id: 'p1-K',    text: (v) => v.toFixed(1) },
      tau:  { id: 'p1-tau',  text: (v) => `${v.toFixed(1)} s` },
      zeta: { id: 'p1-zeta', text: (v) => v.toFixed(2) },
      wn:   { id: 'p1-wn',   text: (v) => `${v.toFixed(1)} rad/s` },
      Kp:   { id: 'p1-kp',   text: (v) => v.toFixed(1) },
      Ki:   { id: 'p1-ki',   text: (v) => `${v.toFixed(1)} s⁻¹` },
      Kd:   { id: 'p1-kd',   text: (v) => `${v.toFixed(2)} s` },
      r:    { id: 'p1-r',    text: (v) => v.toFixed(1) },
      uMax: { id: 'p1-umax', text: (v) => fmt(v, 1) },
      uMin: { id: 'p1-umin', text: (v) => fmt(v, 1) }
    };
    Object.values(SLIDERS).forEach((s) => { s.el = $(s.id); s.out = $(s.id + '-value'); });

    const ui = {
      plantRadios: document.querySelectorAll('input[name="p1-plant"]'),
      plantFirst: document.querySelectorAll('[data-plant="first"]'),
      plantSecond: document.querySelectorAll('[data-plant="second"]'),
      presets: document.querySelectorAll('[data-preset]'), presetHelp: $('p1-preset-help'),
      reset: $('p1-reset'), inputError: $('p1-input-error'),
      bd: $('p1-bd'), paramChip: $('p1-param-chip'),
      yLegend: $('p1-y-legend'), yCanvas: $('p1-y-chart'),
      uLegend: $('p1-u-legend'), uCanvas: $('p1-u-chart'), satChip: $('p1-sat-chip'), uNote: $('p1-u-note'),
      pin: $('p1-pin'), unpin: $('p1-unpin'), refStatus: $('p1-ref-status'),
      status: $('p1-status'), satCallout: $('p1-sat-callout'), satText: $('p1-sat-text'),
      validationBody: $('p1-validation-body'), validationSummary: $('p1-validation-summary')
    };

    let yChart = null;
    let uChart = null;
    let yGuides = null;
    let uGuides = null;
    let refCache = { key: '', result: null, metrics: null };

    /* ---------- Predict, then check ---------- */
    const QUESTIONS = [
      {
        setup: { plant: 'first', K: 1, tau: 1, Kp: 9, Ki: 0, Kd: 0, r: 1, uMax: 10, uMin: -10 },
        prompt: 'K = 1, τ = 1 s, P only with Kp = 9: the output settles 10% short of the setpoint. What happens to the steady-state error if Kp is raised to 19?',
        choices: [
          { text: 'It disappears.', correct: false },
          { text: 'It halves, to about 5%.', correct: true },
          { text: 'It stays at 10%; only the speed changes.', correct: false }
        ],
        explanation: 'e_ss = 1/(1 + K·Kp): 1/10 = 10% becomes 1/20 = 5%. With more gain, a smaller error produces the same u, but some error must remain, because a P controller only pushes while e ≠ 0. The loop also gets faster: τ_cl = τ/(1 + K·Kp) = 0.05 s.',
        tryIt: 'The Kp = 9 response is now pinned as the dotted reference. Drag Kp to 19: the final value rises from 0.90 to 0.95. Look at u(t): at t = 0 the PID asks for 19 but the limit is 10, so the first instant is clipped (red shading).'
      },
      {
        setup: { plant: 'first', K: 1, tau: 1, Kp: 3, Ki: 0, Kd: 0, r: 1, uMax: 10, uMin: -10 },
        prompt: 'P only with Kp = 3 leaves a 25% error. You add integral action, Ki = 10. What happens?',
        choices: [
          { text: 'The error goes to zero, but the response now overshoots.', correct: true },
          { text: 'The error goes to zero and the shape of the response stays the same.', correct: false },
          { text: 'The error shrinks to about 10% but never reaches zero.', correct: false }
        ],
        explanation: 'The integral keeps growing while any error remains, so the loop can only come to rest at e = 0. It also adds a pole: the closed loop becomes second order, τs² + (1 + KKp)s + KKi = 0, with ζ = 4 / (2√10) ≈ 0.63 here, so it overshoots by about 15%.',
        tryIt: 'Kp = 3 (P only) is pinned. Set Ki to 10 and compare: the steady-state error card drops to 0.000 and the overshoot card shows about 15%.'
      },
      {
        setup: { plant: 'second', K: 1, zeta: 0.5, wn: 2, Kp: 5, Ki: 5, Kd: 0, r: 1, uMax: 10, uMin: -10 },
        prompt: 'Second-order plant (ζ = 0.5, ω_n = 2 rad/s) with PI, Kp = 5 and Ki = 5: it overshoots by about 52%. What will raising Kd to 1 do?',
        choices: [
          { text: 'Cut the overshoot sharply (to roughly 12%) and settle sooner.', correct: true },
          { text: 'Remove the steady-state error.', correct: false },
          { text: 'Increase the overshoot, because the controller reacts faster.', correct: false }
        ],
        explanation: 'This plant has inertia: when y reaches the setpoint it is still moving fast. The D term sees e falling quickly and reduces u early, like a brake. In the characteristic equation it adds K·Kd·ω_n² to the s term, which is extra damping. The steady-state error was already zero thanks to Ki.',
        tryIt: 'The PI response is pinned. Raise Kd to 1: overshoot falls to about 12% and settling drops from about 6.7 s to 1.3 s.'
      }
    ];

    /* ---------- Model configuration from the controls ---------- */
    function plantConfig(s) {
      return s.plant === 'first'
        ? { type: 'first', K: s.K, tau: s.tau }
        : { type: 'second', K: s.K, zeta: s.zeta, wn: s.wn };
    }
    function loopConfig(s) {
      return { plant: plantConfig(s), Kp: s.Kp, Ki: s.Ki, Kd: s.Kd, dMode: s.dMode, r: s.r, uMin: s.uMin, uMax: s.uMax };
    }
    function plantText(s) {
      return s.plant === 'first'
        ? `K = ${s.K.toFixed(1)}, τ = ${s.tau.toFixed(1)} s`
        : `K = ${s.K.toFixed(1)}, ζ = ${s.zeta.toFixed(2)}, ω_n = ${s.wn.toFixed(1)} rad/s`;
    }
    function gainsText(s) {
      return `Kp ${fmtGain(s.Kp)} · Ki ${fmtGain(s.Ki)} · Kd ${fmtGain(s.Kd)}`;
    }
    function fmtGain(v) { return String(Number(v.toFixed(2))); }
    function referenceText(ref) {
      return `${ref.plant === 'first' ? 'first order' : 'second order'}, ${gainsText(ref)}, r = ${ref.r.toFixed(1)}`;
    }

    /* ---------- Charts ---------- */
    function baseOptions() {
      return {
        responsive: true, maintainAspectRatio: false, animation: false,
        parsing: false, normalized: true,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        elements: { point: { radius: 0, hoverRadius: 4, hitRadius: 6, hoverBorderWidth: 2 } },
        layout: { padding: { top: 6, right: 10 } }
      };
    }
    function lineSet(role, label, color, extra) {
      return Object.assign({ role, label, data: [], borderColor: color, backgroundColor: color,
        pointHoverBackgroundColor: '#fff', borderWidth: 2, tension: 0 }, extra);
    }

    function createCharts() {
      if (!CHARTS_AVAILABLE) {
        document.querySelectorAll('[data-chart-fallback]').forEach((el) => { el.hidden = false; });
        return;
      }
      applyChartDefaults();
      const tooltip = (unit) => Object.assign(tooltipStyle(), {
        callbacks: {
          title: (items) => (items.length ? `t = ${fmt(items[0].parsed.x, 3)} s` : ''),
          label: (item) => ` ${item.dataset.label}: ${fmt(item.parsed.y, 3)}${unit}`
        }
      });
      yChart = new Chart(ui.yCanvas, {
        type: 'line',
        data: { datasets: [
          lineSet('setpoint', 'Setpoint r(t)', THEME.setpoint, { borderWidth: 1.75, borderDash: [6, 5], order: 2 }),
          lineSet('output', 'Output y(t)', THEME.output, { borderWidth: 2.75, order: 0 }),
          lineSet('reference', 'Reference y(t)', THEME.reference, { borderDash: [2, 3], order: 3, hidden: true })
        ] },
        options: Object.assign(baseOptions(), {
          scales: {
            x: ControlKit.timeAxis(),
            y: { title: { display: true, text: 'Output y(t)', font: { weight: '600' } },
                 grid: { color: THEME.grid }, border: { color: THEME.axis } }
          },
          plugins: { legend: { display: false }, tooltip: tooltip('') }
        }),
        plugins: [createGuidesPlugin(() => yGuides)]
      });
      uChart = new Chart(ui.uCanvas, {
        type: 'line',
        data: { datasets: [
          lineSet('u', 'Control u(t)', THEME.control, { borderWidth: 2.5, order: 0 })
        ] },
        options: Object.assign(baseOptions(), {
          scales: {
            x: ControlKit.timeAxis(),
            y: { title: { display: true, text: 'Control u(t)', font: { weight: '600' } },
                 grid: { color: THEME.grid }, border: { color: THEME.axis } }
          },
          plugins: { legend: { display: false }, tooltip: tooltip('') }
        }),
        plugins: [createGuidesPlugin(() => uGuides)]
      });
    }

    /** Teaching marks on the response chart: ±2 % band, t_r, M_p, t_s and the e_ss bracket. */
    function responseGuides(met, r, W, yRange) {
      const g = { lines: [], segments: [], markers: [], labels: [] };
      if (met.status !== 'ok') return g;
      const yss = met.yss;
      const band = PidEngine.SETTLE_BAND * Math.abs(yss);
      const bandColor = hexToRgba(THEME.output, 0.45);
      g.lines.push({ x1: 0, y1: yss + band, x2: W, y2: yss + band, color: bandColor, dash: [4, 4] });
      g.lines.push({ x1: 0, y1: yss - band, x2: W, y2: yss - band, color: bandColor, dash: [4, 4] });
      if (met.ts > 0 && met.ts <= W) {
        g.lines.push({ x1: met.ts, y1: yRange[0], x2: met.ts, y2: yRange[1], color: hexToRgba(THEME.tau3, 0.6), dash: [3, 4] });
        g.labels.push({ x: met.ts, y: yRange[0], dx: 6, dy: -14, text: `t_s = ${fmt(met.ts, 3)} s`, short: `t_s ${fmt(met.ts, 2)}`, color: THEME.tau3 });
      }
      if (Number.isFinite(met.t10) && met.t90 <= W) {
        g.markers.push({ x: met.t10, y: 0.1 * yss, color: THEME.tau, radius: 4.5 });
        g.markers.push({ x: met.t90, y: 0.9 * yss, color: THEME.tau, radius: 4.5 });
        g.labels.push({ x: met.t90, y: 0.9 * yss, dx: 10, dy: 14, text: `t_r = ${fmt(met.tr, 3)} s (10→90%)`, short: `t_r ${fmt(met.tr, 2)} s`, color: THEME.tau });
      }
      if (met.mp > 0.05 && met.tPeak <= W) {
        g.markers.push({ x: met.tPeak, y: met.yPeak, color: THEME.error });
        g.labels.push({ x: met.tPeak, y: met.yPeak, dx: 10, dy: -12, text: `M_p = ${fmt(met.mp, 1)}%`, color: THEME.errorText });
      }
      if (Math.abs(met.ess) > 1e-3 * Math.abs(r)) {
        g.lines.push({ x1: 0, y1: yss, x2: W, y2: yss, color: hexToRgba(THEME.error, 0.8), dash: [6, 4] });
        const xb = 0.93 * W;
        g.segments.push({ x1: xb, y1: yss, x2: xb, y2: r, color: THEME.error, width: 2.5, caps: true });
        g.labels.push({ x: xb, y: (yss + r) / 2, dx: -8, align: 'right',
          text: `e_ss = ${fmt(met.ess, 3)} (${fmt(met.essPct, 1)}%)`, short: `e_ss ${fmt(met.essPct, 1)}%`, color: THEME.errorText });
      }
      return g;
    }

    /* ---------- Simulation helpers ---------- */
    function runLoop(s, W) {
      const cfg = loopConfig(s);
      let result = PidEngine.simulate(cfg);
      let met = PidEngine.metrics(result);
      let window = W === 'auto' ? ControlKit.autoWindow(result, met) : Number(W);
      if (window > result.horizon + 1e-9 && !result.diverged) {
        result = PidEngine.simulate(cfg, { horizon: window });   // longer run so the chosen window is filled
        met = PidEngine.metrics(result);
        if (W === 'auto') window = ControlKit.autoWindow(result, met);
      }
      return { result, met, window: Math.min(window, result.horizon) || window };
    }

    function referenceRun(W) {
      const ref = state.reference;
      if (!ref) return null;
      const key = JSON.stringify(ref) + '|' + W;
      if (refCache.key !== key) {
        const cfg = loopConfig(ref);
        let result = PidEngine.simulate(cfg, { minHorizon: W });
        refCache = { key, result, metrics: PidEngine.metrics(result) };
      }
      return refCache;
    }

    /* ---------- Render everything from the current state ---------- */
    function render() {
      let run;
      try {
        run = runLoop(state, state.window);
        ui.inputError.hidden = true;
      } catch (error) {
        ui.inputError.textContent = error.message;
        ui.inputError.hidden = false;
        return;
      }
      const { result, met } = run;
      const W = run.window;
      const rec = result.rec;
      const r = state.r;
      const ok = met.status === 'ok';
      const ref = referenceRun(W);

      // Block diagram and chips
      ControlKit.setDiagramText(ui.bd, 'gains', gainsText(state));
      ControlKit.setDiagramText(ui.bd, 'limits', `limits ${fmt(state.uMin, 1)} … ${fmt(state.uMax, 1)}`);
      ControlKit.setDiagramText(ui.bd, 'plant-name', state.plant === 'first' ? 'First-order plant' : 'Second-order plant');
      ControlKit.setDiagramText(ui.bd, 'plant-tf', state.plant === 'first'
        ? `G(s) = ${fmtGain(state.K)} / (${fmtGain(state.tau)}s + 1)`
        : `G(s) = ${fmtGain(state.K * state.wn * state.wn)} / (s² + ${fmtGain(2 * state.zeta * state.wn)}s + ${fmtGain(state.wn * state.wn)})`);
      ui.paramChip.textContent = `${plantText(state)}, r = ${r.toFixed(1)}`;

      // Response chart
      const [ylo, yhi] = ControlKit.extent(rec, 'y', W);
      const values = [0, r, ylo, yhi];
      if (ref) { const [a, b] = ControlKit.extent(ref.result.rec, 'y', W); values.push(a, b); }
      const clip = ok || met.status === 'not-settled' ? null : [-2 * Math.abs(r), 3 * Math.abs(r)];
      const yRange = ControlKit.valueRange(values, clip);
      const yLegend = [
        { label: 'Setpoint r(t)', kind: 'dashed', color: THEME.setpoint },
        { label: 'Output y(t)', kind: 'line', color: THEME.output }
      ];
      if (ok) {
        yLegend.push({ label: '±2% band', kind: 'dashed', color: hexToRgba(THEME.output, 0.45) });
        yLegend.push({ label: '10% and 90% points', kind: 'dot', color: THEME.tau });
        if (met.mp > 0.05) yLegend.push({ label: 'Peak (overshoot)', kind: 'dot', color: THEME.error });
        if (Math.abs(met.ess) > 1e-3 * Math.abs(r)) yLegend.push({ label: 'Steady-state error', kind: 'vbar', color: THEME.error });
      }
      if (ref) yLegend.push({ label: `Reference (${referenceText(state.reference)})`, kind: 'dotted', color: THEME.reference });
      renderLegend(ui.yLegend, yLegend);
      if (yChart) {
        const [sp, out, refSet] = yChart.data.datasets;
        sp.data = [{ x: 0, y: r }, { x: W, y: r }];
        out.data = PidEngine.decimate(rec, 'y', 0, W, 500);
        refSet.hidden = !ref;
        refSet.data = ref ? PidEngine.decimate(ref.result.rec, 'y', 0, W, 400) : [];
        refSet.label = 'Reference y(t)';
        yChart.options.scales.x.max = W;
        yChart.options.scales.y.min = yRange[0];
        yChart.options.scales.y.max = yRange[1];
        yGuides = responseGuides(met, r, W, yRange);
        yChart.update('none');
      }

      // Control-signal chart
      const uVals = ControlKit.extent(rec, 'u', W);
      uVals.push(0);
      const span = Math.max(Math.max(...uVals) - Math.min(...uVals), 1e-6);
      const showMax = state.uMax <= Math.max(...uVals) + 1.5 * span;
      const showMin = state.uMin >= Math.min(...uVals) - 1.5 * span;
      if (showMax) uVals.push(state.uMax);
      if (showMin) uVals.push(state.uMin);
      const uRange = ControlKit.valueRange(uVals);
      const spans = ControlKit.saturationSpans(rec, W);
      const uLegend = [{ label: 'Control signal u(t) (after the limit)', kind: 'line', color: THEME.control },
                       { label: 'Limits u_min, u_max', kind: 'dashed', color: THEME.limit }];
      renderLegend(ui.uLegend, uLegend);
      if (uChart) {
        const sets = uChart.data.datasets;
        sets[0].data = PidEngine.decimate(rec, 'u', 0, W, 500);
        uChart.options.scales.x.max = W;
        uChart.options.scales.y.min = uRange[0];
        uChart.options.scales.y.max = uRange[1];
        const limColor = hexToRgba(THEME.limit, 0.85);
        uGuides = { spans, lines: [], labels: [] };
        if (showMax) {
          uGuides.lines.push({ x1: 0, y1: state.uMax, x2: W, y2: state.uMax, color: limColor, dash: [6, 4], width: 1.5 });
          uGuides.labels.push({ x: W, y: state.uMax, dx: -4, dy: -12, align: 'right', text: `u_max = ${fmt(state.uMax, 1)}`, color: THEME.limit });
        }
        if (showMin) {
          uGuides.lines.push({ x1: 0, y1: state.uMin, x2: W, y2: state.uMin, color: limColor, dash: [6, 4], width: 1.5 });
          uGuides.labels.push({ x: W, y: state.uMin, dx: -4, dy: 12, align: 'right', text: `u_min = ${fmt(state.uMin, 1)}`, color: THEME.limit });
        }
        uChart.update('none');
      }
      const hidden = [!showMax && `u_max = ${fmt(state.uMax, 1)}`, !showMin && `u_min = ${fmt(state.uMin, 1)}`].filter(Boolean);
      ui.uNote.textContent = hidden.length ? `${hidden.join(' and ')} ${hidden.length > 1 ? 'are' : 'is'} far outside this view, so not drawn.` : 'Red shading marks the time u is held at a limit.';
      ui.satChip.textContent = met.satTime > 0 ? `Saturated for ${fmt(met.satTime, 3)} s` : 'Not saturated';
      ui.satChip.className = 'chip ' + (met.satTime > 0 ? 'chip--fail' : 'chip--pass');

      // Status, metrics, reference values
      renderStatus(met, result);
      const set = (id, text, na) => { const el = $(id); el.textContent = text; el.parentElement.classList.toggle('is-na', na); };
      set('p1-m-tr', ControlKit.metricText(met.tr, 3), !ok);
      set('p1-m-mp', ControlKit.metricText(met.mp, 1), !ok);
      set('p1-m-ts', ControlKit.metricText(met.ts, 3), !ok);
      set('p1-m-ess', ControlKit.metricText(met.ess, 3), !ok);
      $('p1-m-ess-pct').textContent = ok ? `(${fmt(met.essPct, 1)}%)` : '';

      lastRec = rec;
      renderSaturation(met);

      // Reference controls
      const same = state.reference && JSON.stringify(loopConfig(state.reference)) === JSON.stringify(loopConfig(state));
      ui.refStatus.textContent = !state.reference
        ? 'No reference curve. Pin the current curve to compare later settings with it.'
        : same ? 'Reference pinned (identical to the live curve). Change a control to compare.'
          : `Dotted reference: ${referenceText(state.reference)}.`;
      ui.pin.disabled = Boolean(same);
      ui.unpin.disabled = !state.reference;

      // Screen-reader descriptions
      ui.yCanvas.setAttribute('aria-label', ok
        ? `Closed-loop step response: y rises to ${fmt(met.yss, 3)} for a setpoint of ${fmt(r, 2)}, rise time ${fmt(met.tr, 3)} s, overshoot ${fmt(met.mp, 1)} percent, settling time ${fmt(met.ts, 3)} s.`
        : `Closed-loop step response: ${met.reason}`);
      ui.uCanvas.setAttribute('aria-label', `Control signal: peak magnitude ${fmt(met.peakU, 2)}, saturated for ${fmt(met.satTime, 3)} s.`);
    }

    function renderStatus(met, result) {
      const bad = ControlKit.statusSentence(met);
      if (!bad) {
        ui.status.className = 'status-line status-line--ok';
        ui.status.innerHTML = `<strong>Stable and settled.</strong><span>y<sub>final</sub> = ${escapeHtml(fmt(met.yss, 4))}; y stays within ±2% of it after t = ${escapeHtml(fmt(met.ts, 3))} s. Run length ${escapeHtml(fmt(result.horizon, 1))} s.</span>`;
        return;
      }
      ui.status.className = 'status-line status-line--' + bad.cls;
      ui.status.innerHTML = `<strong>${escapeHtml(bad.title)}</strong><span>${escapeHtml(bad.text)}</span>`;
    }

    /** Short explanation whenever u is held at a limit. */
    function renderSaturation(met) {
      if (!(met.satTime > 0)) { ui.satCallout.hidden = true; return; }
      ui.satCallout.hidden = false;
      if (met.status === 'oscillating' || met.status === 'unstable') {
        ui.satText.textContent = `u hits a limit for ${fmt(met.satTime, 3)} s. The loop itself is unstable: the limits only stop the swings from growing. Lower the gains.`;
      } else if (state.Kd > 0 && met.satTime < 10 * PidEngine.DERIV_TF && result0Sat()) {
        ui.satText.textContent = `Derivative kick: the setpoint step makes de/dt very large for an instant, and the limit clips it for ${fmt(met.satTime, 3)} s. It barely changes y.`;
      } else {
        ui.satText.textContent = `u is held at a limit for ${fmt(met.satTime, 3)} s, so the plant receives less than the PID asks for. The output rises more slowly than the formulas predict${state.Ki > 0 ? ', and the integral winds up, which adds overshoot' : ''}.`;
      }
    }
    let lastRec = null;
    function result0Sat() { return lastRec && lastRec.sat.findIndex(Boolean) <= 2; }

    /* ---------- Validation: the three Homework 2 tests ----------
       Every "calculated" value is measured from PidEngine.simulate(), the same
       RK4 simulation that draws the charts. Nothing is hard-coded as PASS. */
    function runValidation() {
      const base = { plant: { type: 'first', K: 1, tau: 1 }, r: 1, uMin: -10, uMax: 10 };
      const checks = [];

      // Test 1: P only, Kp = 9. τ_cl = time to reach 63.2 % of the simulated final value.
      const t1 = PidEngine.simulate(Object.assign({ Kp: 9 }, base), { horizon: 3 });
      const m1 = PidEngine.metrics(t1);
      const level = (1 - Math.exp(-1)) * m1.yss;
      let tauCl = NaN;
      for (let i = 1; i < t1.rec.y.length; i++) {
        if (t1.rec.y[i] >= level) {
          const a = t1.rec.y[i - 1], b = t1.rec.y[i];
          tauCl = t1.rec.t[i - 1] + ((level - a) / (b - a)) * (t1.rec.t[i] - t1.rec.t[i - 1]);
          break;
        }
      }
      checks.push({
        name: '1. P only',
        detail: 'Kp = 9, Ki = 0, Kd = 0',
        expected: { main: 'τ_cl = 0.1 s; e_ss = 10%', sub: 'τ/(1 + KKp) and 1/(1 + KKp)' },
        calculated: { main: `τ_cl = ${fmt(tauCl, 4)} s; e_ss = ${fmt(m1.essPct, 2)}%`, sub: `y_final = ${fmt(m1.yss, 4)}, not saturated` },
        pass: m1.status === 'ok' && m1.satTime === 0 && Math.abs(tauCl - 0.1) <= 0.001 && Math.abs(m1.ess - 0.1) <= 0.001
      });

      // Test 2: PI, Kp = 1, Ki = 1. ω_n and ζ from the simulator's own state equations
      // (finite-difference Jacobian A of the closed loop: ω_n = √det A, ζ = −trace A / 2ω_n).
      const J = PidEngine.linearise(Object.assign({ Kp: 1, Ki: 1 }, base));
      const trace = J[0][0] + J[1][1];
      const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
      const wn = Math.sqrt(det);
      const zeta = -trace / (2 * wn);
      checks.push({
        name: '2. PI controller',
        detail: 'Kp = 1, Ki = 1, Kd = 0; closed loop τs² + (1 + KKp)s + KKi = 0',
        expected: { main: 'ω_n = 1 rad/s; ζ = 1', sub: '√(KKi/τ) and (1 + KKp)/(2√(τKKi))' },
        calculated: { main: `ω_n = ${fmt(wn, 4)} rad/s; ζ = ${fmt(zeta, 4)}`, sub: 'from the simulated loop’s state matrix' },
        pass: Math.abs(wn - 1) <= 0.001 && Math.abs(zeta - 1) <= 0.001
      });

      // Test 3: the same stable PI loop, unsaturated: error after 30 s of simulation.
      const t3 = PidEngine.simulate(Object.assign({ Kp: 1, Ki: 1 }, base), { horizon: 30 });
      const m3 = PidEngine.metrics(t3);
      const ess = 1 - t3.rec.y[t3.rec.y.length - 1];
      checks.push({
        name: '3. PI steady-state error',
        detail: 'Kp = 1, Ki = 1, unit step, 30 s simulated',
        expected: { main: 'e_ss ≈ 0', sub: 'tolerance |e_ss| ≤ 1e−4' },
        calculated: { main: Math.abs(ess) < 1e-12 ? 'e_ss < 1e−12' : `e_ss = ${ess.toExponential(1).replace('-', '−')}`, sub: `peak |u| = ${fmt(m3.peakU, 2)}, not saturated` },
        pass: t3.analysis.stable && m3.satTime === 0 && Math.abs(ess) <= 1e-4
      });

      const passed = renderValidation(ui.validationBody, checks);
      ui.validationSummary.textContent = `${passed} of ${checks.length} passed`;
      ui.validationSummary.className = 'chip ' + (passed === checks.length ? 'chip--pass' : 'chip--fail');
    }

    /* ---------- Controls ---------- */
    function syncControls() {
      Object.entries(SLIDERS).forEach(([key, s]) => {
        s.el.value = String(state[key]);
        s.out.textContent = s.text(state[key]);
        s.el.setAttribute('aria-valuetext', s.text(state[key]));
        ControlKit.setSliderFill(s.el);
      });
      ui.plantRadios.forEach((radio) => { radio.checked = radio.value === state.plant; });
      ui.plantFirst.forEach((el) => { el.hidden = state.plant !== 'first'; });
      ui.plantSecond.forEach((el) => { el.hidden = state.plant !== 'second'; });
      ui.presetHelp.textContent = PRESET_HELP[state.plant];
      const presets = PRESETS[state.plant];
      ui.presets.forEach((btn) => {
        const p = presets[btn.dataset.preset];
        btn.setAttribute('aria-pressed', String(p.Kp === state.Kp && p.Ki === state.Ki && p.Kd === state.Kd));
      });
    }

    const scheduleRender = ControlKit.frameThrottle(render);
    function onControlChange() {
      syncControls();
      scheduleRender();
      predict.notifyInteraction();
    }

    Object.entries(SLIDERS).forEach(([key, s]) => {
      s.el.addEventListener('input', () => { state[key] = Number(s.el.value); onControlChange(); });
    });
    ui.plantRadios.forEach((radio) => radio.addEventListener('change', () => {
      if (radio.checked) { state.plant = radio.value; Object.assign(state, PRESETS[state.plant].P); onControlChange(); }
    }));
    ui.presets.forEach((btn) => btn.addEventListener('click', () => {
      Object.assign(state, PRESETS[state.plant][btn.dataset.preset]);
      onControlChange();
    }));
    ui.reset.addEventListener('click', () => {
      Object.assign(state, DEFAULTS, { reference: null });
      syncControls();
      render();
    });

    function snapshot() {
      const keys = ['plant', 'K', 'tau', 'zeta', 'wn', 'Kp', 'Ki', 'Kd', 'dMode', 'r', 'uMax', 'uMin'];
      return Object.fromEntries(keys.map((k) => [k, state[k]]));
    }
    function pinCurrent() { state.reference = snapshot(); render(); }
    ui.pin.addEventListener('click', pinCurrent);
    ui.unpin.addEventListener('click', () => { state.reference = null; render(); });


    // "Predict, then check": checking loads the question's setup and pins it as the reference.
    const predict = createPredictCheck($('p1-predict'), QUESTIONS, {
      onCheck: (q) => {
        Object.assign(state, q.setup, { dMode: 'error', window: 'auto' });
        syncControls();
        pinCurrent();
      }
    });

    createCharts();
    syncControls();
    render();
    runValidation();
  }

  /* =========================================================================
     START-UP
     ========================================================================= */
  initP1();
  